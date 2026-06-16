import { describe, it, expect } from 'vitest'
import {
  maskAt,
  maskedMean,
  deriveMonthlyProductionWeights,
  monthlyKwhFromWeights,
  analyzeHourlyShade,
  estimateBuildingHeightFromDsm,
  fluxRasterLatLngBounds,
  projectPlaneAnchors,
  __test_only__,
  type RasterBand,
} from './raster-analysis'

const { countSetBits } = __test_only__

function band(width: number, height: number, fill: number | ((x: number, y: number) => number)): RasterBand {
  const data = new Array(width * height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      data[y * width + x] = typeof fill === 'function' ? fill(x, y) : fill
    }
  }
  return { data, width, height }
}

describe('maskAt', () => {
  it('treats a null mask as all-roof', () => {
    expect(maskAt(null, 0, 0, 4, 4)).toBe(true)
  })

  it('reads same-resolution masks directly', () => {
    const mask = band(2, 2, (x, y) => (x === 0 && y === 0 ? 1 : 0))
    expect(maskAt(mask, 0, 0, 2, 2)).toBe(true)
    expect(maskAt(mask, 1, 1, 2, 2)).toBe(false)
  })

  it('nearest-samples a mask at a different resolution', () => {
    // 2×2 mask: left column roof. Sampled from a 4×4 grid.
    const mask = band(2, 2, (x) => (x === 0 ? 1 : 0))
    expect(maskAt(mask, 0, 0, 4, 4)).toBe(true)
    expect(maskAt(mask, 1, 0, 4, 4)).toBe(true) // still left half
    expect(maskAt(mask, 3, 3, 4, 4)).toBe(false)
  })
})

describe('maskedMean', () => {
  it('averages only roof pixels', () => {
    const mask = band(2, 2, (x) => (x === 0 ? 1 : 0))
    const flux = band(2, 2, (x) => (x === 0 ? 100 : 900))
    expect(maskedMean(flux, mask)).toBe(100)
  })

  it('skips nodata and negative sentinels', () => {
    const flux = band(2, 1, (x) => (x === 0 ? -9999 : 50))
    expect(maskedMean(flux, null, -9999)).toBe(50)
    const fluxNeg = band(2, 1, (x) => (x === 0 ? -1 : 80))
    expect(maskedMean(fluxNeg, null)).toBe(80)
  })

  it('returns null when nothing is usable', () => {
    expect(maskedMean(band(2, 2, -1), null)).toBeNull()
  })
})

describe('deriveMonthlyProductionWeights', () => {
  it('normalises 12 monthly means to weights summing to 1', () => {
    // Month m has constant flux (m+1) → weights proportional to 1..12.
    const months = Array.from({ length: 12 }, (_, m) => band(2, 2, m + 1))
    const w = deriveMonthlyProductionWeights(months, null)
    expect(w).not.toBeNull()
    const sum = w!.reduce((a, b) => a + b, 0)
    expect(sum).toBeCloseTo(1, 10)
    expect(w![11] / w![0]).toBeCloseTo(12, 10)
  })

  it('returns null for partial payloads', () => {
    const months = Array.from({ length: 11 }, () => band(2, 2, 1))
    expect(deriveMonthlyProductionWeights(months, null)).toBeNull()
  })

  it('returns null when a month has no usable pixels', () => {
    const months = Array.from({ length: 12 }, (_, m) => band(2, 2, m === 5 ? -1 : 10))
    expect(deriveMonthlyProductionWeights(months, null)).toBeNull()
  })
})

describe('monthlyKwhFromWeights', () => {
  it('scales annual kWh by the weights', () => {
    const weights = new Array(12).fill(1 / 12)
    const series = monthlyKwhFromWeights(1200, weights)
    expect(series).not.toBeNull()
    expect(series![0]).toBe(100)
  })

  it('rejects non-positive annual kWh and short weight arrays', () => {
    expect(monthlyKwhFromWeights(0, new Array(12).fill(1 / 12))).toBeNull()
    expect(monthlyKwhFromWeights(1000, [0.5, 0.5])).toBeNull()
  })
})

describe('countSetBits', () => {
  it('counts bits below the limit only', () => {
    expect(countSetBits(0b1111, 2)).toBe(2)
    expect(countSetBits(0xffffffff, 31)).toBe(31)
    expect(countSetBits(0, 31)).toBe(0)
  })
})

