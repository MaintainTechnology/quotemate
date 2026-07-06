// Subscription Checkout wiring for the tradie tiers. Verifies that both the
// monthly and annual CTAs resolve a Price by lookup_key and hand back the
// hosted Stripe Checkout URL, that the 14-day trial is applied to Starter
// Monthly ONLY, and that lookup_key parsing round-trips.

import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => {
  const pricesList = vi.fn(async ({ lookup_keys }: { lookup_keys: string[] }) => ({
    data: [{ id: `price_${lookup_keys[0]}` }],
  }))
  const sessionsCreate = vi.fn(async (_params: Record<string, any>) => ({
    id: 'cs_test_sub_1',
    url: 'https://checkout.stripe.com/c/pay/cs_test_sub_1',
  }))
  return { pricesList, sessionsCreate }
})

vi.mock('./client', () => ({
  getStripe: () => ({
    prices: { list: h.pricesList },
    checkout: { sessions: { create: h.sessionsCreate } },
  }),
}))

import {
  createSubscriptionCheckout,
  lookupKey,
  parseLookupKey,
  subscriptionToTenantPatch,
} from './billing'

beforeEach(() => {
  h.pricesList.mockClear()
  h.sessionsCreate.mockClear()
})

const base = { tenantId: 'tenant-1', customerId: 'cus_1' }

describe('createSubscriptionCheckout — monthly + annual redirect to Stripe', () => {
  it('resolves the monthly price by lookup_key and returns the hosted URL', async () => {
    const url = await createSubscriptionCheckout({ ...base, plan: 'pro', interval: 'month' })
    expect(url).toBe('https://checkout.stripe.com/c/pay/cs_test_sub_1')
    expect(h.pricesList).toHaveBeenCalledWith(
      expect.objectContaining({ lookup_keys: ['qm_pro_month'] }),
    )
    const arg = h.sessionsCreate.mock.calls[0][0] as Record<string, any>
    expect(arg.mode).toBe('subscription')
    expect(arg.customer).toBe('cus_1')
    expect(arg.line_items).toEqual([{ price: 'price_qm_pro_month', quantity: 1 }])
    expect(arg.client_reference_id).toBe('tenant-1')
    expect(arg.success_url).toMatch(/\/dashboard\?tab=billing&subscribed=1$/)
    expect(arg.cancel_url).toMatch(/\/pricing$/)
  })

  it('resolves the annual price by lookup_key and returns the hosted URL', async () => {
    const url = await createSubscriptionCheckout({ ...base, plan: 'pro', interval: 'year' })
    expect(url).toBe('https://checkout.stripe.com/c/pay/cs_test_sub_1')
    expect(h.pricesList).toHaveBeenCalledWith(
      expect.objectContaining({ lookup_keys: ['qm_pro_year'] }),
    )
    const arg = h.sessionsCreate.mock.calls[0][0] as Record<string, any>
    expect(arg.line_items).toEqual([{ price: 'price_qm_pro_year', quantity: 1 }])
  })
})

describe('14-day trial — Starter Monthly only', () => {
  it('applies a 14-day trial on Starter Monthly', async () => {
    await createSubscriptionCheckout({ ...base, plan: 'starter', interval: 'month' })
    const arg = h.sessionsCreate.mock.calls[0][0] as Record<string, any>
    expect(arg.subscription_data.trial_period_days).toBe(14)
  })

  it('does NOT apply a trial on Starter Annual', async () => {
    await createSubscriptionCheckout({ ...base, plan: 'starter', interval: 'year' })
    const arg = h.sessionsCreate.mock.calls[0][0] as Record<string, any>
    expect(arg.subscription_data.trial_period_days).toBeUndefined()
  })

  it('does NOT apply a trial on Pro Monthly', async () => {
    await createSubscriptionCheckout({ ...base, plan: 'pro', interval: 'month' })
    const arg = h.sessionsCreate.mock.calls[0][0] as Record<string, any>
    expect(arg.subscription_data.trial_period_days).toBeUndefined()
  })
})

describe('lookup_key round-trip', () => {
  it('parses back the plan + interval it builds', () => {
    for (const plan of ['starter', 'pro', 'crew'] as const) {
      for (const interval of ['month', 'year'] as const) {
        expect(parseLookupKey(lookupKey(plan, interval))).toEqual({ plan, interval })
      }
    }
  })

  it('rejects a foreign lookup_key', () => {
    expect(parseLookupKey('price_123')).toBeNull()
    expect(parseLookupKey(null)).toBeNull()
  })
})

describe('subscriptionToTenantPatch', () => {
  it('mirrors status + plan + interval from the subscribed price', () => {
    const patch = subscriptionToTenantPatch({
      id: 'sub_1',
      status: 'active',
      cancel_at_period_end: false,
      trial_end: null,
      items: { data: [{ price: { lookup_key: 'qm_pro_year', recurring: { interval: 'year' } } }] },
    } as any)
    expect(patch.stripe_subscription_id).toBe('sub_1')
    expect(patch.subscription_status).toBe('active')
    expect(patch.subscription_plan).toBe('pro')
    expect(patch.subscription_interval).toBe('year')
  })
})
