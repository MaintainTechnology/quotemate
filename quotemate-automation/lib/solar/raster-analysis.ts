// ════════════════════════════════════════════════════════════════════
// Solar — PURE raster analyses over decoded dataLayers rasters
// (full-exploitation build 2026-06-13). No I/O; every function operates
// on plain arrays so the whole module is unit-testable without GeoTIFFs.
//
//   • maskedMean            — mean of a band over roof-mask pixels
//   • deriveMonthlyProductionWeights — monthly flux → 12 normalised
//     weights (feeds buildMonthlyProductionChart's monthly_kwh input)
//   • analyzeHourlyShade    — hourly-shade bitmask rasters → per-hour
//     sun fractions, the shade-free window, per-month midday sun
//   • estimateBuildingHeightFromDsm — DSM + mask → building height +
//     storeys hint (p90 roof elevation − median ground elevation)
//
// All outputs are display/insight data — nothing here touches sizing or
// pricing (money-path rule).
// ════════════════════════════════════════════════════════════════════

export type RasterBand = {
  data: ArrayLike<number>
  width: number
  height: number
}

/** Sun fraction ≥ this over the year counts as part of the shade-free window. */
const SHADE_FREE_THRESHOLD = 0.9
/** Metres of height per storey for the DSM-derived hint. */
const METRES_PER_STOREY = 3.0
/** Non-leap day counts — Google's hourly shade encodes up to 31 day bits. */
const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const

/**
 * PURE — nearest-neighbour mask lookup tolerant of resolution mismatch
 * between a data band and the mask band. mask > 0 ⇒ roof pixel.
 */
export function maskAt(
  mask: RasterBand | null,
  x: number,
  y: number,
  width: number,
  height: number,
): boolean {
  if (!mask) return true
  const mx = Math.min(mask.width - 1, Math.floor((x * mask.width) / width))
  const my = Math.min(mask.height - 1, Math.floor((y * mask.height) / height))
  const v = mask.data[my * mask.width + mx]
  return typeof v === 'number' && v > 0
}

/**
 * PURE — mean of a band over roof pixels, ignoring nodata. Returns null
 * when no valid pixel exists.
 */
export function maskedMean(
  band: RasterBand,
  mask: RasterBand | null,
  noDataValue: number | null = null,
): number | null {
  let sum = 0
  let n = 0
  for (let y = 0; y < band.height; y++) {
    for (let x = 0; x < band.width; x++) {
      const v = band.data[y * band.width + x]
      if (typeof v !== 'number' || !Number.isFinite(v)) continue
      if (noDataValue !== null && v === noDataValue) continue
      if (v < 0) continue // Solar flux uses negative sentinels for nodata
      if (!maskAt(mask, x, y, band.width, band.height)) continue
      sum += v
      n++
    }
  }
  return n > 0 ? sum / n : null
}

/**
 * PURE — monthly flux (12 bands, kWh/kW/month) → 12 weights summing to 1.
 * Returns null when fewer than 12 usable bands or all-zero means, so a
 * partial payload can never produce a misleading seasonal curve.
 */
export function deriveMonthlyProductionWeights(
  months: RasterBand[],
  mask: RasterBand | null,
  noDataValue: number | null = null,
): number[] | null {
  if (months.length !== 12) return null
  const means: number[] = []
  for (const band of months) {
    const m = maskedMean(band, mask, noDataValue)
    if (m === null || !Number.isFinite(m) || m < 0) return null
    means.push(m)
  }
  const total = means.reduce((a, b) => a + b, 0)
  if (total <= 0) return null
  return means.map((m) => m / total)
}

/** PURE — annual kWh × monthly weights → 12-month kWh series (1 dp). */
export function monthlyKwhFromWeights(annualKwh: number, weights: number[]): number[] | null {
  if (!Number.isFinite(annualKwh) || annualKwh <= 0) return null
  if (weights.length !== 12) return null
  return weights.map((w) => Math.round(annualKwh * w * 10) / 10)
}

export type SolarShadeAnalysis = {
  /** Annual average fraction of roof-pixel-days with direct sun, hour 0–23. */
  hourly_sun_fraction: number[]
  /** Per-month fraction of roof-pixel-days sunny across 9am–3pm. */
  monthly_midday_sun_fraction: number[]
  /** First/last hour (0–23) of the contiguous ≥90%-sunny window, or null. */
  shade_free_start_hour: number | null
  shade_free_end_hour: number | null
  /** Length of that window in hours (0 when none). */
  shade_free_hours: number
}

/**
 * PURE — analyse Google's hourly-shade rasters. Input: one entry per
 * month (index 0 = January) of 24 bands; each pixel is a 31-bit mask
 * where bit (d−1) set ⇒ that location sees the sun on day d at that hour.
 *
 * Returns null when no month carries valid 24-band data.
 */