describe('analyzeHourlyShade', () => {
  // Helper: a month where hours [start..end] are fully sunny (all 31/28/...
  // day bits set) and every other hour fully shaded.
  function month(sunnyStart: number, sunnyEnd: number) {
    const allDays = 0x7fffffff // 31 bits
    const bands = Array.from({ length: 24 }, (_, h) =>
      band(2, 2, h >= sunnyStart && h <= sunnyEnd ? allDays : 0),
    )
    return { bands }
  }

  it('finds the contiguous shade-free window across all months', () => {
    const months = Array.from({ length: 12 }, () => month(9, 16))
    const res = analyzeHourlyShade(months, null)
    expect(res).not.toBeNull()
    expect(res!.shade_free_start_hour).toBe(9)
    expect(res!.shade_free_end_hour).toBe(16)
    expect(res!.shade_free_hours).toBe(8)
    expect(res!.hourly_sun_fraction[12]).toBe(1)
    expect(res!.hourly_sun_fraction[3]).toBe(0)
  })

  it('reports per-month midday sun fractions', () => {
    // June (index 5) fully shaded; everything else sunny 9–15.
    const months = Array.from({ length: 12 }, (_, m) =>
      m === 5 ? month(0, -1) : month(9, 15),
    )
    const res = analyzeHourlyShade(months, null)
    expect(res!.monthly_midday_sun_fraction[5]).toBe(0)
    expect(res!.monthly_midday_sun_fraction[0]).toBe(1)
  })

  it('returns null when no month carries 24 bands', () => {
    expect(analyzeHourlyShade([null, null], null)).toBeNull()
    expect(analyzeHourlyShade([{ bands: [band(2, 2, 0)] }], null)).toBeNull()
  })

  it('reports no window when nothing clears the 90% threshold', () => {
    // Sunny only ~half the days: bit pattern alternating days.
    const halfDays = 0x55555555 & 0x7fffffff
    const bands = Array.from({ length: 24 }, () => band(2, 2, halfDays))
    const months = Array.from({ length: 12 }, () => ({ bands }))
    const res = analyzeHourlyShade(months, null)
    expect(res!.shade_free_hours).toBe(0)
    expect(res!.shade_free_start_hour).toBeNull()
  })

  it('only counts roof pixels when a mask is provided', () => {
    // Roof = left column sunny all day; right column always shaded.
    const allDays = 0x7fffffff
    const bands = Array.from({ length: 24 }, () =>
      band(2, 2, (x) => (x === 0 ? allDays : 0)),
    )
    const months = Array.from({ length: 12 }, () => ({ bands }))
    const mask = band(2, 2, (x) => (x === 0 ? 1 : 0))
    const res = analyzeHourlyShade(months, mask)
    expect(res!.hourly_sun_fraction[12]).toBe(1)
  })
})

describe('projectPlaneAnchors', () => {
  const CENTER = { lat: -33.8679, lng: 151.211 }
  // The REAL shape: Google Solar flux bbox is projected UTM METRES
  // (verified live 2026-06-13) — a 100 m × 100.5 m box.
  const METRE_BBOX: [number, number, number, number] = [334474, 6251000.5, 334574, 6251101]

  it('centres a panel at the request centre regardless of bbox CRS', () => {
    const panels = [{ center: CENTER, segment_index: 0 }]
    const anchors = projectPlaneAnchors(panels, METRE_BBOX, CENTER)
    expect(anchors).toHaveLength(1)
    expect(anchors[0].x_pct).toBeCloseTo(50, 0)
    expect(anchors[0].y_pct).toBeCloseTo(50, 0)
  })

  it('offsets in metres inside a UTM bbox (east → right, north → up)', () => {
    // ~25 m east of centre: dLng = 25 / (111320 × cos(lat)).
    const dLng = 25 / (111_320 * Math.cos((CENTER.lat * Math.PI) / 180))
    const dLat = 25 / 111_132 // ~25 m north
    const anchors = projectPlaneAnchors(
      [
        { center: { lat: CENTER.lat, lng: CENTER.lng + dLng }, segment_index: 0 },
        { center: { lat: CENTER.lat + dLat, lng: CENTER.lng }, segment_index: 1 },
      ],
      METRE_BBOX,
      CENTER,
    )
    expect(anchors[0].x_pct).toBeCloseTo(75, 0) // 25 m east in a 100 m box
    expect(anchors[0].y_pct).toBeCloseTo(50, 0)
    expect(anchors[1].y_pct).toBeLessThan(50) // north = up = smaller y
  })

  it('also handles a degree-valued bbox', () => {
    const degBbox: [number, number, number, number] = [151.2105, -33.8684, 151.2115, -33.8674]
    const anchors = projectPlaneAnchors(
      [{ center: CENTER, segment_index: 0 }],
      degBbox,
      CENTER,
    )
    expect(anchors).toHaveLength(1)
    expect(anchors[0].x_pct).toBeCloseTo(50, 0)
  })

  it('drops panels outside the raster so labels never float off-image', () => {
    const anchors = projectPlaneAnchors(
      [
        { center: CENTER, segment_index: 0 },
        { center: { lat: -40, lng: 140 }, segment_index: 1 }, // far away
      ],
      METRE_BBOX,
      CENTER,
    )
    expect(anchors).toHaveLength(1)
    expect(anchors[0].plane_index).toBe(0)
  })

  it('returns empty for a null/degenerate bbox or no panels', () => {
    expect(projectPlaneAnchors([], METRE_BBOX, CENTER)).toEqual([])
    expect(projectPlaneAnchors([{ center: CENTER, segment_index: 0 }], null, CENTER)).toEqual([])
    expect(
      projectPlaneAnchors(
        [{ center: CENTER, segment_index: 0 }],
        [334474, 6251000, 334474, 6251000],
        CENTER,
      ),
    ).toEqual([])
  })
})

