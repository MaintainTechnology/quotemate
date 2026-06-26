// ════════════════════════════════════════════════════════════════════
// Painting — per-tier Stripe Checkout deposit sessions.
//
// Mirrors lib/stripe/checkout.ts createCheckoutSessionsForQuote, but for the
// residential painting quote, whose tiers carry inc-GST point prices directly
// (not ex-GST subtotals). Each Session charges the deposit (default 30% of the
// tier's inc-GST total) and the URLs are stored on
// painting_measurements.stripe_links, read by /r/paint/[token]/[tier].
//
// Platform-direct charging (NOT Connect) — money lands in QuoteMax's account,
// the same v1 posture as the main quote flow. AUD-only, address-free.
//
// The session-creation call is I/O; the deposit-amount maths is a pure,
// unit-tested helper.
// ════════════════════════════════════════════════════════════════════

import { getStripe } from './client'
import type { StripeLinks } from './checkout'
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
  const stripe = getStripe()
  const depositPct = opts.depositPct ?? DEFAULT_PAINTING_DEPOSIT_PCT
  const links: StripeLinks = {}

  for (const tier of opts.estimate.price.tiers) {
    const deposit = paintingDepositCents(tier.inc_gst, depositPct)
    if (deposit <= 0) continue

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
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

    if (session.url) links[tier.tier] = session.url
  }

  return links
}
