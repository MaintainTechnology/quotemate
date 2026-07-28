import { describe, it, expect } from 'vitest'
import { formatJobType, tradeForJobType, isJobType, JOB_TYPES } from './job-types'

describe('formatJobType', () => {
  it('sentence-cases a snake_case job type', () => {
    expect(formatJobType('blocked_drain')).toBe('Blocked drain')
    expect(formatJobType('downlights')).toBe('Downlights')
    expect(formatJobType('bathroom_renovation')).toBe('Bathroom renovation')
  })

  it('keeps trade acronyms upper-case', () => {
    // Without this, the job-type dropdown reads "Ev charger" / "Cctv inspection".
    expect(formatJobType('ev_charger')).toBe('EV charger')
    expect(formatJobType('cctv_inspection')).toBe('CCTV inspection')
    expect(formatJobType('prv_install')).toBe('PRV install')
  })

  it('falls back for null/empty', () => {
    expect(formatJobType(null)).toBe('Unclassified')
    expect(formatJobType(undefined)).toBe('Unclassified')
    expect(formatJobType('')).toBe('Unclassified')
  })

  it('renders every real job type without leaving an underscore behind', () => {
    for (const jt of JOB_TYPES) {
      const out = formatJobType(jt)
      expect(out, jt).not.toContain('_')
      expect(out.length, jt).toBeGreaterThan(0)
    }
  })
})

describe('tradeForJobType', () => {
  it('splits the taxonomy across the two trades', () => {
    expect(tradeForJobType('downlights')).toBe('electrical')
    expect(tradeForJobType('blocked_drain')).toBe('plumbing')
  })

  it('returns null for "other" and unknown values', () => {
    expect(tradeForJobType('other')).toBeNull()
    expect(tradeForJobType('not_a_job')).toBeNull()
    expect(tradeForJobType(null)).toBeNull()
  })

  it('classifies every job type except "other"', () => {
    const unclassified = JOB_TYPES.filter((jt) => jt !== 'other' && tradeForJobType(jt) === null)
    expect(unclassified).toEqual([])
  })
})

describe('isJobType', () => {
  it('guards against non-taxonomy strings', () => {
    expect(isJobType('downlights')).toBe(true)
    expect(isJobType('nope')).toBe(false)
    expect(isJobType(42)).toBe(false)
  })
})
