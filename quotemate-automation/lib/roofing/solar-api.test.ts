import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  applySolarInsight,
  declaredFallback,
  enrichMetricsWithSolar,
  fetchBuildingInsights,
  formatImageryDate,
  normaliseQuality,
  parseBuildingInsights,
  pitchDegreesToBucket,
  resolveSolarOpts,
  slopedAreaFromPitchDegrees,
  solarEnabled,
  weightedMeanPitchDegrees,
  type SolarRoofInsight,
} from './solar-api'
import { measureAndPriceRoof } from './measure'
import { MockRoofingProvider } from './providers/mock'
import { slopedAreaFromFootprint } from './pricing'
import type { GeoJSONPolygon, RoofMetrics, RoofUserInputs } from './types'

// ── fixtures ─────────────────────────────────────────────────────────

const SYDNEY_POLYGON: GeoJSONPolygon = {
  type: 'Polygon',
  coordinates: [[
    [151.2093, -33.8688],
    [151.2095, -33.8688],
    [151.2095, -33.8690],
    [151.2093, -33.8690],
    [151.2093, -33.8688],
  ]],
}

function metrics(overrides: Partial<RoofMetrics> = {}): RoofMetrics {
  return {
    footprint_m2: 200,
    sloped_area_m2: 220,
    storeys: 1,
    form: 'hip',
    hips: 4,
    valleys: 0,
    ridge_lm: null,
    polygon_geojson: SYDNEY_POLYGON,
    capture_date: '2025-06-01',
    buildingId: 'bld-1',
    ...overrides,
  }
}

function inputs(overrides: Partial<RoofUserInputs> = {}): RoofUserInputs {
  return { material: 'colorbond_trimdek', pitch: 'standard', intent: 'full_reroof', ...overrides }
}

function insightFixture(overrides: Partial<SolarRoofInsight> = {}): SolarRoofInsight {
  return {
    segments: [{ pitchDegrees: 22, azimuthDegrees: 124, areaMeters2: 100 }],
    segmentCount: 1,
    weightedMeanPitchDegrees: 22,
    imageryQuality: 'HIGH',
    imageryDate: '2022-07-05',
    ...overrides,
  }
}

function buildingInsightsBody(opts: {
  quality?: string
  segments?: Array<{ pitchDegrees?: unknown; azimuthDegrees?: unknown; areaMeters2?: unknown }>
} = {}): unknown {
  const segs = opts.segments ?? [
    { pitchDegrees: 17.5, azimuthDegrees: 124.3, areaMeters2: 50 },
    { pitchDegrees: 25.0, azimuthDegrees: 304.0, areaMeters2: 50 },
  ]
  return {
    imageryQuality: opts.quality ?? 'HIGH',
    imageryDate: { year: 2022, month: 7, day: 5 },
    solarPotential: {
      roofSegmentStats: segs.map((s) => ({
        pitchDegrees: s.pitchDegrees,
        azimuthDegrees: s.azimuthDegrees,
        stats: s.areaMeters2 === undefined ? {} : { areaMeters2: s.areaMeters2 },
      })),
    },
  }
}

/** Minimal Response stand-in so tests don't depend on global undici. */
function makeRes(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  } as unknown as Response
}

const RESOLVED = (over: Parameters<typeof resolveSolarOpts>[0] = {}) =>
  resolveSolarOpts({ apiKey: 'test-key', acceptQualities: ['HIGH', 'MEDIUM'], ...over })

// ── pure geometry ────────────────────────────────────────────────────

describe('slopedAreaFromPitchDegrees', () => {
  it('returns the footprint unchanged at 0°', () => {
    expect(slopedAreaFromPitchDegrees(200, 0)).toBe(200)
  })
  it('scales by 1/cos(θ)', () => {
    // 1/cos(22°) ≈ 1.0785 → 200 × ≈ 215.7
    expect(slopedAreaFromPitchDegrees(200, 22)).toBeCloseTo(215.7, 0)
  })
  it('is always ≥ footprint for positive pitch', () => {
    expect(slopedAreaFromPitchDegrees(150, 30)!).toBeGreaterThan(150)
  })
  it('guards bad inputs with null', () => {
    expect(slopedAreaFromPitchDegrees(0, 22)).toBeNull()
    expect(slopedAreaFromPitchDegrees(200, 90)).toBeNull()
    expect(slopedAreaFromPitchDegrees(200, -5)).toBeNull()
    expect(slopedAreaFromPitchDegrees(200, NaN)).toBeNull()
  })
})

