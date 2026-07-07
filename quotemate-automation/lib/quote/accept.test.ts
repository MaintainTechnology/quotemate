import { describe, it, expect } from 'vitest'
import { resolveAcceptView } from './accept'

const base = {
  token: 'tok_abc123',
  tier: 'better' as const,
  isPaid: false,
  pricesVisible: true,
  priceExpired: false,
  priceLabel: '$3,970 inc GST',
  depositLabel: '30% deposit ($1,191)',
}

describe('resolveAcceptView', () => {
  it('confirmed + priced + hold live → deposit path to /r/<token>/<tier>', () => {
    const v = resolveAcceptView(base)
    expect(v.mode).toBe('deposit')
    expect(v.payHref).toBe('/r/tok_abc123/better')
    expect(v.acceptTier).toBe('better')
    expect(v.actionable).toBe(true)
    expect(v.ctaLabel).toMatch(/accept/i)
    // Records the exact price the customer accepted (Jon's legal record).
    expect(v.confirmations.some((c) => c.includes('$3,970 inc GST'))).toBe(true)
    // Deposit line carried through.
    expect(v.confirmations.some((c) => c.includes('30% deposit ($1,191)'))).toBe(true)
  })

  it('held for review (prices not visible) → $99 site-visit path', () => {
    const v = resolveAcceptView({ ...base, pricesVisible: false })
    expect(v.mode).toBe('inspection')
    expect(v.payHref).toBe('/r/tok_abc123/inspection')
    expect(v.acceptTier).toBe('inspection')
    expect(v.actionable).toBe(true)
    expect(v.ctaLabel).toMatch(/\$99/)
  })

  it('held quote honours a custom site-visit fee', () => {
    const v = resolveAcceptView({ ...base, pricesVisible: false, siteVisitFee: '$149' })
    expect(v.ctaLabel).toContain('$149')
    expect(v.confirmations.some((c) => c.includes('$149'))).toBe(true)
  })

  it('already paid → terminal paid state, no action, no pay href', () => {
    const v = resolveAcceptView({ ...base, isPaid: true })
    expect(v.mode).toBe('paid')
    expect(v.payHref).toBeNull()
    expect(v.actionable).toBe(false)
  })

  it('paid wins even when prices are not visible', () => {
    const v = resolveAcceptView({ ...base, isPaid: true, pricesVisible: false })
    expect(v.mode).toBe('paid')
  })

  it('priced but price hold expired → expired terminal state (no charge path)', () => {
    const v = resolveAcceptView({ ...base, priceExpired: true })
    expect(v.mode).toBe('expired')
    expect(v.payHref).toBeNull()
    expect(v.actionable).toBe(false)
  })

  it('expired only applies to a priced quote — a held quote ignores the flag and offers the site visit', () => {
    const v = resolveAcceptView({ ...base, pricesVisible: false, priceExpired: true })
    expect(v.mode).toBe('inspection')
    expect(v.payHref).toBe('/r/tok_abc123/inspection')
  })

  it('deposit path can omit the site-visit confirmation bullet', () => {
    const v = resolveAcceptView({ ...base, confirmsSiteVisit: false })
    expect(v.confirmations.some((c) => /site visit|start time/i.test(c))).toBe(false)
  })

  it('deposit path without a deposit label still explains the next step', () => {
    const v = resolveAcceptView({ ...base, depositLabel: null })
    expect(v.mode).toBe('deposit')
    expect(v.confirmations.some((c) => /deposit/i.test(c))).toBe(true)
  })

  it('honours a depositHref override (non-quotes surface, e.g. residential paint)', () => {
    const v = resolveAcceptView({ ...base, depositHref: '/r/paint/tok_abc123/better' })
    expect(v.mode).toBe('deposit')
    expect(v.payHref).toBe('/r/paint/tok_abc123/better')
  })

  it('honours an inspectionHref override (roofing dedicated surface)', () => {
    const v = resolveAcceptView({
      ...base,
      pricesVisible: false,
      inspectionHref: '/r/roof/tok_abc123/inspection',
    })
    expect(v.mode).toBe('inspection')
    expect(v.payHref).toBe('/r/roof/tok_abc123/inspection')
  })
})
