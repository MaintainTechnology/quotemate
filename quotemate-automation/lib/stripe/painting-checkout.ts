// ════════════════════════════════════════════════════════════════════
// Painting — per-tier Stripe Checkout deposit sessions.
//
// Mirrors lib/stripe/checkout.ts createCheckoutSessionsForQuote, but for the
// residential painting quote, whose tiers carry inc-GST point prices directly
// (not ex-GST subtotals). Each Session charges the deposit (default 30% of the
// tier's inc-GST total) and the URLs are stored on
// painting_measurements.stripe_links.
//
// ⚠ The G/B/B deposit path is RETIRED from the customer surface (spec
// painting-site-visit-first, owner decision 2026-08-05): /r/paint 302s every
// tier request onto the $99 site visit, so createPaintingCheckoutSession(s)
// ForTier is no longer reachable from a customer click. Kept deliberately —
// re-enabling the deposit model is a routing change, not a rebuild. It also
// charged platform-direct (NOT Connect), which is part of why it was retired.
//
// The live customer payment is createPaintingSiteVisitSession below: the flat
// $99 refundable visit, which mirrors the roofing site-visit mint and rides
// Connect when the tenant has a connected account. AUD-only, address-free.
//
// The session-creation call is I/O; the deposit-amount maths is a pure,
// unit-tested helper.
// ════════════════════════════════════════════════════════════════════

import { getStripe } from './client'
import type { StripeLinks } from './checkout'
import {
  connectPaymentIntentExtras,
  connectSessionMetadata,
  type ConnectDestination,
} from './connect'
import { INSPECTION_FEE_AUD_CENTS } from '@/lib/quote/money'
import type { PaintingEstimate } from '@/lib/painting/types'

/** Default deposit percentage for a painting job (matches the main flow's
 *  30% default). Move to pricing_book when per-tenant configurability lands. */
export const DEFAULT_PAINTING_DEPOSIT_PCT = 30

/**
 * PURE — the deposit amount in cents for a painting tier's inc-GST point
 * price. A non-positive price or pct yields 0 (the caller skips that tier).
 */
export function paintingDepositCents(incGst: number, depositPct: number): number {
  if (!Number.isFinite(incGst) || incGst <= 0) return 0
  const pct = Number.isFinite(depositPct) && depositPct > 0 ? depositPct : DEFAULT_PAINTING_DEPOSIT_PCT
  return Math.round(incGst * 100 * (pct / 100))
}

/**
 * Create a Stripe Checkout Session for ONE painting tier. Used by the
 * all-tiers draft mint below AND by /r/paint's fresh-mint-per-click path:
 * Checkout Sessions die after Stripe's 24h max, so the URL minted at save
 * time is usually dead by the time the tradie has released the quote and
 * the customer taps the SMS link. Returns null for a missing/unpriced tier.
 */
export async function createPaintingCheckoutSessionForTier(opts: {
  estimate: PaintingEstimate
  tierKey: 'good' | 'better' | 'best'
  /** painting_measurements.public_token — drives success/cancel URLs. */
  token: string
  /** Base URL for success/cancel, e.g. https://quote-mate-rho.vercel.app */
  appUrl: string
  depositPct?: number
}): Promise<string | null> {
  const stripe = getStripe()
  const depositPct = opts.depositPct ?? DEFAULT_PAINTING_DEPOSIT_PCT
  const tier = opts.estimate.price.tiers.find((t) => t.tier === opts.tierKey)
  if (!tier) return null
  const deposit = paintingDepositCents(tier.inc_gst, depositPct)
  if (deposit <= 0) return null

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    // AU-only business: force AUD, never localise the price to another currency
    // (turns OFF Stripe Adaptive Pricing so no US$ / "choose a currency" option).
    adaptive_pricing: { enabled: false },
    // Link renders the 'Save my information for faster checkout' row and a
    // US-format phone field. Hidden per-session (not via the Dashboard) so it
    // stays hidden when the charge rides on a tradie's connected account.
    wallet_options: { link: { display: 'never' } },
    line_items: [
      {
        price_data: {
          currency: 'aud',
          product_data: {
            name: `QuoteMax — painting · ${tier.label}`,
            description: `${depositPct}% deposit · balance due on completion`,
          },
          unit_amount: deposit,
        },
        quantity: 1,
      },
    ],
    success_url: `${opts.appUrl}/q/paint/${opts.token}?paid=1&tier=${tier.tier}&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${opts.appUrl}/q/paint/${opts.token}`,
    // painting_token (NOT quote_id) so the webhook records the deposit on
    // painting_measurements, not the quotes table.
    metadata: {
      painting_token: opts.token,
      tier: tier.tier,
      deposit_pct: String(depositPct),
      full_total_inc_gst_cents: String(Math.round(tier.inc_gst * 100)),
    },
    payment_intent_data: {
      metadata: { painting_token: opts.token, tier: tier.tier },
    },
  })

  return session.url ?? null
}

