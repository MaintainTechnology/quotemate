import { describe, expect, it } from 'vitest'
import {
  EMPTY_SOLAR_DETECTION,
  SOLAR_ALLOWANCE_DEFAULTS,
  aggregateSolarDetections,
  buildPhotoSolarDetectPrompt,
  buildSolarDetectPrompt,
  buildSolarSummaryNote,
  computeSolarAllowance,
  mergeSolarDetections,
  parseSolarDetection,
  solarAllowanceConfigFromCard,
} from './solar'
import { DEFAULT_ROOFING_RATE_CARD } from './pricing'
import type { SolarDetection } from './solar'
import type { RoofingRateCard } from './types'

function detection(overrides: Partial<SolarDetection> = {}): SolarDetection {
  return {
    has_solar: true,
    array_count: 2,
    panel_count_estimate: 40,
    approx_area_m2: 68,
    has_skylight: false,
    skylight_count: 0,
    confidence: 'high',
    notes: 'two arrays',
    summary_note: 'Identified 2 solar panel arrays (high confidence)',
    source: 'aerial',
    ...overrides,
  }
}

describe('buildSolarDetectPrompt', () => {
  it('asks for strict JSON about the centre building', () => {
    const p = buildSolarDetectPrompt()
    expect(p.toLowerCase()).toContain('centre')
    expect(p).toContain('has_solar')
    expect(p.toLowerCase()).toContain('json')
  })
})

describe('parseSolarDetection', () => {
  it('parses clean JSON', () => {
    const d = parseSolarDetection('{"has_solar":true,"array_count":2,"panel_count_estimate":40,"approx_area_m2":68,"confidence":"high","notes":"x"}')
    expect(d?.has_solar).toBe(true)
    expect(d?.array_count).toBe(2)
    expect(d?.confidence).toBe('high')
  })

  it('strips ```json code fences', () => {
    const d = parseSolarDetection('```json\n{"has_solar":false,"array_count":0,"confidence":"high","notes":""}\n```')
    expect(d?.has_solar).toBe(false)
    expect(d?.array_count).toBe(0)
  })

  it('defaults array_count to 1 when solar present but count missing', () => {
    const d = parseSolarDetection('{"has_solar":true,"confidence":"medium","notes":""}')
    expect(d?.array_count).toBe(1)
  })

  it('coerces an unknown confidence to low', () => {
    const d = parseSolarDetection('{"has_solar":true,"array_count":1,"confidence":"definitely","notes":""}')
    expect(d?.confidence).toBe('low')
  })

  it('returns null for non-JSON or missing has_solar', () => {
    expect(parseSolarDetection('not json')).toBeNull()
    expect(parseSolarDetection('{"array_count":2}')).toBeNull()
    expect(parseSolarDetection('')).toBeNull()
  })
})

describe('computeSolarAllowance', () => {
  it('returns null when there is no solar', () => {
    expect(computeSolarAllowance(detection({ has_solar: false }), { intent: 'full_reroof' })).toBeNull()
    expect(computeSolarAllowance(null, { intent: 'full_reroof' })).toBeNull()
  })

  it('applies on a high-confidence full re-roof and prices base + per-array', () => {
    const a = computeSolarAllowance(detection({ array_count: 2 }), { intent: 'full_reroof' })
    expect(a?.applies).toBe(true)
    // base 1000 + 700 × 2 = 2400 ex; ×1.1 = 2640 inc
    expect(a?.ex_gst).toBe(2400)
    expect(a?.inc_gst).toBe(2640)
    expect(a?.arrays).toBe(2)
    expect(a?.electrician_note.toLowerCase()).toContain('electrician')
  })

  it('flags but does NOT apply on low confidence', () => {
    const a = computeSolarAllowance(detection({ confidence: 'low' }), { intent: 'full_reroof' })
    expect(a?.applies).toBe(false)
    expect(a?.low_confidence).toBe(true)
  })

  it('does NOT apply on a non-reroof intent (patch/leak does not disturb panels)', () => {
    const a = computeSolarAllowance(detection(), { intent: 'leak_trace' })
    expect(a?.applies).toBe(false)
  })

  it('respects tenant-configured base + per-array and gst flag', () => {
    const a = computeSolarAllowance(detection({ array_count: 1 }), {
      intent: 'full_reroof',
      base_ex_gst: 1500,
      per_array_ex_gst: 500,
      gstRegistered: false,
    })
    // 1500 + 500 × 1 = 2000 ex; not GST registered → inc == ex
    expect(a?.ex_gst).toBe(2000)
    expect(a?.inc_gst).toBe(2000)
  })
})