describe('weightedMeanPitchDegrees', () => {
  it('averages equal-area segments', () => {
    expect(
      weightedMeanPitchDegrees([
        { pitchDegrees: 10, azimuthDegrees: null, areaMeters2: 100 },
        { pitchDegrees: 30, azimuthDegrees: null, areaMeters2: 100 },
      ]),
    ).toBe(20)
  })
  it('weights by area', () => {
    expect(
      weightedMeanPitchDegrees([
        { pitchDegrees: 10, azimuthDegrees: null, areaMeters2: 100 },
        { pitchDegrees: 30, azimuthDegrees: null, areaMeters2: 300 },
      ]),
    ).toBe(25)
  })
  it('ignores zero-area / invalid segments and returns null when none usable', () => {
    expect(
      weightedMeanPitchDegrees([
        { pitchDegrees: 20, azimuthDegrees: null, areaMeters2: 0 },
        { pitchDegrees: NaN, azimuthDegrees: null, areaMeters2: 50 },
      ]),
    ).toBeNull()
  })
})

describe('pitchDegreesToBucket', () => {
  it('maps to the types.ts ranges', () => {
    expect(pitchDegreesToBucket(15)).toBe('shallow')
    expect(pitchDegreesToBucket(19.9)).toBe('shallow')
    expect(pitchDegreesToBucket(20)).toBe('standard')
    expect(pitchDegreesToBucket(25)).toBe('standard')
    expect(pitchDegreesToBucket(25.1)).toBe('steep')
    expect(pitchDegreesToBucket(35)).toBe('steep')
    expect(pitchDegreesToBucket(35.1)).toBe('very_steep')
    expect(pitchDegreesToBucket(-1)).toBe('unknown')
  })
})

// ── parsing ──────────────────────────────────────────────────────────

describe('parseBuildingInsights', () => {
  it('extracts segments, weighted pitch, quality and date', () => {
    const insight = parseBuildingInsights(buildingInsightsBody())
    expect(insight).not.toBeNull()
    expect(insight!.segmentCount).toBe(2)
    expect(insight!.weightedMeanPitchDegrees).toBeCloseTo(21.25, 2)
    expect(insight!.imageryQuality).toBe('HIGH')
    expect(insight!.imageryDate).toBe('2022-07-05')
  })
  it('falls back to groundAreaMeters2 then segment-level area', () => {
    const body = {
      imageryQuality: 'MEDIUM',
      solarPotential: {
        roofSegmentStats: [{ pitchDegrees: 20, stats: { groundAreaMeters2: 40 } }],
      },
    }
    const insight = parseBuildingInsights(body)
    expect(insight!.segments[0].areaMeters2).toBe(40)
  })
  it('tolerates a { data: {...} } envelope', () => {
    expect(parseBuildingInsights({ data: buildingInsightsBody() })).not.toBeNull()
  })
  it('returns null when there are no usable segments', () => {
    expect(parseBuildingInsights({ solarPotential: { roofSegmentStats: [] } })).toBeNull()
    expect(parseBuildingInsights({ solarPotential: { roofSegmentStats: [{ stats: { areaMeters2: 5 } }] } })).toBeNull()
    expect(parseBuildingInsights(null)).toBeNull()
    expect(parseBuildingInsights({})).toBeNull()
  })
})

describe('formatImageryDate / normaliseQuality', () => {
  it('zero-pads month and day', () => {
    expect(formatImageryDate({ year: 2023, month: 3, day: 9 })).toBe('2023-03-09')
  })
  it('defaults missing month/day', () => {
    expect(formatImageryDate({ year: 2023 })).toBe('2023-01-01')
  })
  it('returns null without a year', () => {
    expect(formatImageryDate({ month: 5 })).toBeNull()
    expect(formatImageryDate(null)).toBeNull()
  })
  it('degrades unknown quality to LOW', () => {
    expect(normaliseQuality('HIGH')).toBe('HIGH')
    expect(normaliseQuality('weird')).toBe('LOW')
    expect(normaliseQuality(undefined)).toBe('LOW')
  })
})

// ── pure enrichment ──────────────────────────────────────────────────

