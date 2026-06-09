import { describe, it, expect } from 'vitest'
import { confirmEligibility } from './route'

describe('confirmEligibility', () => {
  it('rejects an estimate that still has guardrail flags', () => {
    const r = confirmEligibility({
      guardrailFlags: ['better: gross price is $606/kW, outside ...'],
      alreadyConfirmedAt: null,
    })
    expect(r.ok).toBe(false)
    expect(r.status).toBe(409)
    expect(r.error).toMatch(/flag/i)
  })

  it('is idempotent — already confirmed returns ok without re-stamping', () => {
    const r = confirmEligibility({
      guardrailFlags: [],
      alreadyConfirmedAt: '2026-06-08T02:00:00Z',
    })
    expect(r.ok).toBe(true)
    expect(r.stamp).toBe(false)
  })

  it('confirms a clean, unconfirmed estimate and signals a fresh stamp', () => {
    const r = confirmEligibility({ guardrailFlags: [], alreadyConfirmedAt: null })
    expect(r.ok).toBe(true)
    expect(r.stamp).toBe(true)
  })
})