describe('solarAllowanceConfigFromCard', () => {
  it('falls back to defaults on a plain card', () => {
    const cfg = solarAllowanceConfigFromCard(DEFAULT_ROOFING_RATE_CARD)
    expect(cfg.base_ex_gst).toBe(SOLAR_ALLOWANCE_DEFAULTS.base_ex_gst)
    expect(cfg.per_array_ex_gst).toBe(SOLAR_ALLOWANCE_DEFAULTS.per_array_ex_gst)
  })

  it('reads stashed overlay values', () => {
    const card = {
      ...DEFAULT_ROOFING_RATE_CARD,
      solar_detach_reinstate_base_ex_gst: 1200,
      solar_detach_reinstate_per_array_ex_gst: 800,
    } as RoofingRateCard
    const cfg = solarAllowanceConfigFromCard(card)
    expect(cfg.base_ex_gst).toBe(1200)
    expect(cfg.per_array_ex_gst).toBe(800)
  })
})

describe('skylight detection', () => {
  it('aerial prompt asks for both solar and skylights as strict JSON', () => {
    const p = buildSolarDetectPrompt().toLowerCase()
    expect(p).toContain('skylight')
    expect(p).toContain('has_skylight')
    expect(p).toContain('json')
  })

  it('photo prompt asks for both solar and skylights as strict JSON', () => {
    const p = buildPhotoSolarDetectPrompt().toLowerCase()
    expect(p).toContain('skylight')
    expect(p).toContain('photo')
    expect(p).toContain('json')
  })

  it('parses skylight fields and defaults count when only the boolean is set', () => {
    const d = parseSolarDetection(
      '{"has_solar":false,"array_count":0,"has_skylight":true,"confidence":"medium","notes":""}',
    )
    expect(d?.has_skylight).toBe(true)
    expect(d?.skylight_count).toBe(1)
  })

  it('treats a missing skylight field as no skylight (back-compat)', () => {
    const d = parseSolarDetection('{"has_solar":true,"array_count":1,"confidence":"high","notes":""}')
    expect(d?.has_skylight).toBe(false)
    expect(d?.skylight_count).toBe(0)
  })

  it('tags the source it was parsed from', () => {
    const a = parseSolarDetection('{"has_solar":true,"array_count":1,"confidence":"high","notes":""}')
    const p = parseSolarDetection('{"has_solar":true,"array_count":1,"confidence":"high","notes":""}', 'photo')
    expect(a?.source).toBe('aerial')
    expect(p?.source).toBe('photo')
  })
})

describe('buildSolarSummaryNote', () => {
  it('uses confident wording for a high-confidence solar read', () => {
    const note = buildSolarSummaryNote({ has_solar: true, array_count: 2, has_skylight: false, skylight_count: 0, confidence: 'high' })
    expect(note).toBe('Identified 2 solar panel arrays (high confidence)')
  })

  it('hedges and flags verify-on-site for low confidence', () => {
    const note = buildSolarSummaryNote({ has_solar: false, array_count: 0, has_skylight: true, skylight_count: 1, confidence: 'low' })
    expect(note).toContain('What appears to be')
    expect(note).toContain('1 skylight')
    expect(note.toLowerCase()).toContain('verify on site')
  })

  it('combines solar and skylights in one line', () => {
    const note = buildSolarSummaryNote({ has_solar: true, array_count: 1, has_skylight: true, skylight_count: 2, confidence: 'medium' })
    expect(note).toContain('1 solar panel array')
    expect(note).toContain('2 skylights')
    expect(note).toContain('and')
  })

  it('says nothing was found when clear', () => {
    expect(buildSolarSummaryNote({ has_solar: false, array_count: 0, has_skylight: false, skylight_count: 0, confidence: 'high' }))
      .toBe('No existing solar panels or skylights detected.')
    expect(EMPTY_SOLAR_DETECTION.summary_note).toBe('No existing solar panels or skylights detected.')
  })

  it('parseSolarDetection populates summary_note', () => {
    const d = parseSolarDetection('{"has_solar":true,"array_count":3,"confidence":"high","notes":""}')
    expect(d?.summary_note).toBe('Identified 3 solar panel arrays (high confidence)')
  })
})

