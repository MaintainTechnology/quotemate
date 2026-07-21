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
  const subscriptionsRetrieve = vi.fn(async (id: string) => ({
    id,
    items: { data: [{ id: 'si_existing_1' }] },
  }))
  const subscriptionsUpdate = vi.fn(async (_id: string, _params: Record<string, any>) => ({}))
  const customersRetrieve = vi.fn(async (id: string) => ({ id })) // exists, not deleted
  const customersCreate = vi.fn(async (_p: Record<string, any>) => ({ id: 'cus_new_1' }))
  return {
    pricesList,
    sessionsCreate,
    subscriptionsRetrieve,
    subscriptionsUpdate,
    customersRetrieve,
    customersCreate,
  }
})

vi.mock('./client', () => ({
  getStripe: () => ({
    prices: { list: h.pricesList },
    checkout: { sessions: { create: h.sessionsCreate } },
    subscriptions: { retrieve: h.subscriptionsRetrieve, update: h.subscriptionsUpdate },
    customers: { retrieve: h.customersRetrieve, create: h.customersCreate },
  }),
}))

import {
  createSubscriptionCheckout,
  updateSubscriptionToPlan,
  getOrCreateCustomer,
  isUpdatableStatus,
  lookupKey,
  parseLookupKey,
  subscriptionToTenantPatch,
} from './billing'

beforeEach(() => {
  h.pricesList.mockClear()
  h.sessionsCreate.mockClear()
  h.subscriptionsRetrieve.mockClear()
  h.subscriptionsUpdate.mockClear()
  h.customersRetrieve.mockClear()
  h.customersCreate.mockClear()
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

  // The tradie's own subscription checkout gets the same AU posture as the
  // customer-facing ones (locked for those in checkout.au.test.ts). Asserted
  // here too so all six Session sites are covered, not five.
  it('carries the AU posture: Adaptive Pricing off and Link hidden', async () => {
    await createSubscriptionCheckout({ ...base, plan: 'pro', interval: 'month' })
    const arg = h.sessionsCreate.mock.calls[0][0] as Record<string, any>
    expect(arg.adaptive_pricing).toEqual({ enabled: false })
    expect(arg.wallet_options).toEqual({ link: { display: 'never' } })
    expect(arg.payment_method_types).toBeUndefined()
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

describe('updateSubscriptionToPlan — in-place, prorated change (NO new subscription)', () => {
  it('swaps the existing item to the new price with proration and NEVER creates a Checkout Session', async () => {
    await updateSubscriptionToPlan({
      tenantId: 'tenant-1',
      subscriptionId: 'sub_existing',
      plan: 'crew',
      interval: 'month',
    })
    // Resolved the target price by lookup_key.
    expect(h.pricesList).toHaveBeenCalledWith(
      expect.objectContaining({ lookup_keys: ['qm_crew_month'] }),
    )
    // Retrieved the existing subscription to find its item id.
    expect(h.subscriptionsRetrieve).toHaveBeenCalledWith('sub_existing')
    // Updated that subscription IN PLACE with proration.
    expect(h.subscriptionsUpdate).toHaveBeenCalledTimes(1)
    const [subId, params] = h.subscriptionsUpdate.mock.calls[0]
    expect(subId).toBe('sub_existing')
    expect(params.items).toEqual([{ id: 'si_existing_1', price: 'price_qm_crew_month' }])
    expect(params.proration_behavior).toBe('create_prorations')
    expect(params.metadata).toEqual({ tenant_id: 'tenant-1', plan: 'crew', interval: 'month' })
    // Crucially: no second subscription was ever opened.
    expect(h.sessionsCreate).not.toHaveBeenCalled()
  })

  it('throws (rather than duplicating) if the subscription has no line item', async () => {
    h.subscriptionsRetrieve.mockResolvedValueOnce({ id: 'sub_x', items: { data: [] } } as any)
    await expect(
      updateSubscriptionToPlan({
        tenantId: 't',
        subscriptionId: 'sub_x',
        plan: 'pro',
        interval: 'year',
      }),
    ).rejects.toThrow(/no line item/)
    expect(h.sessionsCreate).not.toHaveBeenCalled()
  })
})

describe('getOrCreateCustomer — reuses a valid customer, self-heals a stale id', () => {
  const base = { tenantId: 't1', email: 'a@b.com', name: 'Biz' }

  it('reuses an existing customer that still exists in Stripe (no create, no persist)', async () => {
    const persist = vi.fn(async () => {})
    const id = await getOrCreateCustomer({ ...base, existingCustomerId: 'cus_ok', persist })
    expect(id).toBe('cus_ok')
    expect(h.customersRetrieve).toHaveBeenCalledWith('cus_ok')
    expect(h.customersCreate).not.toHaveBeenCalled()
    expect(persist).not.toHaveBeenCalled()
  })

  it('creates + persists when there is no existing customer id', async () => {
    const persist = vi.fn(async () => {})
    const id = await getOrCreateCustomer({ ...base, existingCustomerId: null, persist })
    expect(id).toBe('cus_new_1')
    expect(h.customersCreate).toHaveBeenCalledTimes(1)
    expect(persist).toHaveBeenCalledWith('cus_new_1')
  })

  // Every tenant is an Australian trade business, so the Customer is stamped AU
  // rather than left country-less. It is the only address signal Stripe has for
  // the tradie: it steers the billing form and keeps tax/reporting honest.
  it('stamps the customer as Australian', async () => {
    await getOrCreateCustomer({ ...base, existingCustomerId: null, persist: vi.fn(async () => {}) })
    const arg = h.customersCreate.mock.calls[0][0] as Record<string, any>
    expect(arg.address).toEqual({ country: 'AU' })
  })

  it('self-heals when the persisted customer is missing in Stripe (retrieve throws)', async () => {
    h.customersRetrieve.mockRejectedValueOnce(new Error('No such customer: cus_stale'))
    const persist = vi.fn(async () => {})
    const id = await getOrCreateCustomer({ ...base, existingCustomerId: 'cus_stale', persist })
    expect(id).toBe('cus_new_1')
    expect(h.customersCreate).toHaveBeenCalledTimes(1)
    expect(persist).toHaveBeenCalledWith('cus_new_1')
  })

  it('self-heals when Stripe returns a deleted-customer stub', async () => {
    h.customersRetrieve.mockResolvedValueOnce({ id: 'cus_del', deleted: true } as any)
    const persist = vi.fn(async () => {})
    const id = await getOrCreateCustomer({ ...base, existingCustomerId: 'cus_del', persist })
    expect(id).toBe('cus_new_1')
    expect(h.customersCreate).toHaveBeenCalledTimes(1)
    expect(persist).toHaveBeenCalledWith('cus_new_1')
  })
})

describe('isUpdatableStatus — live subs are updated in place, dead ones start fresh', () => {
  it('treats trialing/active/past_due as updatable', () => {
    for (const s of ['trialing', 'active', 'past_due']) expect(isUpdatableStatus(s)).toBe(true)
  })
  it('treats canceled/unpaid/incomplete/none as NOT updatable (start a new subscription)', () => {
    for (const s of ['canceled', 'unpaid', 'incomplete', 'incomplete_expired', null, undefined])
      expect(isUpdatableStatus(s)).toBe(false)
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
