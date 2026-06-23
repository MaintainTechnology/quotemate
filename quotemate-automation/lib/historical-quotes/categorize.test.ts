import { describe, it, expect } from 'vitest'
import { CategorizeSchema, categorizeQuote } from './categorize'

describe('CategorizeSchema', () => {
  it('accepts a canonical job_type', () => {
    expect(
      CategorizeSchema.safeParse({ job_type: 'downlights', confidence: 'high', reason: 'clear' }).success,
    ).toBe(true)
  })

  it('rejects a non-canonical job_type (constrained to the taxonomy)', () => {
    expect(
      CategorizeSchema.safeParse({ job_type: 'rewire_house', confidence: 'high', reason: 'x' }).success,
    ).toBe(false)
  })
})

describe('categorizeQuote', () => {
  it('falls back to other/low when no model is available', async () => {
    const prev = process.env.ANTHROPIC_API_KEY
    delete process.env.ANTHROPIC_API_KEY
    try {
      const r = await categorizeQuote({ description: 'install 6 downlights' })
      expect(r.job_type).toBe('other')
      expect(r.confidence).toBe('low')
      expect(r.via).toBe('fallback')
    } finally {
      if (prev) process.env.ANTHROPIC_API_KEY = prev
    }
  })
})
