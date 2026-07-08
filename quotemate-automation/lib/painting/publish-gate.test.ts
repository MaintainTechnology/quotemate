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
  // Spec tradie-onsite-quote-editing R5 — the eligibility now also decides
  // whether to SEND: first release stamps + sends; a released row resends
  // only on an explicit resend request (post-edit); otherwise it stays the
  // idempotent no-op that never re-texts.
  it('stamps and sends on first release', () => {
    expect(paintingReleaseEligibility({ alreadyReleasedAt: null })).toEqual({
      ok: true,
      stamp: true,
      send: true,
    })
  })
  it('is an idempotent no-op once released (no restamp, no send)', () => {
    expect(paintingReleaseEligibility({ alreadyReleasedAt: '2026-06-26T00:00:00Z' })).toEqual({
      ok: true,
      stamp: false,
      send: false,
    })
  })
  it('resends a released quote on an explicit resend, without restamping', () => {
    expect(
      paintingReleaseEligibility({ alreadyReleasedAt: '2026-06-26T00:00:00Z', resend: true }),
    ).toEqual({ ok: true, stamp: false, send: true })
  })
  it('a resend flag on a never-released row is just the first release', () => {
    expect(paintingReleaseEligibility({ alreadyReleasedAt: null, resend: true })).toEqual({
      ok: true,
      stamp: true,
      send: true,
    })
  })
})
