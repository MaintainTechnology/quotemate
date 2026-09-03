// Creates one Stripe Checkout Session per quote tier (good/better/best).
// Each Session charges the deposit (default 30% of inc-GST tier total).
// Returns a { good, better, best } map of Session URLs ready to embed in SMS.
//
// Charging is per-tenant: when the caller passes a `connect` destination
// (the tenant's fully-onboarded connected account — see
// lib/stripe/connect.ts) the Session is a DESTINATION charge with QuoteMax's
// 2% application fee and `on_behalf_of` the tradie. Without it, the legacy
// platform-direct charge is kept — money lands in QuoteMax's Stripe account.
//
// ── AU-only checkout (spec post-payment-scheduling-checkout, Task 2) ──
// QuoteMax serves Australian tradies + their customers only, so every Session
// below is priced in AUD (`currency: 'aud'`) and sets
// `adaptive_pricing: { enabled: false }` to turn OFF Stripe **Adaptive
// Pricing** — the feature that was showing customers a "Choose a currency:
// US$ / A$" selector. That param overrides the account-level Dashboard default
// per session, so the customer only ever sees AUD regardless of the Dashboard
// toggle.
//
// Link is hidden per-session via `wallet_options: { link: { display: 'never' } }`.
// Link is what renders the "Save my information for faster checkout" row and the
// US-format phone field. It is deliberately NOT in the
// `excluded_payment_method_types` union — `wallet_options` is the only switch.
// Doing it per-session rather than in the Dashboard matters under Connect: the
// charge can ride on the tradie's connected account, whose own Dashboard toggle
// would otherwise decide.
//
// `payment_method_types` is deliberately NOT set. It reads like "restrict to
// cards" but passing `['card']` is the documented way to *include* Link, and it
// switches off Stripe's dynamic payment methods — freezing the list so future AU
// methods (PayTo) never appear. The AU account country + `currency: 'aud'`
// already make us_bank_account / cashapp / affirm structurally ineligible.
// Locked by checkout.au.test.ts.
//
// The billing "Country or region" dropdown is a separate thing and CANNOT be
// limited to one country: Stripe exposes `allowed_countries` only on
// `shipping_address_collection` (SHIPPING, which we don't collect) — there is no
// billing-country allow-list. The field defaults to the customer's IP-detected
// location (Australia for real AU customers), and we leave
// `billing_address_collection` at its 'auto' default (minimal collection).

import { getStripe } from './client'
import { randomBytes } from 'node:crypto'
import { clampDiscountPct } from '@/lib/quote/early-bird'
import {
  INSPECTION_FEE_AUD_CENTS,
  MIN_STRIPE_CHARGE_CENTS,
  PLATFORM_FEE_PCT,
  depositCents,
  totalIncGstCents,
} from '@/lib/quote/money'
import {
  connectPaymentIntentExtras,
  connectSessionMetadata,
  type ConnectDestination,
} from './connect'

type Tier = { label: string; subtotal_ex_gst: number | string } | null

type QuoteForCheckout = {
  id: string
  good: Tier
  better: Tier
  best: Tier
  deposit_pct: number | string  // e.g. 30 = 30%
  /** pricing_book.gst_registered — P1: the charge must match the stored
   *  total. Omitted/null → true (every live tenant is registered today). */
  gst_registered?: boolean | null
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
  /** Set on inspection-required quotes — single $99 site-visit deposit Session URL. */
  inspection?: string
  /** Post-site-visit child charges, keyed by their own tier literal so a
   *  balance mint never expires the deposit's Session (the /r mint expires
   *  whatever it replaces under the same key). */
  deposit?: string
  balance?: string
}

/**
 * Generate a URL-safe share token (used in success URLs and future portal route).
 * 16 bytes → 22 chars after base64url, ~128 bits of entropy.
 */
export function generateShareToken(): string {
  return randomBytes(16).toString('base64url')
}

// Money maths (inc-GST cents, deposit cents, the $99 fee, discount order)
// lives in lib/quote/money.ts — the SAME functions the quote page, SMS and
// PDF display from, so the charge always matches the advertised number
// (spec customer-quote-five-sections R9: P1/P4/P5/P8).