export function analyzeHourlyShade(
  months: Array<{ bands: RasterBand[] } | null>,
  mask: RasterBand | null,
): SolarShadeAnalysis | null {
  if (months.length === 0) return null

  // sunny[month][hour] = sunny pixel-days; possible[month][hour] = total.
  const sunny: number[][] = []
  const possible: number[][] = []
  let anyMonth = false

  for (let m = 0; m < 12; m++) {
    sunny.push(new Array(24).fill(0))
    possible.push(new Array(24).fill(0))
    const month = months[m]
    if (!month || month.bands.length !== 24) continue
    const days = DAYS_IN_MONTH[m]
    anyMonth = true
    for (let h = 0; h < 24; h++) {
      const band = month.bands[h]
      for (let y = 0; y < band.height; y++) {
        for (let x = 0; x < band.width; x++) {
          if (!maskAt(mask, x, y, band.width, band.height)) continue
          const v = band.data[y * band.width + x]
          if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) continue
          sunny[m][h] += countSetBits(v >>> 0, days)
          possible[m][h] += days
        }
      }
    }
  }

  if (!anyMonth) return null

  const hourly_sun_fraction: number[] = []
  for (let h = 0; h < 24; h++) {
    let s = 0
    let p = 0
    for (let m = 0; m < 12; m++) {
      s += sunny[m][h]
      p += possible[m][h]
    }
    hourly_sun_fraction.push(p > 0 ? round3(s / p) : 0)
  }

  const monthly_midday_sun_fraction: number[] = []
  for (let m = 0; m < 12; m++) {
    let s = 0
    let p = 0
    for (let h = 9; h <= 15; h++) {
      s += sunny[m][h]
      p += possible[m][h]
    }
    monthly_midday_sun_fraction.push(p > 0 ? round3(s / p) : 0)
  }

  // Longest contiguous run of hours at/above the shade-free threshold.
  let bestStart: number | null = null
  let bestLen = 0
  let runStart: number | null = null
  for (let h = 0; h <= 24; h++) {
    const sunnyHour = h < 24 && hourly_sun_fraction[h] >= SHADE_FREE_THRESHOLD
    if (sunnyHour && runStart === null) runStart = h
    if (!sunnyHour && runStart !== null) {
      const len = h - runStart
      if (len > bestLen) {
        bestLen = len
        bestStart = runStart
      }
      runStart = null
    }
  }

  return {
    hourly_sun_fraction,
    monthly_midday_sun_fraction,
    shade_free_start_hour: bestStart,
    shade_free_end_hour: bestStart !== null ? bestStart + bestLen - 1 : null,
    shade_free_hours: bestLen,
  }
}

export type SolarBuildingHeight = {
  /** p90 roof elevation − median surrounding ground elevation, metres. */
  height_m: number
  /** height ÷ 3 m per storey, minimum 1. Informational hint only. */
  storeys_hint: number
}

/**
 * PURE — building height from a DSM band + roof mask: the 90th-percentile
 * elevation inside the mask minus the median elevation outside it. Returns
 * null when either population is too small or the delta is implausible.
 */
export function estimateBuildingHeightFromDsm(
  dsm: RasterBand,
  mask: RasterBand,
  noDataValue: number | null = null,
): SolarBuildingHeight | null {
  const inside: number[] = []
  const outside: number[] = []
  for (let y = 0; y < dsm.height; y++) {
    for (let x = 0; x < dsm.width; x++) {
      const v = dsm.data[y * dsm.width + x]
      if (typeof v !== 'number' || !Number.isFinite(v)) continue
      if (noDataValue !== null && v === noDataValue) continue
      if (v < -100) continue // DSM nodata sentinel guard
      if (maskAt(mask, x, y, dsm.width, dsm.height)) inside.push(v)
      else outside.push(v)
    }
  }
  if (inside.length < 16 || outside.length < 16) return null
  inside.sort((a, b) => a - b)
  outside.sort((a, b) => a - b)
  const roof = inside[Math.min(inside.length - 1, Math.floor(inside.length * 0.9))]
  const ground = outside[Math.floor(outside.length / 2)]
  const height = roof - ground
  if (!Number.isFinite(height) || height <= 0 || height > 60) return null
  return {
    height_m: Math.round(height * 10) / 10,
    storeys_hint: Math.max(1, Math.round(height / METRES_PER_STOREY)),
  }
}

export type PlaneAnchor = { plane_index: number; x_pct: number; y_pct: number }

/** Metres per degree of latitude (WGS84 mean). */
const M_PER_DEG_LAT = 111_132
/** Metres per degree of longitude at the equator. */
const M_PER_DEG_LNG = 111_320

/**
 * PURE — project each roof plane's panel-centroid into percentage
 * coordinates inside the flux raster image.
 *
 * Google Solar GeoTIFFs carry a PROJECTED bbox (UTM metres — verified
 * live 2026-06-13), so a naive degrees-vs-bbox comparison fails. Instead
 * the raster's geometry is anchored on what we DO know: it is north-up
 * and centred on the dataLayers request `center`, with the bbox giving
 * its true metre extents. Panel positions become local-metre offsets
 * from that centre (equirectangular — exact to centimetres at 50 m).
 * When the bbox is in degrees (|values| ≤ 360) the spans convert first.
 * Planes whose centroid lands outside the image are skipped, so a label
 * can never float off the roof.
 */
