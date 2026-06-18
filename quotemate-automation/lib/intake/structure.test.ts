// Unit tests for the structurer's pure requested_specs parser.
//
// The structureIntake() call itself hits Anthropic (integration-level), so
// these tests pin the deterministic post-processing: the requested_specs_json
// blob the model emits must degrade to {} on anything malformed and never
// throw (degrade-never-block).

import { describe, expect, it } from 'vitest'
import {
  parseRequestedSpecs,
  normaliseSystemType,
  deriveSystemType,
  finaliseIntake,
} from './structure'
import { IntakeSchema } from './schema'

// Minimal valid StructureSchema-shaped object the model would emit, with
// scope.requested_specs_json as the REQUIRED capture channel. Tests override
// pieces as needed.
function rawObject(over: Record<string, unknown> = {}) {
  const { scope: scopeOver, ...rest } = over
  const scope = {
    description: 'hot water unit died',
    requested_specs_json: '{}',
    ...((scopeOver as Record<string, unknown>) ?? {}),
  }
  return {
    job_type: 'hot_water',
    address: '1 Test St',
    suburb: 'Coorparoo',
    scope,
    risks: [],
    inspection_required: false,
    caller: { name: 'Sam', phone: '0400000000' },
    confidence: 'HIGH',
    confidence_reason: 'all fields captured',
    ...rest,
  }
}

describe('parseRequestedSpecs', () => {
  it('parses a well-formed JSON object string', () => {
    expect(parseRequestedSpecs('{"amperage":"15A"}')).toEqual({ amperage: '15A' })
    expect(parseRequestedSpecs('{"energy_source":"gas","litres":"250"}')).toEqual({
      energy_source: 'gas',
      litres: '250',
    })
  })

  it('returns {} for empty / "{}" / whitespace', () => {
    expect(parseRequestedSpecs('{}')).toEqual({})
    expect(parseRequestedSpecs('')).toEqual({})
    expect(parseRequestedSpecs('   ')).toEqual({})
  })

  it('returns {} for malformed JSON (never throws)', () => {
    expect(parseRequestedSpecs('{not json')).toEqual({})
    expect(parseRequestedSpecs('15A')).toEqual({})
  })

  it('returns {} for null / undefined / non-object JSON', () => {
    expect(parseRequestedSpecs(null)).toEqual({})
    expect(parseRequestedSpecs(undefined)).toEqual({})
    expect(parseRequestedSpecs('"a string"')).toEqual({})
    expect(parseRequestedSpecs('[1,2,3]')).toEqual({})
    expect(parseRequestedSpecs('42')).toEqual({})
  })

  it('coerces numeric / boolean values to strings', () => {
    expect(parseRequestedSpecs('{"litres":250,"smart":true}')).toEqual({
      litres: '250',
      smart: 'true',
    })
  })

  it('skips nested objects, arrays and null values, trims strings', () => {
    expect(
      parseRequestedSpecs('{"amperage":" 15A ","x":{"a":1},"y":[1],"z":null,"blank":"  "}'),
    ).toEqual({ amperage: '15A' })
  })

  it('accepts an already-parsed object (defensive)', () => {
    expect(parseRequestedSpecs({ ip_rating: 'IP56' })).toEqual({ ip_rating: 'IP56' })
  })
})

// ── R26 / WP5: hot-water system_type capture ─────────────────────────────

describe('normaliseSystemType', () => {
  it('maps electric wording', () => {
    expect(normaliseSystemType('electric')).toBe('electric')
    expect(normaliseSystemType('Electric Storage')).toBe('electric')
    expect(normaliseSystemType('resistive')).toBe('electric')
  })

  it('maps gas wording (incl. continuous flow / instant / LPG)', () => {
    expect(normaliseSystemType('gas')).toBe('gas')
    expect(normaliseSystemType('Gas Storage')).toBe('gas')
    expect(normaliseSystemType('continuous flow')).toBe('gas')
    expect(normaliseSystemType('instant gas')).toBe('gas')
    expect(normaliseSystemType('LPG')).toBe('gas')
  })

  it('maps heat pump wording and never collapses it into electric', () => {
    expect(normaliseSystemType('heat pump')).toBe('heat_pump')
    expect(normaliseSystemType('heat_pump')).toBe('heat_pump')
    expect(normaliseSystemType('heat-pump HWS')).toBe('heat_pump')
    expect(normaliseSystemType('heatpump')).toBe('heat_pump')
  })

  it('E8: returns undefined for unknown / unmappable / non-string (never guesses)', () => {
    expect(normaliseSystemType('')).toBeUndefined()
    expect(normaliseSystemType('   ')).toBeUndefined()
    expect(normaliseSystemType('not sure')).toBeUndefined()
    expect(normaliseSystemType('solar thermal')).toBeUndefined()
    expect(normaliseSystemType(undefined)).toBeUndefined()
    expect(normaliseSystemType(null)).toBeUndefined()
    expect(normaliseSystemType(250)).toBeUndefined()
  })
})

describe('deriveSystemType', () => {
  it('reads the system_type key', () => {
    expect(deriveSystemType({ system_type: 'gas' })).toBe('gas')
  })
  it('falls back to the energy_source synonym', () => {
    expect(deriveSystemType({ energy_source: 'heat pump' })).toBe('heat_pump')
  })
  it('prefers system_type over energy_source when both present', () => {
    expect(deriveSystemType({ system_type: 'electric', energy_source: 'gas' })).toBe('electric')
  })
  it('E8: undefined when neither yields a recognised fuel', () => {
    expect(deriveSystemType({})).toBeUndefined()
    expect(deriveSystemType({ litres: '250' })).toBeUndefined()
    expect(deriveSystemType({ system_type: 'dunno' })).toBeUndefined()
  })
})

