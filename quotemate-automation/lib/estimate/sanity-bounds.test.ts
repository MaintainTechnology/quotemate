import { describe, it, expect } from 'vitest'
import {
  checkSanityBounds,
  boundForJob,
  recipeLabourFromLines,
  type JobTypeBound,
} from './sanity-bounds'
import { resolveMinLabourHours } from './min-labour'

const BOUNDS: JobTypeBound[] = [
  { trade: 'electrical', job_type: 'downlights', max_labour_hours: 11, min_total_ex_gst: 300, max_total_ex_gst: 4000, per_unit_labour_hours: 1.0 },
  { trade: 'electrical', job_type: 'ev_charger', max_labour_hours: 10, min_total_ex_gst: 400, max_total_ex_gst: 6000, per_unit_labour_hours: null },
  { trade: 'plumbing', job_type: 'hot_water', max_labour_hours: 6, min_total_ex_gst: 800, max_total_ex_gst: 6000, per_unit_labour_hours: null },
]

describe('recipeLabourFromLines', () => {
  it('counts an appended recipe labour extra', () => {
    expect(
      recipeLabourFromLines([
        { source: 'labour', unit: 'hr', quantity: 1.0, recipe_origin: true },
      ]),
    ).toBe(1.0)
  })

  it('EXCLUDES swap replacement labour', () => {
    // The bug this test exists for. A SWAP band replaces the base assembly's
    // lines — merge-recipes strips every prior source==='labour' line — so its
    // labour is the job's WHOLE labour, not an addition. Counting it made
    // recipeLabourHours === totalLabourHours, so cap >= total always held and
    // R9's per-unit branch could never fire again.
    expect(
      recipeLabourFromLines([
        { source: 'labour', unit: 'hr', quantity: 7.0, recipe_origin: true, recipe_swap: true },
      ]),
    ).toBe(0)
  })

  it('ignores non-recipe labour so Opus stays inside the scaled allowance', () => {
    expect(
      recipeLabourFromLines([{ source: 'labour', unit: 'hr', quantity: 6 }]),
    ).toBe(0)
  })

  it('ignores recipe MATERIAL lines — only labour widens a labour cap', () => {
    expect(
      recipeLabourFromLines([
        { source: 'material:abc', unit: 'lm', quantity: 10, recipe_origin: true },
      ]),
    ).toBe(0)
  })

  it('sums several appended extras but never the swap alongside them', () => {
    expect(
      recipeLabourFromLines([
        { source: 'labour', unit: 'hr', quantity: 4, recipe_origin: true, recipe_swap: true },
        { source: 'labour', unit: 'hr', quantity: 0.5, recipe_origin: true },
        { source: 'labour', unit: 'hr', quantity: 1.5, recipe_origin: true },
        { source: 'material:x', unit: 'lm', quantity: 20, recipe_origin: true },
      ]),
    ).toBe(2.0)
  })

  it('is defensive about shape and never returns NaN', () => {
    expect(recipeLabourFromLines(null)).toBe(0)
    expect(recipeLabourFromLines(undefined)).toBe(0)
    expect(recipeLabourFromLines([])).toBe(0)
    expect(recipeLabourFromLines([{ recipe_origin: true, unit: 'hr', quantity: 'abc' }])).toBe(0)
    expect(recipeLabourFromLines([{ recipe_origin: true, unit: 'hr', quantity: -3 }])).toBe(0)
  })
})

describe('resolveMinLabourHours (shared with R9)', () => {
  // R9's cap and applyMinLabourFloor MUST agree. If the floor tops labour up to
  // 2.0h on a NULL column while R9 assumes 0, the cap is 1.75h and every
  // single-item quote fails — the exact defect the affine cap removes.
  it('falls back to 2.0h on a NULL or unparseable column', () => {
    expect(resolveMinLabourHours({ min_labour_hours: null })).toBe(2.0)
    expect(resolveMinLabourHours({})).toBe(2.0)
    expect(resolveMinLabourHours(null)).toBe(2.0)
    expect(resolveMinLabourHours({ min_labour_hours: 'nonsense' })).toBe(2.0)
  })

  it('honours a configured value, including a numeric string', () => {
    expect(resolveMinLabourHours({ min_labour_hours: 1.0 })).toBe(1.0)
    expect(resolveMinLabourHours({ min_labour_hours: '1.70' })).toBe(1.7)
  })

  it('a NULL-column tenant does not fail the per-unit check at quantity 1', () => {
    // End-to-end of the two fixes together: floor resolves to 2.0h, R9 uses the
    // same 2.0h, so the cap is max(2.0, 1.75) = 2.0 and a 2.0h job passes.
    const v = checkSanityBounds(
      {
        jobType: 'downlights', trade: 'electrical', quantity: 1,
        totalLabourHours: 2.0, totalExGst: 400,
        minLabourHours: resolveMinLabourHours({ min_labour_hours: null }),
      },
      boundForJob(BOUNDS, 'electrical', 'downlights'),
    )
    expect(v.ok).toBe(true)
  })
})