/**
 * Painting site-visit path: a single flat $99 refundable Checkout Session
 * for an INSPECTION-ROUTED painting row (spec painting-funnel-parity R2) —
 * the row has no committable tier prices, so the only payable action is the
 * visit. Mirrors createRoofingSiteVisitSession (lib/stripe/checkout.ts) but
 * keyed by metadata.painting_token + tier 'inspection', so the EXISTING
 * webhook branch records paid_at / paid_tier / paid_amount_cents on
 * painting_measurements unchanged. Success lands on the dedicated /book
 * page (calendar picker), whose session_id race guard already ties a
 * session to this row.
 */
export async function createPaintingSiteVisitSession(opts: {
  /** painting_measurements.public_token — drives success/cancel URLs. */
  token: string
  address: string | null
  customerEmail?: string | null
  appUrl: string
  /** Tenant's live connected account — routes the charge via Connect with
   *  the platform fee. Omitted/null → platform-direct. */
  connect?: ConnectDestination | null
}): Promise<string | null> {
  const stripe = getStripe()
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    // AU-only business: force AUD, never localise the price to another currency
    // (turns OFF Stripe Adaptive Pricing so no US$ / "choose a currency" option).
    adaptive_pricing: { enabled: false },
    // Link renders the 'Save my information for faster checkout' row and a
    // US-format phone field. Hidden per-session (not via the Dashboard) so it
    // stays hidden when the charge rides on a tradie's connected account.
    wallet_options: { link: { display: 'never' } },
    line_items: [
      {
        price_data: {
          currency: 'aud',
          product_data: {
            name: `QuoteMax — painting site visit${opts.address ? ` · ${opts.address}` : ''}`,
            description:
              'Refundable site-visit deposit. Credited toward your final painting quote when you proceed.',
          },
          unit_amount: INSPECTION_FEE_AUD_CENTS,
        },
        quantity: 1,
      },
    ],
    customer_email: opts.customerEmail || undefined,
    // Land on the dedicated booking page (calendar picker) instead of
    // scrolling back on the quote surface — mirrors the roofing site visit.
    success_url: `${opts.appUrl}/q/paint/${opts.token}/book?paid=1&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${opts.appUrl}/q/paint/${opts.token}`,
    metadata: {
      painting_token: opts.token,
      tier: 'inspection',
      fee_aud_cents: String(INSPECTION_FEE_AUD_CENTS),
      ...(opts.connect ? connectSessionMetadata(INSPECTION_FEE_AUD_CENTS, opts.connect) : {}),
    },
    payment_intent_data: {
      metadata: { painting_token: opts.token, tier: 'inspection' },
      ...(opts.connect ? connectPaymentIntentExtras(INSPECTION_FEE_AUD_CENTS, opts.connect) : {}),
    },
  })
  return session.url ?? null
}

/**
 * Create one Stripe Checkout Session per priced painting tier (good/better/
 * best) and return a { good, better, best } map of Session URLs. Best-effort
 * at the call site: the I/O can throw (no STRIPE_SECRET_KEY, Stripe down) and
 * the caller treats a throw / empty map as "no deposit links" so the SMS still
 * sends with the quote-page + PDF links.
 */
export async function createPaintingCheckoutSessions(opts: {
  estimate: PaintingEstimate
  /** painting_measurements.public_token — drives success/cancel URLs. */
  token: string
  address: string
  /** Base URL for success/cancel, e.g. https://quote-mate-rho.vercel.app */
  appUrl: string
  depositPct?: number
}): Promise<StripeLinks> {
  const links: StripeLinks = {}
  for (const tier of opts.estimate.price.tiers) {
    const url = await createPaintingCheckoutSessionForTier({
      estimate: opts.estimate,
      tierKey: tier.tier,
      token: opts.token,
      appUrl: opts.appUrl,
      depositPct: opts.depositPct,
    })
    if (url) links[tier.tier] = url
  }
  return links
}