export function projectPlaneAnchors(
  panels: Array<{ center: { lat: number; lng: number }; segment_index: number }>,
  bbox: [number, number, number, number] | null,
  center: { lat: number; lng: number },
): PlaneAnchor[] {
  if (!bbox || panels.length === 0) return []
  if (!Number.isFinite(center.lat) || !Number.isFinite(center.lng)) return []
  const [west, south, east, north] = bbox
  if (![west, south, east, north].every((v) => Number.isFinite(v))) return []

  // Raster extents in METRES, regardless of the bbox CRS.
  const degreeBbox = Math.abs(west) <= 360 && Math.abs(east) <= 360 && Math.abs(north) <= 360
  const cosLat = Math.cos((center.lat * Math.PI) / 180)
  const widthM = degreeBbox ? (east - west) * M_PER_DEG_LNG * cosLat : east - west
  const heightM = degreeBbox ? (north - south) * M_PER_DEG_LAT : north - south
  if (!(widthM > 0) || !(heightM > 0)) return []

  const sums = new Map<number, { x: number; y: number; n: number }>()
  for (const p of panels) {
    const { lat, lng } = p.center
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue
    // Local-metre offset from the raster centre (north-up image).
    const dxM = (lng - center.lng) * M_PER_DEG_LNG * cosLat
    const dyM = (lat - center.lat) * M_PER_DEG_LAT
    const x = (dxM + widthM / 2) / widthM
    const y = (heightM / 2 - dyM) / heightM
    if (x < 0 || x > 1 || y < 0 || y > 1) continue
    const acc = sums.get(p.segment_index)
    if (acc) {
      acc.x += x
      acc.y += y
      acc.n++
    } else {
      sums.set(p.segment_index, { x, y, n: 1 })
    }
  }

  const anchors: PlaneAnchor[] = []
  for (const [plane_index, acc] of [...sums.entries()].sort((a, b) => a[0] - b[0])) {
    anchors.push({
      plane_index,
      x_pct: Math.round((acc.x / acc.n) * 1000) / 10,
      y_pct: Math.round((acc.y / acc.n) * 1000) / 10,
    })
  }
  return anchors
}

/** Geographic extent of the rendered flux PNG (EPSG:4326). */
export type FluxLatLngBounds = { west: number; south: number; east: number; north: number }

/**
 * PURE — the rendered flux PNG's lat/lng bounding box, for georeferencing
 * it on a map. CRITICAL: this uses the SAME geometric model as
 * `projectPlaneAnchors` — the raster is treated as north-up and CENTRED on
 * the dataLayers request `center`, with the bbox giving only the true
 * metre extents (Google Solar GeoTIFFs carry a PROJECTED UTM bbox, so its
 * raw corners are NOT WGS84 and must never be used as lat/lng directly).
 * Half the metre width/height are converted back to degrees around the
 * centre, so the corners line up exactly with where x_pct/y_pct anchors
 * land — markers re-projected through these bounds sit on the same pixels.
 * When the bbox is already in degrees (|values| ≤ 360) the spans convert
 * first. Returns null for a null/degenerate bbox or non-finite centre.
 */
export function fluxRasterLatLngBounds(
  bbox: [number, number, number, number] | null,
  center: { lat: number; lng: number },
): FluxLatLngBounds | null {
  if (!bbox) return null
  if (!Number.isFinite(center.lat) || !Number.isFinite(center.lng)) return null
  const [west, south, east, north] = bbox
  if (![west, south, east, north].every((v) => Number.isFinite(v))) return null

  const degreeBbox = Math.abs(west) <= 360 && Math.abs(east) <= 360 && Math.abs(north) <= 360
  const cosLat = Math.cos((center.lat * Math.PI) / 180)
  const widthM = degreeBbox ? (east - west) * M_PER_DEG_LNG * cosLat : east - west
  const heightM = degreeBbox ? (north - south) * M_PER_DEG_LAT : north - south
  if (!(widthM > 0) || !(heightM > 0) || !(cosLat > 0)) return null

  // Half-extents in degrees around the request centre (north-up image).
  const halfLng = widthM / 2 / (M_PER_DEG_LNG * cosLat)
  const halfLat = heightM / 2 / M_PER_DEG_LAT
  return {
    west: center.lng - halfLng,
    east: center.lng + halfLng,
    south: center.lat - halfLat,
    north: center.lat + halfLat,
  }
}

// ── helpers ──────────────────────────────────────────────────────────

/** Count set bits among the lowest `limit` bits of v. */
function countSetBits(v: number, limit: number): number {
  let n = 0
  for (let i = 0; i < limit; i++) {
    if ((v >>> i) & 1) n++
  }
  return n
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000
}

export const __test_only__ = {
  SHADE_FREE_THRESHOLD,
  METRES_PER_STOREY,
  DAYS_IN_MONTH,
  countSetBits,
}