describe('mergeSolarDetections', () => {
  it('returns the only present side untouched', () => {
    const a = detection({ source: 'aerial' })
    expect(mergeSolarDetections(a, null)).toBe(a)
    expect(mergeSolarDetections(null, a)).toBe(a)
    expect(mergeSolarDetections(null, null)).toBeNull()
  })

  it('OR-es the booleans and takes counts from the higher-confidence source', () => {
    const aerial = detection({ has_solar: true, array_count: 2, confidence: 'medium', has_skylight: false })
    const photo = detection({ has_solar: true, array_count: 4, confidence: 'high', has_skylight: true, skylight_count: 1, source: 'photo' })
    const m = mergeSolarDetections(aerial, photo)
    expect(m?.source).toBe('merged')
    expect(m?.has_solar).toBe(true)
    expect(m?.has_skylight).toBe(true)
    // photo is higher confidence → its array count wins
    expect(m?.array_count).toBe(4)
    expect(m?.confidence).toBe('high')
  })

  it('drops confidence to low when the sources disagree on solar presence', () => {
    const aerial = detection({ has_solar: true, array_count: 2, confidence: 'high' })
    const photo = detection({ has_solar: false, array_count: 0, confidence: 'high', source: 'photo' })
    const m = mergeSolarDetections(aerial, photo)
    expect(m?.has_solar).toBe(true) // OR
    expect(m?.confidence).toBe('low') // disagreement hedges down
  })

  it('falls back to the other source count when the higher-confidence source missed the feature', () => {
    const aerial = detection({ has_solar: true, array_count: 3, confidence: 'low' })
    const photo = detection({ has_solar: false, array_count: 0, confidence: 'high', source: 'photo' })
    const m = mergeSolarDetections(aerial, photo)
    expect(m?.has_solar).toBe(true)
    expect(m?.array_count).toBe(3)
  })
})

describe('aggregateSolarDetections (per-structure → job level)', () => {
  it('returns null when nothing is present', () => {
    expect(aggregateSolarDetections([])).toBeNull()
    expect(aggregateSolarDetections([null, null])).toBeNull()
  })

  it('sums arrays and skylights across structures', () => {
    const house = detection({ has_solar: true, array_count: 2, confidence: 'high' })
    const shed = detection({ has_solar: true, array_count: 1, confidence: 'medium', has_skylight: true, skylight_count: 1, source: 'aerial' })
    const agg = aggregateSolarDetections([house, shed])
    expect(agg?.has_solar).toBe(true)
    expect(agg?.array_count).toBe(3) // 2 + 1 across structures
    expect(agg?.has_skylight).toBe(true)
    expect(agg?.skylight_count).toBe(1)
    // conservative — lowest confidence among solar structures
    expect(agg?.confidence).toBe('medium')
  })

  it('a summed multi-structure detection prices every array in the allowance', () => {
    const house = detection({ has_solar: true, array_count: 2, confidence: 'high' })
    const shed = detection({ has_solar: true, array_count: 1, confidence: 'high', source: 'aerial' })
    const agg = aggregateSolarDetections([house, shed])
    const a = computeSolarAllowance(agg, { intent: 'full_reroof' })
    // base 1000 + 700 × 3 = 3100 ex
    expect(a?.ex_gst).toBe(3100)
    expect(a?.applies).toBe(true)
  })

  it('ignores structures with no solar/skylights', () => {
    const house = detection({ has_solar: true, array_count: 1, confidence: 'high' })
    const clear = detection({ has_solar: false, array_count: 0, has_skylight: false, skylight_count: 0, confidence: 'high', source: 'aerial' })
    const agg = aggregateSolarDetections([house, clear])
    expect(agg?.array_count).toBe(1)
  })
})
