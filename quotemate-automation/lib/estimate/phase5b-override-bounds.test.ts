// Phase 5b — bounds on tenant overrides, and DROP rather than clamp.
//
// effectiveAssembly used to accept ANY finite override. A tradie who typed 800
// meaning 8.00 got 800 labour hours on a customer's quote; 2500 meaning 25.00
// got a 2500% markup. Nothing downstream caught it: checkSanityBounds only
// fires when the job type has a job_type_bounds row, and that table covers 5 of
// 14 live job types.
//
// DROP, NOT CLAMP. Clamping 800 to 40 ships a price nobody chose and looks
// deliberate; dropping falls back to the global default, a number a human
// actually set. And the drop must be VISIBLE — `source: 'global'` alone means
// two different things ("nothing was set" vs "something absurd was ignored")
// and the second has to be reportable or the bad row is never fixed.
//
// The limits are absolute sanity rails, not pricing policy. They catch data
// entry off by a factor of a hundred, so they are deliberately loose.

import { describe, it, expect } from 'vitest'
import { effectiveAssembly } from './catalogue'

const eff = (lhOv: unknown, muOv: unknown) =>
  effectiveAssembly(8, 25, {
    labour_hours_override: lhOv as number | null,
    markup_pct_override: muOv as number | null,
  })

describe('Phase 5b — a sane override is honoured', () => {
  it('uses a normal local value', () => {
    const r = eff(6, 30)
    expect(r.labourHours).toEqual({ value: 6, source: 'local' })
    expect(r.markupPct).toEqual({ value: 30, source: 'local' })
  })

  it('accepts the limits themselves — the rails are inclusive', () => {
    expect(eff(40, 300).labourHours.value).toBe(40)
    expect(eff(40, 300).markupPct.value).toBe(300)
  })

  it('accepts zero — a materials-only assembly has no labour, and 0% markup is a choice', () => {
    expect(eff(0, 0).labourHours).toEqual({ value: 0, source: 'local' })
    expect(eff(0, 0).markupPct).toEqual({ value: 0, source: 'local' })
  })

  it('accepts a numeric string, as the DB returns numerics', () => {
    expect(eff('6.5', '27.5').labourHours.value).toBeCloseTo(6.5, 5)
  })
})

describe('Phase 5b — an absurd override is DROPPED, not clamped', () => {
  it('800 labour hours falls back to the global 8, not to the 40 limit', () => {
    // The clamp trap: 40 would be a price nobody chose, presented as if
    // someone had.
    const r = eff(800, 25)
    expect(r.labourHours.value).toBe(8)
    expect(r.labourHours.source).toBe('global')
    expect(r.labourHours.value).not.toBe(40)
  })

  it('a 2500% markup falls back to the global 25, not to 300', () => {
    const r = eff(8, 2500)
    expect(r.markupPct.value).toBe(25)
    expect(r.markupPct.value).not.toBe(300)
  })

  it('a negative override is dropped', () => {
    expect(eff(-5, 25).labourHours.value).toBe(8)
    expect(eff(8, -10).markupPct.value).toBe(25)
  })

  it('the drop is REPORTED, so the bad row can be found', () => {
    const r = eff(800, 2500)
    expect(r.labourHours.dropped).toMatch(/labour hours override 800h exceeds the 40h sanity limit/)
    expect(r.markupPct.dropped).toMatch(/markup override 2500% exceeds the 300% sanity limit/)
  })

  it('one bad field does not drop the other', () => {
    const r = eff(800, 30)
    expect(r.labourHours.source).toBe('global')
    expect(r.labourHours.dropped).toBeTruthy()
    expect(r.markupPct).toEqual({ value: 30, source: 'local' })
  })

  it('a non-numeric override is dropped and reported', () => {
    const r = eff('abc', 25)
    expect(r.labourHours.value).toBe(8)
    expect(r.labourHours.dropped).toMatch(/not a number/)
  })
})

describe('Phase 5b — an ABSENT override is not a dropped one', () => {
  it('no override object at all reads as plain global, with no reason', () => {
    const r = effectiveAssembly(8, 25, null)
    expect(r.labourHours).toEqual({ value: 8, source: 'global' })
    expect(r.labourHours.dropped).toBeUndefined()
    expect(r.markupPct.dropped).toBeUndefined()
  })

  it('null columns read as plain global — a blank field is not an error', () => {
    // This is the distinction the `dropped` field exists to preserve. Reporting
    // every unset override would bury the real ones in noise.
    const r = eff(null, null)
    expect(r.labourHours).toEqual({ value: 8, source: 'global' })
    expect(r.markupPct.dropped).toBeUndefined()
  })

  it('an undefined column is likewise not a drop', () => {
    const r = effectiveAssembly(8, 25, {})
    expect(r.labourHours.dropped).toBeUndefined()
    expect(r.markupPct.dropped).toBeUndefined()
  })
})

describe('Phase 5b — the typo this exists to catch', () => {
  it('8.00 typed as 800 does not bill a customer for 800 hours', () => {
    // At a $110 rate that override alone is $88,000 of labour on one line.
    const r = eff(800, 25)
    expect(r.labourHours.value * 110).toBe(880)
  })

  it('25.00 typed as 2500 does not multiply a $100 part into $2,600', () => {
    const r = eff(8, 2500)
    expect(100 * (1 + r.markupPct.value / 100)).toBe(125)
  })

  it('is deterministic — same override twice, same verdict', () => {
    expect(eff(800, 2500)).toEqual(eff(800, 2500))
  })
})
