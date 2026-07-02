// Verifies the Connect wiring on the Checkout Session creators: with a
// `connect` destination the Session must be a destination charge carrying
// the 2% application fee (+ the metadata the webhook stamps from); without
// one it must stay platform-direct, byte-identical to the legacy shape.

import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => {
  const sessionsCreate = vi.fn(async () => ({
    id: 'cs_test_1',
    url: 'https://checkout.stripe.com/c/pay/cs_test_1',
  }))
  return { sessionsCreate }
})

vi.mock('./client', () => ({
  getStripe: () => ({ checkout: { sessions: { create: h.sessionsCreate } } }),
}))

import {
  createCheckoutSessionForTier,
  createInspectionCheckoutSession,
} from './checkout'

beforeEach(() => h.sessionsCreate.mockClear())

const quote = {
  id: 'quote-1',
  good: null,
  better: { label: 'Better', subtotal_ex_gst: 1000 }, // ×1.1 GST → $1,100 → 30% = 33000c
  best: null,
  deposit_pct: 30,
}
const intake = { job_type: 'downlights', scope: null, caller: null }
const base = { quote, tierKey: 'better' as const, intake, shareToken: 'tok', appUrl: 'https://x.test' }

describe('createCheckoutSessionForTier — Connect routing', () => {
  it('adds destination-charge params + 2% fee when a connect destination is passed', async () => {
    const url = await createCheckoutSessionForTier({ ...base, connect: { accountId: 'acct_1' } })
    expect(url).toBe('https://checkout.stripe.com/c/pay/cs_test_1')
    const arg = h.sessionsCreate.mock.calls[0][0] as Record<string, any>
    expect(arg.payment_intent_data).toMatchObject({
      on_behalf_of: 'acct_1',
      transfer_data: { destination: 'acct_1' },
      application_fee_amount: 660,
    })
    expect(arg.metadata).toMatchObject({
      connect_destination: 'acct_1',
      application_fee_cents: '660',
    })
  })

  it('stays platform-direct without one', async () => {
    await createCheckoutSessionForTier(base)
    const arg = h.sessionsCreate.mock.calls[0][0] as Record<string, any>
    expect(arg.payment_intent_data.on_behalf_of).toBeUndefined()
    expect(arg.payment_intent_data.transfer_data).toBeUndefined()
    expect(arg.payment_intent_data.application_fee_amount).toBeUndefined()
    expect(arg.metadata.connect_destination).toBeUndefined()
  })
})

describe('createInspectionCheckoutSession — Connect routing', () => {
  it('routes the $99 fee via Connect (2% = $1.98)', async () => {
    await createInspectionCheckoutSession({
      quoteId: 'quote-1',
      intake,
      shareToken: 'tok',
      appUrl: 'https://x.test',
      connect: { accountId: 'acct_1' },
    })
    const arg = h.sessionsCreate.mock.calls[0][0] as Record<string, any>
    expect(arg.payment_intent_data).toMatchObject({
      on_behalf_of: 'acct_1',
      transfer_data: { destination: 'acct_1' },
      application_fee_amount: 198,
    })
    expect(arg.metadata.application_fee_cents).toBe('198')
  })
})