export async function createCheckoutSessionsForQuote(opts: {
  quote: QuoteForCheckout
  intake: IntakeForCheckout
  shareToken: string
  appUrl: string  // base URL for success/cancel, e.g. https://quote-mate-rho.vercel.app
  /** Tenant's live connected account — routes the charge via Connect with
   *  the 2% platform fee. Omitted/null → platform-direct (legacy). */
  connect?: ConnectDestination | null
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
    const incCents = totalIncGstCents(tier.subtotal_ex_gst, {
      gstRegistered: opts.quote.gst_registered,
    })
    const deposit = depositCents(incCents, depositPct)
    if (deposit <= 0) continue

    const productName = buildProductName(opts.intake, key, tier)

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
        ...(opts.connect ? connectSessionMetadata(deposit, opts.connect) : {}),
      },
      payment_intent_data: {
        metadata: {
          quote_id: opts.quote.id,
          tier: key,
        },
        ...(opts.connect ? connectPaymentIntentExtras(deposit, opts.connect) : {}),
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
  return `QuoteMax — ${lead} · ${tierLabel}`
}

/**
 * Expire a Stripe Checkout Session so a stale customer link can't be
 * paid after the tradie edited the quote. Idempotent: a Session that's
 * already expired (or one we can't find) returns ok without throwing —
 * we don't want a stale URL in the DB to block a legitimate price edit.
 */
export async function expireCheckoutSession(sessionUrl: string): Promise<{ ok: boolean; reason?: string }> {
  // Stripe Session URLs look like:
  //   https://checkout.stripe.com/c/pay/cs_test_a1xxxxx...
  // Pull the `cs_*` SID out of the path. If the URL doesn't carry one
  // (legacy quotes that stored a different shape), skip silently —
  // there's nothing to expire on Stripe's side.
  const m = sessionUrl.match(/cs_[A-Za-z0-9_]+/)
  if (!m) return { ok: true, reason: 'no_session_id_in_url' }
  const sessionId = m[0]
  try {
    const stripe = getStripe()
    await stripe.checkout.sessions.expire(sessionId)
    return { ok: true }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    // Most failure modes are non-fatal for the edit flow: the Session
    // was already expired, already paid, or the SID was malformed.
    // We still want to issue the replacement Session so the customer's
    // next click goes to the new price.
    return { ok: false, reason: msg }
  }
}

/**
 * Create a Stripe Checkout Session for a single tier on an existing
 * quote — used by the tradie edit endpoint to issue a replacement
 * Session after a price change. Same shape as createCheckoutSessionsForQuote
 * but scoped to one tier.
 */
export async function createCheckoutSessionForTier(opts: {
  quote: QuoteForCheckout
  tierKey: 'good' | 'better' | 'best'
  intake: IntakeForCheckout
  shareToken: string
  appUrl: string
  /** v8 — whole-job early-booking discount %. When > 0 the tier total
   *  (and therefore the deposit) is reduced before the Session is
   *  created. Clamped to the 15% platform cap. Omitted / 0 → no
   *  discount, behaviour identical to before. */
  discountPct?: number | null
  /** Tenant's live connected account — routes the charge via Connect with
   *  the 2% platform fee. Omitted/null → platform-direct (legacy). */
  connect?: ConnectDestination | null
}): Promise<string | null> {
  const stripe = getStripe()
  const tier = opts.quote[opts.tierKey]
  if (!tier) return null
  const depositPct = typeof opts.quote.deposit_pct === 'string'
    ? parseFloat(opts.quote.deposit_pct)
    : opts.quote.deposit_pct
  const gstRegistered = opts.quote.gst_registered
  const fullIncCents = totalIncGstCents(tier.subtotal_ex_gst, { gstRegistered })
  const discountPct = clampDiscountPct(opts.discountPct)
  const incCents = totalIncGstCents(tier.subtotal_ex_gst, { gstRegistered, discountPct })
  const deposit = depositCents(incCents, depositPct)
  if (deposit <= 0) return null

  const productName = buildProductName(opts.intake, opts.tierKey, tier)
  const depositDesc = discountPct > 0
    ? `${depositPct}% deposit · ${discountPct}% early-booking discount applied · balance due on completion`
    : `${depositPct}% deposit · balance due on completion`
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
            name: productName,
            description: depositDesc,
          },
          unit_amount: deposit,
        },
        quantity: 1,
      },
    ],
    customer_email: opts.intake.caller?.email || undefined,
    success_url: `${opts.appUrl}/q/${opts.shareToken}/paid?tier=${opts.tierKey}&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${opts.appUrl}/q/${opts.shareToken}/cancelled`,
    metadata: {
      quote_id: opts.quote.id,
      tier: opts.tierKey,
      deposit_pct: String(depositPct),
      // Discounted inc-GST total — the figure the deposit % was taken
      // from. `full_total_inc_gst_cents` keeps reporting the pre-discount
      // total so the saving stays auditable from Stripe metadata alone.
      full_total_inc_gst_cents: String(fullIncCents),
      discounted_total_inc_gst_cents: String(incCents),
      early_bird_discount_pct: String(discountPct),
      ...(opts.connect ? connectSessionMetadata(deposit, opts.connect) : {}),
    },
    payment_intent_data: {
      metadata: {
        quote_id: opts.quote.id,
        tier: opts.tierKey,
      },
      ...(opts.connect ? connectPaymentIntentExtras(deposit, opts.connect) : {}),
    },
  })
  return session.url ?? null
}

