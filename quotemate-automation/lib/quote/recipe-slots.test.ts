import { describe, it, expect } from 'vitest'
import { RECIPE_SLOT_CODES, recipeSlotsFrom } from './recipe-slots'
import { JOB_FIELDS } from './job-fields'

describe('recipeSlotsFrom', () => {
  it('coerces a distance answer to a number', () => {
    expect(recipeSlotsFrom({ distance_to_existing_power: '8' })).toEqual({
      distance_to_existing_power: 8,
    })
    expect(recipeSlotsFrom({ distance_to_existing_power: ' 12.5 ' })).toEqual({
      distance_to_existing_power: 12.5,
    })
  })

  it('OMITS a blank distance rather than stamping 0', () => {
    // Number('') === 0, which is finite and >= 0. Stamping it would read as a
    // real "0 metres" answer and lock the cheapest band, instead of letting the
    // recipe apply its own default_when_unanswered.
    expect(recipeSlotsFrom({ distance_to_existing_power: '' })).toEqual({})
    expect(recipeSlotsFrom({ distance_to_existing_power: '   ' })).toEqual({})
    expect(recipeSlotsFrom({})).toEqual({})
    expect(recipeSlotsFrom(null)).toEqual({})
    expect(recipeSlotsFrom(undefined)).toEqual({})
  })

  it('omits a non-numeric or negative distance', () => {
    expect(recipeSlotsFrom({ distance_to_existing_power: 'about 10m' })).toEqual({})
    expect(recipeSlotsFrom({ distance_to_existing_power: '-3' })).toEqual({})
  })

  it('keeps 0 when the tradie genuinely typed it', () => {
    expect(recipeSlotsFrom({ distance_to_existing_power: '0' })).toEqual({
      distance_to_existing_power: 0,
    })
  })

  it('passes the circuit value through verbatim', () => {
    expect(recipeSlotsFrom({ circuit_required: '20A' })).toEqual({ circuit_required: '20A' })
    expect(recipeSlotsFrom({ circuit_required: 'three-phase' })).toEqual({
      circuit_required: 'three-phase',
    })
    expect(recipeSlotsFrom({ circuit_required: '' })).toEqual({})
  })

  it('ignores every other answer', () => {
    expect(recipeSlotsFrom({ room: 'kitchen', count: '4', colour: 'warm white' })).toEqual({})
  })

  it('carries both slots together', () => {
    expect(
      recipeSlotsFrom({ distance_to_existing_power: '7', circuit_required: '20A', room: 'shed' }),
    ).toEqual({ distance_to_existing_power: 7, circuit_required: '20A' })
  })
})

describe('power_points recipe field wiring', () => {
  const fields = JOB_FIELDS.power_points.fields

  it('asks both recipe questions', () => {
    const codes = fields.map((f) => f.code)
    expect(codes).toContain('distance_to_existing_power')
    expect(codes).toContain('circuit_required')
  })

  // applySelectBand (lib/estimate/price-bands.ts:230) matches on an exact
  // lowercased string against the recipe's band values. "20 amp" or
  // "single phase" would match nothing and silently price as 10A, losing the
  // assembly swap. These are the literal band values from the live recipe.
  it('offers circuit options that exactly match the live recipe band values', () => {
    const circuit = fields.find((f) => f.code === 'circuit_required')
    expect(circuit?.type).toBe('select')
    expect(circuit?.options).toEqual(['10A', '20A', 'three-phase'])
  })

  it('asks the distance as a number', () => {
    expect(fields.find((f) => f.code === 'distance_to_existing_power')?.type).toBe('number')
  })
})

describe('RECIPE_SLOT_CODES', () => {
  // The job-quote route filters these codes OUT of the prose transcript: they
  // reach the recipe engine via intake.scope, and spelling the distance out in
  // prose pulls the estimator into pricing cable itself, against prompt Rule 18
  // ("NO RECIPE LINES"). Its line then collides with the recipe's own line on
  // the same catalogue row and the D-1 dedup rule dumps the whole quote to the
  // $99 inspection. Observed end-to-end 2026-07-29.
  //
  // That filter matches by code. A typo here would make it silently no-op and
  // the collision would come straight back, so every code must resolve to a
  // real field.
  it('every code is a real field code somewhere in JOB_FIELDS', () => {
    const allCodes = new Set(
      Object.values(JOB_FIELDS).flatMap((spec) => spec.fields.map((f) => f.code)),
    )
    const orphans = RECIPE_SLOT_CODES.filter((c) => !allCodes.has(c))
    expect(orphans).toEqual([])
  })

  // THE ROOT-CAUSE GUARD. The job-quote route filters RECIPE_SLOT_CODES out of
  // the prose transcript for EVERY job type, because on power_points the recipe
  // consumes them deterministically and restating them pulls the estimator into
  // pricing the cable itself. But the filter matches by CODE ALONE — so any
  // other job type that happens to reuse one of these codes has its answer
  // silently dropped from the transcript AND from the extras fallback.
  //
  // That shipped: ev_charger used `circuit_required` for its phase question, so
  // "three phase" reached nothing — not the transcript, not the recipe (whose
  // band value is the hyphenated 'three-phase'), and therefore not
  // structure.ts:397's rule that three-phase work always forces an inspection.
  // The most expensive electrical job on the form was priced as single-phase.
  //
  // Only power_points has a price_recipe in production, so only power_points may
  // use these codes. This test fails the next time a recipe slot is added whose
  // name collides with an existing field.
  it('no job type other than power_points uses a recipe slot code', () => {
    const offenders: string[] = []
    for (const [jobType, spec] of Object.entries(JOB_FIELDS)) {
      if (jobType === 'power_points') continue
      for (const f of spec.fields) {
        if ((RECIPE_SLOT_CODES as readonly string[]).includes(f.code)) {
          offenders.push(`${jobType}.${f.code}`)
        }
      }
    }
    expect(
      offenders,
      'these answers would be filtered out of the transcript and reach nothing',
    ).toEqual([])
  })

  it("keeps every EV charger answer out of the recipe-slot namespace", () => {
    const codes = JOB_FIELDS.ev_charger.fields.map((f) => f.code)
    expect(codes).toEqual([
      'vehicle',
      'charger_supply',
      'room',
      'switchboard_distance',
      'phase',
    ])
    expect(codes.filter((code) => (RECIPE_SLOT_CODES as readonly string[]).includes(code)))
      .toEqual([])
  })

  it('covers every code recipeSlotsFrom actually reads', () => {
    // If a slot is added to recipeSlotsFrom but not to RECIPE_SLOT_CODES, it
    // would be stamped into scope AND left in the prose — the exact bug above.
    const produced = Object.keys(
      recipeSlotsFrom({ distance_to_existing_power: '5', circuit_required: '20A' }),
    )
    expect(produced.sort()).toEqual([...RECIPE_SLOT_CODES].sort())
  })
})