describe('fluxRasterLatLngBounds', () => {
  const CENTER = { lat: -33.8679, lng: 151.211 }
  // Same UTM-metre bbox shape as projectPlaneAnchors: a 100 m × 100.5 m box.
  const METRE_BBOX: [number, number, number, number] = [334474, 6251000.5, 334574, 6251101]

  it('centres the bounds on the request centre regardless of bbox CRS', () => {
    const b = fluxRasterLatLngBounds(METRE_BBOX, CENTER)
    expect(b).not.toBeNull()
    expect((b!.west + b!.east) / 2).toBeCloseTo(CENTER.lng, 9)
    expect((b!.south + b!.north) / 2).toBeCloseTo(CENTER.lat, 9)
    expect(b!.east).toBeGreaterThan(b!.west)
    expect(b!.north).toBeGreaterThan(b!.south)
  })

  it('spans the bbox metre extents (≈100 m wide, ≈100.5 m tall)', () => {
    const b = fluxRasterLatLngBounds(METRE_BBOX, CENTER)!
    const cosLat = Math.cos((CENTER.lat * Math.PI) / 180)
    const widthM = (b.east - b.west) * 111_320 * cosLat
    const heightM = (b.north - b.south) * 111_132
    expect(widthM).toBeCloseTo(100, 1)
    expect(heightM).toBeCloseTo(100.5, 1)
  })

  it('round-trips an anchor back to its source coordinate', () => {
    // A panel ~25 m east + ~25 m north of centre projects to an x_pct/y_pct;
    // inverse-projecting that through the bounds must return the same coord.
    const dLng = 25 / (111_320 * Math.cos((CENTER.lat * Math.PI) / 180))
    const dLat = 25 / 111_132
    const panel = { lat: CENTER.lat + dLat, lng: CENTER.lng + dLng }
    const [anchor] = projectPlaneAnchors(
      [{ center: panel, segment_index: 0 }],
      METRE_BBOX,
      CENTER,
    )
    const b = fluxRasterLatLngBounds(METRE_BBOX, CENTER)!
    const lng = b.west + (anchor.x_pct / 100) * (b.east - b.west)
    const lat = b.north - (anchor.y_pct / 100) * (b.north - b.south)
    // anchors are rounded to 0.1% (~0.1 m here), so loose tolerance.
    expect(lng).toBeCloseTo(panel.lng, 5)
    expect(lat).toBeCloseTo(panel.lat, 5)
  })

  it('handles a degree-valued bbox', () => {
    const degBbox: [number, number, number, number] = [151.2105, -33.8684, 151.2115, -33.8674]
    const b = fluxRasterLatLngBounds(degBbox, CENTER)
    expect(b).not.toBeNull()
    expect((b!.west + b!.east) / 2).toBeCloseTo(CENTER.lng, 9)
  })

  it('returns null for a null/degenerate bbox or non-finite centre', () => {
    expect(fluxRasterLatLngBounds(null, CENTER)).toBeNull()
    expect(fluxRasterLatLngBounds([334474, 6251000, 334474, 6251000], CENTER)).toBeNull()
    expect(fluxRasterLatLngBounds(METRE_BBOX, { lat: NaN, lng: 151 })).toBeNull()
  })
})

describe('estimateBuildingHeightFromDsm', () => {
  it('derives height from roof p90 minus ground median', () => {
    // 16×16: inner 8×8 block at 26 m (roof), surroundings at 20 m (ground).
    const mask = band(16, 16, (x, y) => (x >= 4 && x < 12 && y >= 4 && y < 12 ? 1 : 0))
    const dsm = band(16, 16, (x, y) => (x >= 4 && x < 12 && y >= 4 && y < 12 ? 26 : 20))
    const res = estimateBuildingHeightFromDsm(dsm, mask)
    expect(res).not.toBeNull()
    expect(res!.height_m).toBe(6)
    expect(res!.storeys_hint).toBe(2)
  })

  it('returns null for tiny populations or implausible deltas', () => {
    const mask = band(2, 2, 1)
    const dsm = band(2, 2, 26)
    expect(estimateBuildingHeightFromDsm(dsm, mask)).toBeNull()

    const bigMask = band(16, 16, (x) => (x < 8 ? 1 : 0))
    const crazyDsm = band(16, 16, (x) => (x < 8 ? 200 : 20))
    expect(estimateBuildingHeightFromDsm(crazyDsm, bigMask)).toBeNull()
  })
})