describe('applySolarInsight', () => {
  it('applies measured pitch to the footprint and stamps provenance', () => {
    const out = applySolarInsight(metrics({ footprint_m2: 200 }), inputs({ pitch: 'standard' }), insightFixture({ weightedMeanPitchDegrees: 22 }))
    expect(out.applied).toBe(true)
    expect(out.metrics.pitch_source).toBe('measured')
    expect(out.metrics.pitch_degrees).toBe(22)
    expect(out.metrics.imagery_quality).toBe('HIGH')
    expect(out.metrics.imagery_date).toBe('2022-07-05')
    expect(out.metrics.roof_segment_count).toBe(1)
    expect(out.metrics.sloped_area_m2).toBeCloseTo(215.7, 0)
    // 22° → 'standard', equals declared → no override warning
    expect(out.inputs.pitch).toBe('standard')
    expect(out.warnings).toHaveLength(0)
  })

  it('warns and overrides when the measured bucket differs from declared', () => {
    const out = applySolarInsight(metrics(), inputs({ pitch: 'shallow' }), insightFixture({ weightedMeanPitchDegrees: 30 }))
    expect(out.inputs.pitch).toBe('steep')
    expect(out.warnings.join(' ')).toContain('overrides the declared "shallow"')
  })

  it('routes a measured very-steep roof to inspection (null area + very_steep input)', () => {
    const out = applySolarInsight(metrics(), inputs({ pitch: 'standard' }), insightFixture({ weightedMeanPitchDegrees: 42 }))
    expect(out.metrics.sloped_area_m2).toBeNull()
    expect(out.inputs.pitch).toBe('very_steep')
    expect(out.warnings.join(' ').toLowerCase()).toContain('inspection')
  })

  it('rescues an unknown declared pitch with a measured one', () => {
    const out = applySolarInsight(metrics(), inputs({ pitch: 'unknown' }), insightFixture({ weightedMeanPitchDegrees: 22 }))
    expect(out.inputs.pitch).toBe('standard')
    expect(out.metrics.sloped_area_m2).not.toBeNull()
  })
})

describe('declaredFallback', () => {
  it('matches the pre-Solar declared-pitch sloped area and flags provenance', () => {
    const out = declaredFallback(metrics(), inputs({ pitch: 'steep' }), 'no coverage')
    expect(out.applied).toBe(false)
    expect(out.metrics.pitch_source).toBe('declared')
    expect(out.metrics.sloped_area_m2).toBe(slopedAreaFromFootprint(200, 'steep'))
    expect(out.inputs.pitch).toBe('steep')
    expect(out.warnings).toEqual(['no coverage'])
  })
})

// ── I/O client ───────────────────────────────────────────────────────

describe('fetchBuildingInsights', () => {
  it('returns the parsed insight on 200', async () => {
    const fetchImpl = vi.fn(async (_u: RequestInfo | URL, _init?: RequestInit) => makeRes(buildingInsightsBody()))
    const res = await fetchBuildingInsights({ lat: -33.8, lng: 151.2 }, RESOLVED({ fetchImpl }))
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.insight.segmentCount).toBe(2)
    // location + key in the query string
    const url = String(fetchImpl.mock.calls[0][0])
    expect(url).toContain('location.latitude=-33.8000000')
    expect(url).toContain('key=test-key')
  })
  it('maps 404 to no_coverage', async () => {
    const res = await fetchBuildingInsights({ lat: -33.8, lng: 151.2 }, RESOLVED({ fetchImpl: async () => makeRes({}, 404) }))
    expect(res).toMatchObject({ ok: false, code: 'no_coverage' })
  })
  it('maps other HTTP errors to http_error', async () => {
    const res = await fetchBuildingInsights({ lat: -33.8, lng: 151.2 }, RESOLVED({ fetchImpl: async () => makeRes({}, 500) }))
    expect(res).toMatchObject({ ok: false, code: 'http_error' })
  })
  it('maps a thrown fetch to network_error', async () => {
    const res = await fetchBuildingInsights({ lat: -33.8, lng: 151.2 }, RESOLVED({ fetchImpl: async () => { throw new Error('boom') } }))
    expect(res).toMatchObject({ ok: false, code: 'network_error' })
  })
  it('refuses without a key', async () => {
    const res = await fetchBuildingInsights({ lat: -33.8, lng: 151.2 }, resolveSolarOpts({ apiKey: undefined, fetchImpl: async () => makeRes({}) }))
    expect(res).toMatchObject({ ok: false, code: 'no_key' })
  })
})

// ── enrichment orchestration (I/O + fallback) ────────────────────────

