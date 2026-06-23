// c:/Users/dalig/Downloads/QuoteMax/quoteMate/.claude/worktrees/solar-estimate/quotemate-automation/lib/solar/deposit-cta.test.ts
import { describe, expect, it } from 'vitest'
import { resolveSolarDepositCta } from './deposit-cta'

describe('resolveSolarDepositCta', () => {
  it('hides prices and the CTA before the tradie confirms', () => {
    const cta = resolveSolarDepositCta({
      confirmed: false,
      token: 'abc123def456',
      tier: 'better',
      inspectionRequired: false,
    })
    expect(cta).toEqual({ show: false, href: null, reason: 'awaiting_confirmation' })
  })

  it('shows the per-tier /r redirect link once confirmed', () => {
    const cta = resolveSolarDepositCta({
      confirmed: true,
      token: 'abc123def456',
      tier: 'better',
      inspectionRequired: false,
    })
    expect(cta).toEqual({
      show: true,
      href: '/r/abc123def456/better',
      reason: 'ready',
    })
  })

  it('builds the correct href per tier key', () => {
    expect(
      resolveSolarDepositCta({
        confirmed: true,
        token: 'tok',
        tier: 'good',
        inspectionRequired: false,
      }).href,
    ).toBe('/r/tok/good')
    expect(
      resolveSolarDepositCta({
        confirmed: true,
        token: 'tok',
        tier: 'best',
        inspectionRequired: false,
      }).href,
    ).toBe('/r/tok/best')
  })

  it('never shows a deposit CTA when the estimate is routed to inspection', () => {
    const cta = resolveSolarDepositCta({
      confirmed: true,
      token: 'abc123def456',
      tier: 'better',
      inspectionRequired: true,
    })
    expect(cta).toEqual({ show: false, href: null, reason: 'inspection_required' })
  })
})
