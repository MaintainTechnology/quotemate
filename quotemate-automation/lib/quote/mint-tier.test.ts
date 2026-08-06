// Spec elec-plumb-site-visit-first — the allowlist that decides which trades
// on the SHARED generic funnel still sell a Good/Better/Best deposit.
//
// The regression this file exists to catch: the generic `/q/[token]` page and
// `/r/[token]/[tier]` mint serve FIVE trades. If the gate ever becomes a
// blocklist, solar / commercial_painting / roofing lose their legitimate
// deposit path silently. Every case below is asserted from both sides.

import { describe, expect, it } from 'vitest'
import {
  isSiteVisitFirstTrade,
  resolveBookUnpaidAction,
  resolveGenericMintTier,
} from './mint-tier'
import { resolveAcceptView } from './accept'

const DEPOSIT_TIERS = ['good', 'better', 'best'] as const

describe('resolveGenericMintTier — electrical + plumbing (the allowlist)', () => {
  for (const trade of ['electrical', 'plumbing']) {
    for (const tier of DEPOSIT_TIERS) {
      it(`${trade} / ${tier} redirects to the $99 inspection mint`, () => {
        expect(resolveGenericMintTier(tier, trade)).toEqual({ kind: 'redirect_to_inspection' })
      })
    }

    it(`${trade} / inspection passes through (it IS the payment)`, () => {
      expect(resolveGenericMintTier('inspection', trade)).toEqual({ kind: 'passthrough' })
    })
  }

  it('tolerates casing/whitespace on the stored trade value', () => {
    expect(resolveGenericMintTier('better', '  Electrical ')).toEqual({
      kind: 'redirect_to_inspection',
    })
  })
})

describe('resolveGenericMintTier — the other four trades keep their deposits', () => {
  // These three still mint real G/B/B Sessions through this exact route.
  for (const trade of ['solar', 'commercial_painting', 'roofing']) {
    for (const tier of DEPOSIT_TIERS) {
      it(`${trade} / ${tier} passes through to the deposit mint`, () => {
        expect(resolveGenericMintTier(tier, trade)).toEqual({ kind: 'passthrough' })
      })
    }
  }

  it('commercial-painting spelled with a hyphen is still not on the allowlist', () => {
    expect(resolveGenericMintTier('best', 'commercial-painting')).toEqual({ kind: 'passthrough' })
  })
})

describe('resolveGenericMintTier — unresolvable trade fails open', () => {
  for (const trade of [null, undefined, '', '   ', 'signage', 'not-a-trade']) {
    it(`trade ${JSON.stringify(trade)} passes through — never redirected`, () => {
      expect(resolveGenericMintTier('better', trade)).toEqual({ kind: 'passthrough' })
    })
  }

  it('an electrician/electric alias is NOT fuzzy-matched onto the allowlist', () => {
    // Deliberate: a fuzzy match here is a chance to steal another trade's
    // deposit. intakes.trade stores the canonical key.
    expect(isSiteVisitFirstTrade('electrician')).toBe(false)
    expect(isSiteVisitFirstTrade('electrical')).toBe(true)
    expect(isSiteVisitFirstTrade('plumbing')).toBe(true)
    expect(isSiteVisitFirstTrade('solar')).toBe(false)
  })
})

describe('resolveBookUnpaidAction — /q/[token]/book (R3)', () => {
  it('electrical with a LAPSED hold is sent to pay the $99, not dead-ended', () => {
    // The bug: priceExpired was not tier-aware, so this row got the
    // "price expired" page even though the $99 has no price hold.
    expect(
      resolveBookUnpaidAction({
        trade: 'electrical',
        holdExpired: true,
        needsInspection: false,
        nextTier: 'better',
      }),
    ).toEqual({ kind: 'pay', tier: 'inspection' })
  })

  it('plumbing with a LIVE hold is also sent to the $99 mint', () => {
    expect(
      resolveBookUnpaidAction({
        trade: 'plumbing',
        holdExpired: false,
        needsInspection: false,
        nextTier: 'good',
      }),
    ).toEqual({ kind: 'pay', tier: 'inspection' })
  })

  it('solar on this SHARED page keeps the expired dead-end', () => {
    expect(
      resolveBookUnpaidAction({
        trade: 'solar',
        holdExpired: true,
        needsInspection: false,
        nextTier: 'better',
      }),
    ).toEqual({ kind: 'expired' })
  })

  it('solar with a live hold still pays its own tier', () => {
    expect(
      resolveBookUnpaidAction({
        trade: 'solar',
        holdExpired: false,
        needsInspection: false,
        nextTier: 'best',
      }),
    ).toEqual({ kind: 'pay', tier: 'best' })
  })

  it('an inspection-routed row is exempt from the hold, exactly as today', () => {
    expect(
      resolveBookUnpaidAction({
        trade: 'solar',
        holdExpired: true,
        needsInspection: true,
        nextTier: 'better',
      }),
    ).toEqual({ kind: 'pay', tier: 'better' })
  })

  it('an unresolvable trade keeps today’s behaviour', () => {
    expect(
      resolveBookUnpaidAction({
        trade: null,
        holdExpired: true,
        needsInspection: false,
        nextTier: 'better',
      }),
    ).toEqual({ kind: 'expired' })
  })
})

describe('accept-view inputs for an electrical released-unpaid row (R2)', () => {
  // The page passes pricesVisible = !isInspection && !siteVisitFirst.
  // resolveAcceptView itself is untouched — this proves the CALLER's inputs
  // land every actionable electrical row on the $99 branch.
  const acceptViewFor = (trade: string | null, priceExpired: boolean) =>
    resolveAcceptView({
      token: 'tok123',
      tier: 'better',
      isPaid: false,
      pricesVisible: !isSiteVisitFirstTrade(trade),
      priceExpired,
      priceLabel: '$3,970 inc GST',
      depositLabel: '30% deposit ($1,191)',
    })

  it('electrical, released + unpaid → the $99 site-visit branch', () => {
    const view = acceptViewFor('electrical', false)
    expect(view.mode).toBe('inspection')
    expect(view.payHref).toBe('/r/tok123/inspection')
    expect(view.acceptTier).toBe('inspection')
    expect(view.ctaLabel).toBe('Accept & book $99 site visit')
    expect(view.actionable).toBe(true)
  })

  it('electrical with a LAPSED hold still gets the payable $99 branch', () => {
    expect(acceptViewFor('electrical', true).mode).toBe('inspection')
  })

  it('solar on the same page still gets the deposit branch', () => {
    const view = acceptViewFor('solar', false)
    expect(view.mode).toBe('deposit')
    expect(view.payHref).toBe('/r/tok123/better')
  })

  it('an unresolvable trade still gets the deposit branch (fail open)', () => {
    expect(acceptViewFor(null, false).mode).toBe('deposit')
  })
})