describe('finaliseIntake — hot_water grounding', () => {
  it('captured system_type=electric grounds: typed field set, auto-quote preserved', () => {
    const out = finaliseIntake(
      rawObject({ scope: { description: 'electric storage HWS died', requested_specs_json: '{"system_type":"electric","litres":"250"}' } }) as any,
    )
    expect(out.trade).toBe('plumbing')
    expect((out.scope as any).specs.system_type).toBe('electric')
    expect((out.scope as any).specs.requested_specs).toEqual({ system_type: 'electric', litres: '250' })
    // electric HWS is always_inspection=false → must NOT be escalated by E8
    expect(out.inspection_required).toBe(false)
    expect(out.confidence).toBe('HIGH')
  })

  it('captured system_type=heat_pump grounds and stays auto-quoteable', () => {
    const out = finaliseIntake(
      rawObject({ scope: { description: 'want a heat pump HWS', requested_specs_json: '{"system_type":"heat pump"}' } }) as any,
    )
    expect((out.scope as any).specs.system_type).toBe('heat_pump')
    expect(out.inspection_required).toBe(false)
    expect(out.confidence).toBe('HIGH')
  })

  it('captured via energy_source synonym still grounds', () => {
    const out = finaliseIntake(
      rawObject({ scope: { description: '250L gas hot water', requested_specs_json: '{"energy_source":"gas","litres":"250"}' } }) as any,
    )
    expect((out.scope as any).specs.system_type).toBe('gas')
  })

  it('E8: unknown system_type does NOT silently pick gas/electric — escalates to inspection at LOW', () => {
    const out = finaliseIntake(
      rawObject({ scope: { description: 'no hot water, unit died this morning', requested_specs_json: '{}' } }) as any,
    )
    expect(out.trade).toBe('plumbing')
    // No fuel was invented anywhere
    expect((out.scope as any).specs?.system_type).toBeUndefined()
    // E8 backstop fired
    expect(out.inspection_required).toBe(true)
    expect(out.confidence).toBe('LOW')
    expect(String(out.confidence_reason).toLowerCase()).toContain('energy source')
  })

  it('E8: unknown fuel but other specs present still escalates and never fabricates a fuel', () => {
    const out = finaliseIntake(
      rawObject({ scope: { description: '250L hot water replacement', requested_specs_json: '{"litres":"250"}' } }) as any,
    )
    expect((out.scope as any).specs.requested_specs).toEqual({ litres: '250' })
    expect((out.scope as any).specs.system_type).toBeUndefined()
    expect(out.inspection_required).toBe(true)
    expect(out.confidence).toBe('LOW')
  })

  it('E8 reason preservation: keeps the model reason when it already names the gap', () => {
    const out = finaliseIntake(
      rawObject({
        confidence: 'LOW',
        confidence_reason: 'customer did not state the hot water energy source',
        scope: { description: 'no hot water', requested_specs_json: '{}' },
      }) as any,
    )
    expect(out.confidence_reason).toBe('customer did not state the hot water energy source')
  })

  it('does NOT escalate non-hot_water plumbing jobs that omit system_type', () => {
    const out = finaliseIntake(
      rawObject({ job_type: 'blocked_drain', scope: { description: 'kitchen drain blocked', requested_specs_json: '{}' } }) as any,
    )
    expect(out.trade).toBe('plumbing')
    expect(out.inspection_required).toBe(false)
    expect(out.confidence).toBe('HIGH')
  })

  it('does NOT escalate electrical jobs (system_type is plumbing-only)', () => {
    const out = finaliseIntake(
      rawObject({ job_type: 'downlights', scope: { description: '6 downlights', requested_specs_json: '{}' } }) as any,
    )
    expect(out.trade).toBe('electrical')
    expect(out.inspection_required).toBe(false)
  })

  it('spec-free intake keeps scope.specs absent (no behaviour change)', () => {
    const out = finaliseIntake(
      rawObject({ job_type: 'tap_replace', scope: { description: 'new kitchen mixer', requested_specs_json: '{}' } }) as any,
    )
    expect((out.scope as any).specs).toBeUndefined()
    expect((out.scope as any).requested_specs_json).toBeUndefined()
  })

  it('preserves a discrete supplied_by spec while promoting system_type', () => {
    const out = finaliseIntake(
      rawObject({
        scope: {
          description: 'gas HWS, I have my own unit',
          specs: { supplied_by: 'customer' },
          requested_specs_json: '{"system_type":"gas"}',
        },
      }) as any,
    )
    expect((out.scope as any).specs.supplied_by).toBe('customer')
    expect((out.scope as any).specs.system_type).toBe('gas')
  })
})

describe('IntakeSchema — system_type field', () => {
  const base = {
    trade: 'plumbing' as const,
    job_type: 'hot_water' as const,
    address: '1 Test St',
    suburb: 'Coorparoo',
    risks: [],
    inspection_required: false,
    caller: { name: 'Sam', phone: '0400000000' },
    confidence: 'HIGH' as const,
    confidence_reason: 'ok',
  }

  it('accepts each valid system_type on scope.specs', () => {
    for (const v of ['electric', 'gas', 'heat_pump']) {
      const r = IntakeSchema.safeParse({
        ...base,
        scope: { description: 'hws', specs: { system_type: v } },
      })
      expect(r.success).toBe(true)
    }
  })

  it('rejects an invalid system_type enum value', () => {
    const r = IntakeSchema.safeParse({
      ...base,
      scope: { description: 'hws', specs: { system_type: 'solar' } },
    })
    expect(r.success).toBe(false)
  })
})