// ── Post-site-visit child charges (spec post-visit-money-sequence R7) ──
//
// The deposit and the balance are charged on their OWN `quotes` rows, and
// neither can be expressed by createCheckoutSessionForTier: that builder
// computes `deposit = pct% of the tier total` with no $99 credit, no fee on
// top, and a hardcoded "balance due on completion" description.
//
// THE FEE IS CHARGED ON TOP HERE (Jon's model), unlike the $99 site visit
// where QuoteMax's 2% is deducted from the tradie's settlement. That makes
// the arithmetic load-bearing, so it is done ONCE by the caller and passed
// in as two explicit numbers:
//
//     charged = baseCents + surchargeCents        (what the customer pays)
//     application_fee_amount = surchargeCents     (what QuoteMax takes)
//     ⇒ the tradie's balance receives exactly baseCents.
//
// This is why `connectPaymentIntentExtras`/`connectSessionMetadata` are NOT
// used below: both recompute the fee as 2% of whatever amount they are
// handed, so passing them the charged total would take 2% of 1.02×base —
// 2.04% of base — and leave the tradie 0.04% short on every single job,
// with the Payouts "yours" figure quietly disagreeing with the quote. The
// fee is instead written from the SAME variable into the PaymentIntent and
// into `metadata.application_fee_cents`, which is what the webhook stamps
// into `platform_fee_cents` and what the payout release subtracts.

type ChildChargeOpts = {
  quoteId: string
  /** The CHILD row's share_token — it owns the success/cancel URLs. */
  shareToken: string
  /** Amount the tradie is owed for this step, before the platform fee. */
  baseCents: number
  /** The platform fee, added on top. MUST be surchargeCents(baseCents). */
  surchargeCents: number
  /** $99 already paid at the site visit — description + audit only (Stripe
   *  has no negative line item, so the credit is applied by the caller when
   *  it computes baseCents). */
  creditCents?: number
  /** Job description for the line item, e.g. "ev charger". */
  jobLabel: string
  customerEmail?: string | null
  appUrl: string
  connect?: ConnectDestination | null
  /** Audit trail so the whole split is reconstructible from Stripe alone. */
  audit: {
    quoteKind: 'final' | 'balance'
    parentQuoteId: string | null
    totalIncGstCents: number
    depositPct: number
  }
}

/** Shared Session shape for both child charges. `tier`/`purpose` differ. */
async function createChildChargeSession(
  opts: ChildChargeOpts & { tier: 'deposit' | 'balance'; productName: string; description: string },
): Promise<string | null> {
  const stripe = getStripe()
  const { baseCents, surchargeCents: fee } = opts
  if (!Number.isFinite(baseCents) || baseCents < MIN_STRIPE_CHARGE_CENTS) return null

  const metadata: Record<string, string> = {
    quote_id: opts.quoteId,
    tier: opts.tier,
    purpose: opts.tier,
    quote_kind: opts.audit.quoteKind,
    parent_quote_id: opts.audit.parentQuoteId ?? '',
    base_cents: String(baseCents),
    credit_cents: String(opts.creditCents ?? 0),
    surcharge_cents: String(fee),
    total_inc_gst_cents: String(opts.audit.totalIncGstCents),
    deposit_pct: String(opts.audit.depositPct),
    ...(opts.connect
      ? { connect_destination: opts.connect.accountId, application_fee_cents: String(fee) }
      : {}),
  }

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
          product_data: { name: opts.productName, description: opts.description },
          unit_amount: baseCents,
        },
        quantity: 1,
      },
      // The fee is its own line so the customer sees exactly what the 2% is
      // and what it is for — never folded into the job price.
      ...(fee > 0
        ? [
            {
              price_data: {
                currency: 'aud' as const,
                product_data: { name: `QuoteMax platform fee (${PLATFORM_FEE_PCT}%)` },
                unit_amount: fee,
              },
              quantity: 1,
            },
          ]
        : []),
    ],
    customer_email: opts.customerEmail || undefined,
    // Through /paid, not straight to /q: that page runs confirmPaidFromSession,
    // the webhook-race guard every other funnel relies on. It is kind-aware and
    // forwards a child to the final row's quote page (R11).
    success_url: `${opts.appUrl}/q/${opts.shareToken}/paid?tier=${opts.tier}&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${opts.appUrl}/q/${opts.shareToken}`,
    metadata,
    payment_intent_data: {
      metadata: { quote_id: opts.quoteId, tier: opts.tier },
      ...(opts.connect
        ? {
            on_behalf_of: opts.connect.accountId,
            transfer_data: { destination: opts.connect.accountId },
            // The fee ON TOP — the same `fee` variable as the line item and
            // the metadata, so the tradie nets exactly baseCents.
            application_fee_amount: fee,
          }
        : {}),
    },
  })
  return session.url ?? null
}

