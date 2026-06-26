import { describe, expect, it } from 'vitest'
import {
  canShowPaintingPrices,
  paintingDepositLocked,
  paintingReleaseEligibility,
} from './publish-gate'

describe('canShowPaintingPrices', () => {
  it('hides prices until the tradie releases', () => {
    const r = canShowPaintingPrices({ releasedAt: null })
    expect(r.showPrices).toBe(false)
    expect(r.reason).toMatch(/finalising/i)
  })
  it('shows prices once released', () => {
    expect(canShowPaintingPrices({ releasedAt: '2026-06-26T00:00:00Z' })).toEqual({ showPrices: true, reason: null })
  })
})

describe('paintingDepositLocked', () => {
  it('is locked until released', () => {
    expect(paintingDepositLocked(null)).toBe(true)
    expect(paintingDepositLocked(undefined)).toBe(true)
    expect(paintingDepositLocked('2026-06-26T00:00:00Z')).toBe(false)
  })
})

describe('paintingReleaseEligibility', () => {
  it('stamps on first release', () => {
    expect(paintingReleaseEligibility({ alreadyReleasedAt: null })).toEqual({ ok: true, stamp: true })
  })
  it('is an idempotent no-op once released', () => {
    expect(paintingReleaseEligibility({ alreadyReleasedAt: '2026-06-26T00:00:00Z' })).toEqual({ ok: true, stamp: false })
  })
})