describe('enrichMetricsWithSolar', () => {
  it('applies measured pitch when imagery quality is accepted', async () => {
    const fetchImpl = vi.fn(async () => makeRes(buildingInsightsBody({ quality: 'HIGH' })))
    const out = await enrichMetricsWithSolar(metrics(), inputs(), RESOLVED({ fetchImpl }))
    expect(out.applied).toBe(true)
    expect(out.metrics.pitch_source).toBe('measured')
  })

  it('falls back to declared pitch when quality is below threshold', async () => {
    const fetchImpl = vi.fn(async () => makeRes(buildingInsightsBody({ quality: 'LOW' })))
    const out = await enrichMetricsWithSolar(metrics(), inputs({ pitch: 'standard' }), RESOLVED({ fetchImpl }))
    expect(out.applied).toBe(false)
    expect(out.metrics.pitch_source).toBe('declared')
    expect(out.metrics.sloped_area_m2).toBe(slopedAreaFromFootprint(200, 'standard'))
    expect(out.warnings.join(' ')).toContain('LOW')
  })

  it('falls back on no coverage (404)', async () => {
    const out = await enrichMetricsWithSolar(metrics(), inputs(), RESOLVED({ fetchImpl: async () => makeRes({}, 404) }))
    expect(out.applied).toBe(false)
    expect(out.warnings.join(' ')).toContain('no_coverage')
  })

  it('falls back when there is no polygon to locate and never calls fetch', async () => {
    const fetchImpl = vi.fn(async () => makeRes(buildingInsightsBody()))
    const out = await enrichMetricsWithSolar(metrics({ polygon_geojson: null }), inputs(), RESOLVED({ fetchImpl }))
    expect(out.applied).toBe(false)
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(out.metrics.pitch_source).toBe('declared')
  })
})

// ── config resolution ────────────────────────────────────────────────

describe('resolveSolarOpts / solarEnabled', () => {
  const prev = {
    flag: process.env.ROOFING_SOLAR_ENRICHMENT,
    solarKey: process.env.GOOGLE_SOLAR_API_KEY,
    mapsKey: process.env.GOOGLE_MAPS_API_KEY,
  }
  afterEach(() => {
    process.env.ROOFING_SOLAR_ENRICHMENT = prev.flag
    process.env.GOOGLE_SOLAR_API_KEY = prev.solarKey
    process.env.GOOGLE_MAPS_API_KEY = prev.mapsKey
  })

  it('is disabled by default even when a key exists', () => {
    delete process.env.ROOFING_SOLAR_ENRICHMENT
    process.env.GOOGLE_MAPS_API_KEY = 'k'
    expect(solarEnabled()).toBe(false)
  })
  it('is enabled only with the flag AND a key', () => {
    process.env.ROOFING_SOLAR_ENRICHMENT = 'true'
    delete process.env.GOOGLE_SOLAR_API_KEY
    delete process.env.GOOGLE_MAPS_API_KEY
    expect(solarEnabled()).toBe(false)
    process.env.GOOGLE_MAPS_API_KEY = 'k'
    expect(solarEnabled()).toBe(true)
  })
  it('prefers the dedicated GOOGLE_SOLAR_API_KEY', () => {
    process.env.GOOGLE_SOLAR_API_KEY = 'solar'
    process.env.GOOGLE_MAPS_API_KEY = 'maps'
    expect(resolveSolarOpts().apiKey).toBe('solar')
  })
  it('honours an explicit override', () => {
    expect(solarEnabled({ enabled: true, apiKey: 'x' })).toBe(true)
    expect(solarEnabled({ enabled: false, apiKey: 'x' })).toBe(false)
  })
})

// ── orchestrator integration ─────────────────────────────────────────

describe('measureAndPriceRoof with Solar enrichment', () => {
  it('uses measured pitch end-to-end when enabled', async () => {
    const fetchImpl = vi.fn(async () => makeRes(buildingInsightsBody({ quality: 'HIGH' })))
    const result = await measureAndPriceRoof(
      { address: '1 Test St, Sydney', postcode: '2000', state: 'NSW' },
      inputs({ pitch: 'shallow' }),
      { provider: new MockRoofingProvider(), solar: { enabled: true, apiKey: 'k', fetchImpl } },
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(result.metrics.pitch_source).toBe('measured')
    expect(result.metrics.pitch_degrees).toBe(21.3) // round1(21.25)
    // 21.25° → 'standard' overrides the declared 'shallow'
    expect(result.warnings.join(' ')).toContain('overrides the declared "shallow"')
  })

  it('makes NO Solar call and leaves provenance unset when disabled (default path)', async () => {
    const fetchImpl = vi.fn(async () => makeRes(buildingInsightsBody()))
    const result = await measureAndPriceRoof(
      { address: '1 Test St, Sydney', postcode: '2000', state: 'NSW' },
      inputs({ pitch: 'standard' }),
      { provider: new MockRoofingProvider(), solar: { enabled: false, apiKey: 'k', fetchImpl } },
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(result.metrics.pitch_source).toBeUndefined()
  })
})