/**
 * The deposit on a 'final' row: `pct`% of the confirmed total, LESS the $99
 * site visit already paid, plus the 2% platform fee.
 */
export async function createFinalDepositCheckoutSession(
  opts: ChildChargeOpts,
): Promise<string | null> {
  const credit = opts.creditCents ?? 0
  const creditLine = credit > 0 ? ` (less $${Math.round(credit / 100)} site-visit credit)` : ''
  return createChildChargeSession({
    ...opts,
    tier: 'deposit',
    productName: `QuoteMax — ${opts.jobLabel} · deposit`,
    description: `${opts.audit.depositPct}% deposit${creditLine} · balance requested on completion`,
  })
}

/** The balance on a 'balance' row: the rest of the job, plus the 2% fee. */
export async function createBalanceCheckoutSession(
  opts: ChildChargeOpts,
): Promise<string | null> {
  return createChildChargeSession({
    ...opts,
    tier: 'balance',
    productName: `QuoteMax — ${opts.jobLabel} · final payment`,
    description: 'Balance due on completion of the job',
  })
}

/**
 * Roofing site-visit path: a single $99 refundable site-visit Checkout
 * Session for the DEDICATED roofing surface (/q/roof/[token]), which is
 * backed by roofing_measurements — NOT the quotes table — and previously had
 * no on-page payment at all. Keyed by metadata.roofing_token (not quote_id)
 * so the webhook records it on roofing_measurements.paid_at, mirroring the
 * painting_token branch. Success returns to the roofing quote page.
 */
export async function createRoofingSiteVisitSession(opts: {
  token: string
  address: string | null
  customerEmail?: string | null
  appUrl: string
  /** Tenant's live connected account — routes the charge via Connect with
   *  the 2% platform fee. Omitted/null → platform-direct (legacy). */
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
            name: `QuoteMax — roof site visit${opts.address ? ` · ${opts.address}` : ''}`,
            description: 'Refundable site-visit deposit. Credited toward your final roofing quote when you proceed.',
          },
          unit_amount: INSPECTION_FEE_AUD_CENTS,
        },
        quantity: 1,
      },
    ],
    customer_email: opts.customerEmail || undefined,
    // Land on the dedicated booking page: thank-you video + calendar picker,
    // instead of scrolling back on the quote surface.
    success_url: `${opts.appUrl}/q/roof/${opts.token}/book?paid=1&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${opts.appUrl}/q/roof/${opts.token}`,
    metadata: {
      roofing_token: opts.token,
      tier: 'inspection',
      fee_aud_cents: String(INSPECTION_FEE_AUD_CENTS),
      ...(opts.connect ? connectSessionMetadata(INSPECTION_FEE_AUD_CENTS, opts.connect) : {}),
    },
    payment_intent_data: {
      metadata: {
        roofing_token: opts.token,
        tier: 'inspection',
      },
      ...(opts.connect ? connectPaymentIntentExtras(INSPECTION_FEE_AUD_CENTS, opts.connect) : {}),
    },
  })
  return session.url ?? null
}

/**
 * Inspection-required path: create a single Stripe Checkout Session for
 * the $99 refundable site-visit deposit. Sets metadata.tier='inspection'
 * so the webhook can record it on the quote correctly.
 */
export async function createInspectionCheckoutSession(opts: {
  quoteId: string
  intake: IntakeForCheckout
  shareToken: string
  appUrl: string
  /** Tenant's live connected account — routes the charge via Connect with
   *  the 2% platform fee. Omitted/null → platform-direct (legacy). */
  connect?: ConnectDestination | null
}): Promise<string | null> {
  const stripe = getStripe()
  const job = opts.intake.job_type.replace(/_/g, ' ')

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
            name: `QuoteMax — site visit (${job})`,
            description: 'Refundable site-visit deposit. Credited toward your final quote when accepted.',
          },
          unit_amount: INSPECTION_FEE_AUD_CENTS,
        },
        quantity: 1,
      },
    ],
    customer_email: opts.intake.caller?.email || undefined,
    success_url: `${opts.appUrl}/q/${opts.shareToken}/paid?tier=inspection&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${opts.appUrl}/q/${opts.shareToken}/cancelled`,
    metadata: {
      quote_id: opts.quoteId,
      tier: 'inspection',
      fee_aud_cents: String(INSPECTION_FEE_AUD_CENTS),
      ...(opts.connect ? connectSessionMetadata(INSPECTION_FEE_AUD_CENTS, opts.connect) : {}),
    },
    payment_intent_data: {
      metadata: {
        quote_id: opts.quoteId,
        tier: 'inspection',
      },
      ...(opts.connect ? connectPaymentIntentExtras(INSPECTION_FEE_AUD_CENTS, opts.connect) : {}),
    },
  })

  return session.url ?? null
}
