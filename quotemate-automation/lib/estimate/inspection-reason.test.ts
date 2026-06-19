import { describe, it, expect } from 'vitest'
import {
  sanitizeInspectionReason,
  SAFE_INSPECTION_REASON,
  resolveInspectionReason,
  INSPECTION_REASONS,
} from './inspection-reason'

describe('sanitizeInspectionReason (R13)', () => {
  it('falls back to the safe default for empty / nullish / too-short input', () => {
    expect(sanitizeInspectionReason('')).toBe(SAFE_INSPECTION_REASON)
    expect(sanitizeInspectionReason(null)).toBe(SAFE_INSPECTION_REASON)
    expect(sanitizeInspectionReason(undefined)).toBe(SAFE_INSPECTION_REASON)
    expect(sanitizeInspectionReason('   ')).toBe(SAFE_INSPECTION_REASON)
    expect(sanitizeInspectionReason('n/a')).toBe(SAFE_INSPECTION_REASON)
  })

  it('strips invented price claims (no price on a no-price quote)', () => {
    expect(sanitizeInspectionReason('Likely a $1,200 switchboard upgrade'))
      .not.toMatch(/\$|1,200|dollars/i)
    expect(sanitizeInspectionReason('Could cost AUD 350 to fix'))
      .not.toMatch(/aud|350|\$/i)
    expect(sanitizeInspectionReason('About 500 dollars of work'))
      .not.toMatch(/dollars|500/i)
    // the surrounding words survive
    expect(sanitizeInspectionReason('Likely a $1,200 switchboard upgrade'))
      .toMatch(/switchboard upgrade/i)
  })

  it('calms all-caps shouting to sentence case', () => {
    expect(sanitizeInspectionReason('DANGEROUS WIRING FOUND'))
      .toBe('Dangerous wiring found')
  })

  it('collapses exclamation and repeated punctuation', () => {
    const out = sanitizeInspectionReason('Old wiring detected!!! Call now!!')
    expect(out).not.toMatch(/!/)
    expect(out).not.toMatch(/\.\./)
  })

  it('trims dangling separators left after stripping', () => {
    const out = sanitizeInspectionReason('Needs a visit — $99 site fee')
    expect(out).not.toMatch(/[\s–—-]+$/)
    expect(out).not.toMatch(/\$|99/)
    expect(out).toMatch(/needs a visit/i)
  })

  it('length-caps on a word boundary and never mid-word', () => {
    const long = 'Site inspection required because ' + 'detailed '.repeat(60) + 'assessment'
    const out = sanitizeInspectionReason(long)
    expect(out.length).toBeLessThanOrEqual(201) // 200 + ellipsis
    expect(out).not.toMatch(/\bdetaile$/) // not cut mid-word
  })

  it('passes a clean, normal reason through essentially unchanged', () => {
    const clean = 'The meter box is in a hard-to-access location and needs an on-site check.'
    expect(sanitizeInspectionReason(clean)).toBe(clean)
  })

  it('preserves acronyms in mixed-case text (only full-caps strings are calmed)', () => {
    const out = sanitizeInspectionReason('The RCBO and switchboard need an on-site check.')
    expect(out).toMatch(/RCBO/)
  })

  it('neutralises the composite manipulative reason the reviewer flagged (R13 adversarial)', () => {
    // The exact attack shape called out in review: invented price + shouting +
    // exclamation runs, all in one string. None of it may reach the customer.
    const out = sanitizeInspectionReason('URGENT $500 EXTRA FEE!!!')
    expect(out).not.toMatch(/\$|500|dollars/i) // no invented price
    expect(out).not.toMatch(/!/) // no shouting punctuation
    expect(out).not.toMatch(/[A-Z]{2,}/) // no all-caps shouting left
    // a fully-misleading input collapses to a calm, price-free clause
    expect(out).toBe('Urgent extra fee.')
  })

  it('falls back to the safe default when stripping leaves nothing usable', () => {
    // pure price + symbols + shouting => nothing meaningful remains
    expect(sanitizeInspectionReason('$$$ !!!')).toBe(SAFE_INSPECTION_REASON)
    expect(sanitizeInspectionReason('AUD 1,200.00')).toBe(SAFE_INSPECTION_REASON)
  })
})

describe('resolveInspectionReason (R5 — closed enum)', () => {
  const ENUM = new Set<string>(Object.values(INSPECTION_REASONS))

  it('always returns a member of the closed enum, never model free text', () => {
    const inputs = [
      'Switchboard upgrade needed, $1,200 EXTRA!!!',
      'not sure about the hot water unit fuel',
      'blocked sewer drain, needs a camera',
      'asbestos risk in a pre-1970 ceiling — compliance',
      'no manhole, no roof access to the cavity',
      'this is a full kitchen renovation, out of scope',
      'some vague hand-wavy reason about variables',
      '', null, undefined, '$$$ !!!',
    ]
    for (const i of inputs) expect(ENUM.has(resolveInspectionReason(i))).toBe(true)
  })

  it('maps by keyword to the right enum entry', () => {
    expect(resolveInspectionReason('Switchboard / mains work required')).toBe(INSPECTION_REASONS.switchboard)
    expect(resolveInspectionReason('gas hot water unit, not sure of type')).toBe(INSPECTION_REASONS.hot_water)
    expect(resolveInspectionReason('completely blocked drain, sewer backing up')).toBe(INSPECTION_REASONS.drainage)
    expect(resolveInspectionReason('asbestos compliance concern')).toBe(INSPECTION_REASONS.safety)
    expect(resolveInspectionReason('no manhole / no roof access')).toBe(INSPECTION_REASONS.access)
    expect(resolveInspectionReason('commercial renovation, out of scope')).toBe(INSPECTION_REASONS.out_of_scope)
  })

  it('strips an invented price even when it also maps to an enum entry', () => {
    const out = resolveInspectionReason('Switchboard work, about $900 extra')
    expect(out).toBe(INSPECTION_REASONS.switchboard)
    expect(out).not.toMatch(/\$|900/)
  })

  it('falls back to the generic safe reason when nothing matches', () => {
    expect(resolveInspectionReason('mmm')).toBe(INSPECTION_REASONS.generic)
    expect(resolveInspectionReason('')).toBe(INSPECTION_REASONS.generic)
    expect(INSPECTION_REASONS.generic).toBe(SAFE_INSPECTION_REASON)
  })
})