describe('boundForJob', () => {
  it('matches on trade + job_type', () => {
    expect(boundForJob(BOUNDS, 'electrical', 'downlights')?.max_labour_hours).toBe(11)
    expect(boundForJob(BOUNDS, 'plumbing', 'downlights')).toBeUndefined()
  })
})

describe('checkSanityBounds (R9)', () => {
  it('passes (ok) when no bound is defined for the job-type (opt-in)', () => {
    expect(checkSanityBounds({ jobType: 'fault_finding', trade: 'electrical', totalLabourHours: 99, totalExGst: 99999 }, undefined)).toEqual({ ok: true })
  })

  it('passes a realistic 6-downlight job (9h, $2100)', () => {
    const v = checkSanityBounds(
      { jobType: 'downlights', trade: 'electrical', quantity: 6, totalLabourHours: 9, totalExGst: 2100 },
      boundForJob(BOUNDS, 'electrical', 'downlights'),
    )
    expect(v.ok).toBe(true)
  })

  it('passes a realistic EV charger install inside the provisional band', () => {
    const result = checkSanityBounds(
      {
        jobType: 'ev_charger',
        trade: 'electrical',
        totalLabourHours: 3,
        totalExGst: 1400,
      },
      boundForJob(BOUNDS, 'electrical', 'ev_charger'),
    )
    expect(result.ok).toBe(true)
  })

  it.each([
    { totalLabourHours: 10.01, totalExGst: 1400, failure: /labour .* > max 10h/ },
    { totalLabourHours: 3, totalExGst: 399.99, failure: /< min/ },
    { totalLabourHours: 3, totalExGst: 6000.01, failure: /> max/ },
  ])('rejects an EV quote outside the provisional band', (input) => {
    const result = checkSanityBounds(
      { jobType: 'ev_charger', trade: 'electrical', ...input },
      boundForJob(BOUNDS, 'electrical', 'ev_charger'),
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.failures.join(' ')).toMatch(input.failure)
  })

  it('FAILS the canonical 6-downlight 17.5h defect (the audit case)', () => {
    const v = checkSanityBounds(
      { jobType: 'downlights', trade: 'electrical', quantity: 6, totalLabourHours: 17.5, totalExGst: 2600 },
      boundForJob(BOUNDS, 'electrical', 'downlights'),
    )
    expect(v.ok).toBe(false)
    if (!v.ok) expect(v.failures.join(' ')).toMatch(/labour 17.5h > max 11h/)
  })

  it('catches a per-unit blowout even under the absolute cap', () => {
    // 4 downlights, 8h total, $1500 — under the 11h absolute cap, but 2.0h/unit > 1.0×1.75
    const v = checkSanityBounds(
      { jobType: 'downlights', trade: 'electrical', quantity: 4, totalLabourHours: 8, totalExGst: 1500 },
      boundForJob(BOUNDS, 'electrical', 'downlights'),
    )
    expect(v.ok).toBe(false)
    if (!v.ok) expect(v.failures.join(' ')).toMatch(/per-unit/)
  })

  // ── Affine cap: labour is `fixed + per_unit × n`, not purely proportional ──
  // Dividing a FIXED cost by quantity makes the cap tightest exactly where the
  // fixed part dominates, i.e. at quantity 1. Two real prod cases were being
  // routed to the $99 inspection by this.

  it('passes a single-item job whose labour is just the tenant minimum charge', () => {
    // Real case: intake 5350290e, tenant 829702af, item_count 1, no recipe.
    // pricing_book.min_labour_hours = 2.00, applied by applyMinLabourFloor,
    // which tops labour UP TO the floor and never beyond. Old maths: 2.00h / 1
    // unit = 2.00 > 1.75 → inspection. Three of five tenants sit at a 2h floor,
    // so EVERY single-item downlights/power_points quote failed for them.
    const v = checkSanityBounds(
      {
        jobType: 'downlights', trade: 'electrical', quantity: 1,
        totalLabourHours: 2.0, totalExGst: 400, minLabourHours: 2.0,
      },
      boundForJob(BOUNDS, 'electrical', 'downlights'),
    )
    expect(v.ok).toBe(true)
  })

  it('passes a 2-unit job carrying a one-off recipe cable run', () => {
    // Real case: intake 0c39d4c2, item_count 2, distance_to_existing_power 6 →
    // the recipe's `max 10` band adds +1.0h for ONE cable run shared by both
    // GPOs. Old maths charged half a run against a per-GPO ceiling.
    const v = checkSanityBounds(
      {
        jobType: 'downlights', trade: 'electrical', quantity: 2,
        totalLabourHours: 4.0, totalExGst: 900,
        minLabourHours: 2.0, recipeLabourHours: 1.0,
      },
      boundForJob(BOUNDS, 'electrical', 'downlights'),
    )
    expect(v.ok).toBe(true)
  })

  it('does NOT let the minimum charge and the scaled allowance stack', () => {
    // The mistake this guards: `minCharge + scaled` instead of
    // `Math.max(minCharge, scaled)`. Summing them gives a 6-downlight job with
    // a 2h floor a 12.5h cap, and the guard drifts toward inert. With Math.max
    // the cap is 10.5h, so 12h must still fail.
    const v = checkSanityBounds(
      {
        jobType: 'downlights', trade: 'electrical', quantity: 6,
        totalLabourHours: 12, totalExGst: 2600, minLabourHours: 2.0,
      },
      boundForJob(BOUNDS, 'electrical', 'downlights'),
    )
    expect(v.ok).toBe(false)
  })

  it('still fails a genuine blowout when a recipe is present but small', () => {
    // A recipe allowance must widen the cap by its own size, not excuse
    // arbitrary labour. 6 units → scaled 10.5h, +0.5h recipe = 11.0h cap.
    const v = checkSanityBounds(
      {
        jobType: 'downlights', trade: 'electrical', quantity: 6,
        totalLabourHours: 16, totalExGst: 2600, recipeLabourHours: 0.5,
      },
      boundForJob(BOUNDS, 'electrical', 'downlights'),
    )
    expect(v.ok).toBe(false)
  })

  it('treats absent/blank affine inputs as zero', () => {
    // Callers that predate these fields must behave exactly as before.
    const bound = boundForJob(BOUNDS, 'electrical', 'downlights')
    const base = { jobType: 'downlights', trade: 'electrical', quantity: 4, totalExGst: 1500 }
    // 4 units → cap 7.0h. 8h fails with no affine inputs...
    expect(checkSanityBounds({ ...base, totalLabourHours: 8 }, bound).ok).toBe(false)
    // ...and identically when they are explicitly null/undefined.
    expect(
      checkSanityBounds(
        { ...base, totalLabourHours: 8, minLabourHours: null, recipeLabourHours: undefined },
        bound,
      ).ok,
    ).toBe(false)
  })

  it('flags an implausibly low total (under-quote)', () => {
    const v = checkSanityBounds(
      { jobType: 'hot_water', trade: 'plumbing', totalLabourHours: 3, totalExGst: 120 },
      boundForJob(BOUNDS, 'plumbing', 'hot_water'),
    )
    expect(v.ok).toBe(false)
    if (!v.ok) expect(v.failures.join(' ')).toMatch(/< min/)
  })

  it('flags an implausibly high total (over-quote)', () => {
    const v = checkSanityBounds(
      { jobType: 'hot_water', trade: 'plumbing', totalLabourHours: 4, totalExGst: 9000 },
      boundForJob(BOUNDS, 'plumbing', 'hot_water'),
    )
    expect(v.ok).toBe(false)
    if (!v.ok) expect(v.failures.join(' ')).toMatch(/> max/)
  })
})
