// Pure logic for the Clerk subscription mirror. The network write
// (syncSubscriptionToClerk) is a thin best-effort wrapper; here we pin the
// pure reader used by guards and the no-op short-circuits that must never
// touch the network.

import { describe, it, expect } from 'vitest'
import { subscriptionFromPublicMetadata, syncSubscriptionToClerk } from './metadata'

describe('subscriptionFromPublicMetadata', () => {
  it('reads a well-formed subscription mirror', () => {
    expect(
      subscriptionFromPublicMetadata({
        is_admin: true,
        subscription: { plan: 'pro', status: 'active', interval: 'month' },
      }),
    ).toEqual({ plan: 'pro', status: 'active', interval: 'month' })
  })

  it('returns null when there is no subscription object', () => {
    expect(subscriptionFromPublicMetadata({ is_admin: false })).toBeNull()
    expect(subscriptionFromPublicMetadata(null)).toBeNull()
    expect(subscriptionFromPublicMetadata(undefined)).toBeNull()
    expect(subscriptionFromPublicMetadata('nope')).toBeNull()
  })

  it('coerces missing/typed-wrong fields to null rather than throwing', () => {
    expect(subscriptionFromPublicMetadata({ subscription: {} })).toEqual({
      plan: null,
      status: null,
      interval: null,
    })
    expect(
      subscriptionFromPublicMetadata({ subscription: { plan: 42, status: null, interval: 'year' } }),
    ).toEqual({ plan: null, status: null, interval: 'year' })
  })
})

describe('syncSubscriptionToClerk — safe short-circuits', () => {
  it('returns false for a missing clerk user id (no network)', async () => {
    const sub = { plan: 'pro', status: 'active', interval: 'month' }
    expect(await syncSubscriptionToClerk(null, sub)).toBe(false)
    expect(await syncSubscriptionToClerk(undefined, sub)).toBe(false)
    expect(await syncSubscriptionToClerk('', sub)).toBe(false)
  })

  it('returns false when no secret key is configured (no network)', async () => {
    expect(
      await syncSubscriptionToClerk('user_1', { plan: 'pro', status: 'active', interval: 'month' }, {
        secretKey: '',
      }),
    ).toBe(false)
  })
})
