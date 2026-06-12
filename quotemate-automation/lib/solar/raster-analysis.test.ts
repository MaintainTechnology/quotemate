import { describe, it, expect } from 'vitest'
import {
  maskAt,
  maskedMean,
  deriveMonthlyProductionWeights,
  monthlyKwhFromWeights,
  analyzeHourlyShade,
  estimateBuildingHeightFromDsm,
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
  // bbox [west, south, east, north] — a 100 m-ish box around Sydney.
  const BBOX: [number, number, number, number] = [151.2, -33.87, 151.21, -33.86]

  it('projects per-plane panel centroids to % coordinates', () => {
    const panels = [
      // Plane 0: two panels straddling the bbox centre horizontally.
      { center: { lat: -33.865, lng: 151.2025 }, segment_index: 0 },
      { center: { lat: -33.865, lng: 151.2075 }, segment_index: 0 },
      // Plane 1: one panel at the exact bbox centre.
      { center: { lat: -33.865, lng: 151.205 }, segment_index: 1 },
    ]
    const anchors = projectPlaneAnchors(panels, BBOX)
    expect(anchors).toHaveLength(2)
    expect(anchors[0].plane_index).toBe(0)
    expect(anchors[0].x_pct).toBeCloseTo(50, 0)
    expect(anchors[0].y_pct).toBeCloseTo(50, 0)
    expect(anchors[1]).toMatchObject({ plane_index: 1 })
    expect(anchors[1].x_pct).toBeCloseTo(50, 0)
  })

  it('drops panels outside the bbox so labels never float off-image', () => {
    const anchors = projectPlaneAnchors(
      [
        { center: { lat: -33.865, lng: 151.205 }, segment_index: 0 },
        { center: { lat: -40, lng: 140 }, segment_index: 1 }, // far away
      ],
      BBOX,
    )
    expect(anchors).toHaveLength(1)
    expect(anchors[0].plane_index).toBe(0)
  })

  it('returns empty for a null/degenerate bbox or no panels', () => {
    expect(projectPlaneAnchors([], BBOX)).toEqual([])
    expect(
      projectPlaneAnchors([{ center: { lat: -33.865, lng: 151.205 }, segment_index: 0 }], null),
    ).toEqual([])
    expect(
      projectPlaneAnchors(
        [{ center: { lat: -33.865, lng: 151.205 }, segment_index: 0 }],
        [151.2, -33.86, 151.2, -33.86],
      ),
    ).toEqual([])
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
