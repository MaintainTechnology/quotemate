import { describe, expect, it } from 'vitest'
import {
  PAINT_INSPECTION_TIER,
  paintPayRedirectTier,
  resolvePaintMintTier,
  VALID_PAINT_TIERS,
} from './pay-redirect'

describe('resolvePaintMintTier (spec painting-site-visit-first R2)', () => {
  it('still recognises G/B/B as legacy deposit tiers (the route redirects them)', () => {
    for (const tier of VALID_PAINT_TIERS) {
      expect(resolvePaintMintTier(tier, null, false)).toEqual({ kind: 'deposit', tier })
      expect(resolvePaintMintTier(tier, 'inspection_required', true)).toEqual({ kind: 'deposit', tier })
    }
  })

  it('mints the $99 site visit for an inspection-routed row', () => {
    expect(resolvePaintMintTier(PAINT_INSPECTION_TIER, 'inspection_required', false)).toEqual({
      kind: 'inspection',
    })
  })

  it('mints the $99 site visit for a RELEASED row — the only customer payment', () => {
    expect(resolvePaintMintTier(PAINT_INSPECTION_TIER, 'auto', true)).toEqual({ kind: 'inspection' })
    expect(resolvePaintMintTier(PAINT_INSPECTION_TIER, null, true)).toEqual({ kind: 'inspection' })
  })

  it('rejects the inspection tier for a HELD (unreleased, auto-routed) row', () => {
    // A held priced quote paying $99 would bypass the review-required design.
    expect(resolvePaintMintTier(PAINT_INSPECTION_TIER, 'auto', false)).toEqual({ kind: 'invalid' })
    expect(resolvePaintMintTier(PAINT_INSPECTION_TIER, null, false)).toEqual({ kind: 'invalid' })
    expect(resolvePaintMintTier(PAINT_INSPECTION_TIER, undefined, false)).toEqual({ kind: 'invalid' })
  })

  it('rejects unknown tiers exactly like today', () => {
    expect(resolvePaintMintTier('premium', 'inspection_required', true)).toEqual({ kind: 'invalid' })
    expect(resolvePaintMintTier('', null, false)).toEqual({ kind: 'invalid' })
  })

  it('keeps the inspection literal out of VALID_PAINT_TIERS', () => {
    expect(VALID_PAINT_TIERS.has(PAINT_INSPECTION_TIER)).toBe(false)
  })
})

describe('paintPayRedirectTier (book/thanks unpaid redirect)', () => {
  it('always pays the $99 site visit — tier deposits are retired (spec R3)', () => {
    expect(paintPayRedirectTier()).toBe(PAINT_INSPECTION_TIER)
  })
})
