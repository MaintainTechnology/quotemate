// AU-only checkout posture, locked across EVERY payment-mode Checkout Session
// we create. QuoteMax serves Australian tradies and their customers only, so a
// US-shaped payment sheet (Link's "save my info" + US phone placeholder) is a
// bug, not a cosmetic nit.
//
// Three things are asserted for every Session, and the WHY matters because
// each one is easy to "helpfully" break later:
//
//  1. `adaptive_pricing: { enabled: false }` — off means no "choose a currency:
//     US$ / A$" selector. Stripe defaults this ON at the account level.
//
//  2. `wallet_options.link.display: 'never'` — Link is what renders the "Save
//     my information for faster checkout" row and the US-format phone field.
//     It is NOT removable via `excluded_payment_method_types` (that union has
//     no 'link' member by design); `wallet_options` is the only per-session
//     switch. Setting it per-session rather than in the Dashboard is deliberate:
//     under Connect the charge can ride on the tradie's connected account, and a
//     tradie's own Dashboard toggle would otherwise win.
//
//  3. `payment_method_types` is NOT set — this one is a trap. Passing
//     `['card']` looks like "restrict to cards" but is precisely the documented
//     way to INCLUDE Link in a card integration, and it disables Stripe's
//     dynamic payment methods, freezing the list so future AU methods (PayTo)
//     never appear. The AU account country + `currency: 'aud'` already make
//     us_bank_account / cashapp / affirm structurally ineligible, so the
//     correct value here is "absent". Asserted so nobody adds it back.

import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => {
  const sessionsCreate = vi.fn(async (_params: Record<string, any>) => ({
    id: 'cs_test_1',
    url: 'https://checkout.stripe.com/c/pay/cs_test_1',
  }))
  return { sessionsCreate }
})

vi.mock('./client', () => ({
  getStripe: () => ({ checkout: { sessions: { create: h.sessionsCreate } } }),
}))

import {
  createCheckoutSessionsForQuote,
  createCheckoutSessionForTier,
  createInspectionCheckoutSession,
  createRoofingSiteVisitSession,
} from './checkout'
import {
  createPaintingCheckoutSessionForTier,
  createPaintingSiteVisitSession,
} from './painting-checkout'

// Braces matter: `mockClear()` returns the mock itself, and a function returned
// from beforeEach is treated by Vitest as a teardown callback — so the concise
// arrow form would invoke the Stripe mock once after every test.
beforeEach(() => {
  h.sessionsCreate.mockClear()
})

const quote = {
  id: 'quote-1',
  good: null,
  better: { label: 'Better', subtotal_ex_gst: 1000 },
  best: null,
  deposit_pct: 30,
}
const intake = { job_type: 'downlights', scope: null, caller: null }
const appUrl = 'https://x.test'

/** Every Session-creating entry point, invoked the way production does. */
const CREATORS: Array<[string, () => Promise<unknown>]> = [
  [
    'createCheckoutSessionsForQuote (per-tier deposit)',
    () => createCheckoutSessionsForQuote({ quote, intake, shareToken: 'tok', appUrl }),
  ],
  [
    'createCheckoutSessionForTier (replacement after a price edit)',
    () => createCheckoutSessionForTier({ quote, tierKey: 'better', intake, shareToken: 'tok', appUrl }),
  ],
  [
    'createInspectionCheckoutSession ($99 site visit)',
    () => createInspectionCheckoutSession({ quoteId: 'quote-1', intake, shareToken: 'tok', appUrl }),
  ],
  [
    'createRoofingSiteVisitSession ($99 roof site visit)',
    () => createRoofingSiteVisitSession({ token: 'tok', address: '1 Test St', appUrl }),
  ],
  [
    'createPaintingCheckoutSessionForTier (painting deposit)',
    () =>
      createPaintingCheckoutSessionForTier({
        estimate: { price: { tiers: [{ tier: 'better', label: 'Better', inc_gst: 5000 }] } } as never,
        tierKey: 'better',
        token: 'tok',
        appUrl,
      }),
  ],
  [
    'createPaintingSiteVisitSession ($99 painting site visit)',
    () => createPaintingSiteVisitSession({ token: 'tok', address: '1 Test St', appUrl }),
  ],
]

describe.each(CREATORS)('AU checkout posture — %s', (_name, create) => {
  it('turns Adaptive Pricing off so no US$ currency selector appears', async () => {
    await create()
    const arg = h.sessionsCreate.mock.calls[0][0] as Record<string, any>
    expect(arg.adaptive_pricing).toEqual({ enabled: false })
  })

  it('hides Link, which is what renders "Save my information" and the US phone field', async () => {
    await create()
    const arg = h.sessionsCreate.mock.calls[0][0] as Record<string, any>
    expect(arg.wallet_options).toEqual({ link: { display: 'never' } })
  })

  it('leaves payment_method_types unset — pinning ["card"] would re-enable Link', async () => {
    await create()
    const arg = h.sessionsCreate.mock.calls[0][0] as Record<string, any>
    expect(arg.payment_method_types).toBeUndefined()
  })

  it('prices in AUD', async () => {
    await create()
    const arg = h.sessionsCreate.mock.calls[0][0] as Record<string, any>
    expect(arg.line_items[0].price_data.currency).toBe('aud')
  })
})
