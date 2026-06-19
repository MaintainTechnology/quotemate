import { describe, it, expect, afterEach } from 'vitest'
import {
  checkQuoteEntitlement,
  checkVoiceEntitlement,
  hasActiveSubscription,
  planLimits,
} from './entitlements'

const ENV = process.env.BILLING_ENFORCEMENT_ENABLED
afterEach(() => {
  if (ENV === undefined) delete process.env.BILLING_ENFORCEMENT_ENABLED
  else process.env.BILLING_ENFORCEMENT_ENABLED = ENV
})
function enforce(on: boolean) {
  process.env.BILLING_ENFORCEMENT_ENABLED = on ? 'true' : 'false'
}

const ZERO = { quotesUsed: 0, voiceMinutesUsed: 0 }

describe('enforcement flag', () => {
  it('allows everything when enforcement is OFF, regardless of subscription', () => {
    enforce(false)
    const t = { subscription_status: null, subscription_plan: null }
    expect(checkQuoteEntitlement(t, ZERO).allowed).toBe(true)
    expect(checkVoiceEntitlement(t, ZERO).allowed).toBe(true)
  })

  it('bypasses a billing_exempt tenant even when enforcement is ON', () => {
    enforce(true)
    const t = { subscription_status: null, subscription_plan: null, billing_exempt: true }
    expect(checkQuoteEntitlement(t, ZERO).allowed).toBe(true)
    expect(checkVoiceEntitlement(t, ZERO).allowed).toBe(true)
  })
})

describe('quote entitlement (enforcement ON)', () => {
  it('blocks when there is no active subscription', () => {
    enforce(true)
    const r = checkQuoteEntitlement({ subscription_status: 'canceled', subscription_plan: 'pro' }, ZERO)
    expect(r.allowed).toBe(false)
    expect(r.reason).toBe('no_active_subscription')
  })

  it('allows within fair-use on an active plan', () => {
    enforce(true)
    const r = checkQuoteEntitlement(
      { subscription_status: 'active', subscription_plan: 'pro' },
      { quotesUsed: 10, voiceMinutesUsed: 0 },
    )
    expect(r.allowed).toBe(true)
    expect(r.overFairUse).toBe(false)
  })

  it('allows but flags overage past the plan quote allowance (never hard-blocks quotes)', () => {
    enforce(true)
    const r = checkQuoteEntitlement(
      { subscription_status: 'active', subscription_plan: 'starter' },
      { quotesUsed: 40, voiceMinutesUsed: 0 }, // starter cap = 40
    )
    expect(r.allowed).toBe(true)
    expect(r.overFairUse).toBe(true)
  })

  it('treats trialing and past_due as active', () => {
    enforce(true)
    expect(
      checkQuoteEntitlement({ subscription_status: 'trialing', subscription_plan: 'pro' }, ZERO).allowed,
    ).toBe(true)
    expect(
      checkQuoteEntitlement({ subscription_status: 'past_due', subscription_plan: 'pro' }, ZERO).allowed,
    ).toBe(true)
  })
})

describe('voice entitlement (enforcement ON)', () => {
  it('blocks voice on Starter (voice not on plan)', () => {
    enforce(true)
    const r = checkVoiceEntitlement({ subscription_status: 'active', subscription_plan: 'starter' }, ZERO)
    expect(r.allowed).toBe(false)
    expect(r.reason).toBe('voice_not_on_plan')
  })

  it('allows voice on Pro within the minute pool', () => {
    enforce(true)
    const r = checkVoiceEntitlement(
      { subscription_status: 'active', subscription_plan: 'pro' },
      { quotesUsed: 0, voiceMinutesUsed: 100 }, // pro pool = 300
    )
    expect(r.allowed).toBe(true)
  })

  it('blocks voice once the minute pool is exhausted', () => {
    enforce(true)
    const r = checkVoiceEntitlement(
      { subscription_status: 'active', subscription_plan: 'pro' },
      { quotesUsed: 0, voiceMinutesUsed: 300 },
    )
    expect(r.allowed).toBe(false)
    expect(r.reason).toBe('voice_minutes_exhausted')
  })

  it('blocks voice when there is no active subscription', () => {
    enforce(true)
    const r = checkVoiceEntitlement({ subscription_status: null, subscription_plan: null }, ZERO)
    expect(r.allowed).toBe(false)
    expect(r.reason).toBe('no_active_subscription')
  })
})

describe('helpers', () => {
  it('hasActiveSubscription covers the active set only', () => {
    expect(hasActiveSubscription({ subscription_status: 'active', subscription_plan: 'pro' })).toBe(true)
    expect(hasActiveSubscription({ subscription_status: 'trialing', subscription_plan: 'pro' })).toBe(true)
    expect(hasActiveSubscription({ subscription_status: 'past_due', subscription_plan: 'pro' })).toBe(true)
    expect(hasActiveSubscription({ subscription_status: 'canceled', subscription_plan: 'pro' })).toBe(false)
    expect(hasActiveSubscription({ subscription_status: null, subscription_plan: null })).toBe(false)
  })

  it('planLimits returns null for unknown plans', () => {
    expect(planLimits('pro')?.voiceMinutes).toBe(300)
    expect(planLimits('crew')?.quotes).toBe(400)
    expect(planLimits('starter')?.voice).toBe(false)
    expect(planLimits(null)).toBeNull()
    expect(planLimits('enterprise')).toBeNull()
  })
})
