import { describe, it, expect } from 'vitest'
import { isLowSignal, sortForReview } from './review-order'

describe('isLowSignal', () => {
  it('flags low confidence, missing job_type, and "other"', () => {
    expect(isLowSignal({ job_type_confidence: 'low', job_type: 'downlights' })).toBe(true)
    expect(isLowSignal({ job_type_confidence: 'high', job_type: 'other' })).toBe(true)
    expect(isLowSignal({ job_type_confidence: 'high', job_type: null })).toBe(true)
    expect(isLowSignal({ job_type_confidence: 'high', job_type: 'downlights' })).toBe(false)
  })
})

describe('sortForReview', () => {
  it('floats low-signal rows to the top, created_at ascending within each group', () => {
    const rows = [
      { id: 'a', job_type_confidence: 'high', job_type: 'downlights', created_at: '2026-01-01' },
      { id: 'b', job_type_confidence: 'low', job_type: 'hot_water', created_at: '2026-01-03' },
      { id: 'c', job_type_confidence: 'high', job_type: 'other', created_at: '2026-01-02' },
      { id: 'd', job_type_confidence: 'medium', job_type: 'tap_repair', created_at: '2026-01-04' },
    ]
    const out = sortForReview(rows).map((r) => r.id)
    // low-signal first, created_at asc within each group:
    //   low-signal: c (01-02) before b (01-03); confident: a (01-01) before d (01-04)
    expect(out).toEqual(['c', 'b', 'a', 'd'])
  })
})
