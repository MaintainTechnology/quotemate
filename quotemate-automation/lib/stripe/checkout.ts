// Creates one Stripe Checkout Session per quote tier (good/better/best).
// Each Session charges the deposit (default 30% of inc-GST tier total).
// Returns a { good, better, best } map of Session URLs ready to embed in SMS.
//
// Platform-direct charging (NOT Stripe Connect) — money lands in QuoteMate's
// Stripe account. When tradie #2 onboards, switch to Connect by adding
// `stripeAccount` and `application_fee_amount` to the call.

import { getStripe } from './client'
import { randomBytes } from 'node:crypto'

type Tier = { label: string; subtotal_ex_gst: number | string } | null

type QuoteForCheckout = {
  id: string
  good: Tier
  better: Tier
  best: Tier
  deposit_pct: number | string  // e.g. 30 = 30%
}

type IntakeForCheckout = {
  job_type: string
  scope?: { item_count?: number; description?: string } | null
  caller?: { name?: string; email?: string } | null
}

export type StripeLinks = {
  good?: string
  better?: string
  best?: string
}

/**
 * Generate a URL-safe share token (used in success URLs and future portal route).
 * 16 bytes → 22 chars after base64url, ~128 bits of entropy.
 */
export function generateShareToken(): string {
  return randomBytes(16).toString('base64url')
}

function tierIncGstCents(tier: Tier): number {
  if (!tier) return 0
  const ex = typeof tier.subtotal_ex_gst === 'string' ? parseFloat(tier.subtotal_ex_gst) : tier.subtotal_ex_gst
  const inc = ex * 1.10
  return Math.round(inc * 100)
}

function depositCents(tierIncGstCents: number, depositPct: number): number {
  return Math.round(tierIncGstCents * (depositPct / 100))
}

export async function createCheckoutSessionsForQuote(opts: {
  quote: QuoteForCheckout
  intake: IntakeForCheckout
  shareToken: string
  appUrl: string  // base URL for success/cancel, e.g. https://quote-mate-rho.vercel.app
}): Promise<StripeLinks> {
  const stripe = getStripe()
  const depositPct = typeof opts.quote.deposit_pct === 'string'
    ? parseFloat(opts.quote.deposit_pct)
    : opts.quote.deposit_pct

  const tiers: Array<['good' | 'better' | 'best', Tier]> = [
    ['good', opts.quote.good],
    ['better', opts.quote.better],
    ['best', opts.quote.best],
  ]

  const links: StripeLinks = {}

  for (const [key, tier] of tiers) {
    if (!tier) continue
    const incCents = tierIncGstCents(tier)
    const deposit = depositCents(incCents, depositPct)
    if (deposit <= 0) continue

    const productName = buildProductName(opts.intake, key, tier)

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [
        {
          price_data: {
            currency: 'aud',
            product_data: {
              name: productName,
              description: `${depositPct}% deposit · balance due on completion`,
            },
            unit_amount: deposit,
          },
          quantity: 1,
        },
      ],
      customer_email: opts.intake.caller?.email || undefined,
      success_url: `${opts.appUrl}/q/${opts.shareToken}/paid?tier=${key}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${opts.appUrl}/q/${opts.shareToken}/cancelled`,
      metadata: {
        quote_id: opts.quote.id,
        tier: key,
        deposit_pct: String(depositPct),
        full_total_inc_gst_cents: String(incCents),
      },
      payment_intent_data: {
        metadata: {
          quote_id: opts.quote.id,
          tier: key,
        },
      },
      // 24h default Session expiry is fine for a quote workflow.
    })

    if (session.url) links[key] = session.url
  }

  return links
}

function buildProductName(intake: IntakeForCheckout, tierKey: string, tier: NonNullable<Tier>): string {
  const count = intake.scope?.item_count
  const job = intake.job_type.replace(/_/g, ' ')
  const lead = count ? `${count} ${job}` : job
  const tierLabel = tier.label || tierKey
  return `QuoteMate — ${lead} · ${tierLabel}`
}
