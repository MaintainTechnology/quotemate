import { describe, it, expect } from 'vitest'
import {
  sanitizeInspectionReason,
  SAFE_INSPECTION_REASON,
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
})
