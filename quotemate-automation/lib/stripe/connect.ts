// Stripe Connect money movement for QuoteMax — the charge-side fee routing
// and the completion-side payout release.
//
// The account side (creation, hosted onboarding, readiness flags) lives in
// lib/stripe/provision.ts + /api/stripe/connect-webhook. This module is the
// funds flow those accounts were built for:
//
//   1. CHARGE — when the quote's tenant has a fully-onboarded connected
//      account, every Checkout Session becomes a DESTINATION charge:
//      `transfer_data.destination` settles the funds to the tradie's Stripe
//      balance minus QuoteMax's 2% `application_fee_amount`, and
//      `on_behalf_of` makes the tradie the merchant of record (AU GST —
//      their descriptor on the customer's statement). Tenants who haven't
//      finished Connect onboarding keep the legacy platform-direct charge.
//   2. HOLD — the connected account is on a MANUAL payout schedule
//      (provision.ts), so the net amount sits in the tradie's Stripe
//      balance untouched.
//   3. RELEASE — the tradie marks the job complete on the dashboard
//      (/api/quote/[id]/complete), which creates a Payout on the connected
//      account for the job's net (paid − fee) → their bank.

import { getStripe } from './client'

export const PLATFORM_FEE_PCT = 2

/** QuoteMax's cut of a charge, in cents: 2% of the amount, rounded. */
export function platformFeeCents(amountCents: number): number {
  return Math.round(amountCents * (PLATFORM_FEE_PCT / 100))
}

export type ConnectDestination = { accountId: string }

export type TenantConnectState = {
  stripe_connect_account_id: string | null
  stripe_connect_charges_enabled: boolean | null
  stripe_connect_payouts_enabled: boolean | null
}

/**
 * Decide whether a tenant's charges should route via Connect. Requires the
 * account to be FULLY live (charges + payouts enabled): a half-onboarded
 * destination would fail the charge at Checkout time, so those tenants keep
 * platform-direct charging until the connect-webhook flips both flags.
 */
export function connectDestinationForTenant(
  t: TenantConnectState | null | undefined,
): ConnectDestination | null {
  if (!t?.stripe_connect_account_id) return null
  if (!t.stripe_connect_charges_enabled || !t.stripe_connect_payouts_enabled) return null
  return { accountId: t.stripe_connect_account_id }
}

/**
 * Fetch-and-decide convenience for the checkout call sites, which hold a
 * tenant id but not the row. Never throws — a lookup failure just means the
 * charge stays platform-direct (the safe legacy behaviour).
 */
export async function connectDestinationForTenantId(
  supabase: { from(table: string): any },
  tenantId: string | null | undefined,
): Promise<ConnectDestination | null> {
  if (!tenantId) return null
  try {
    const { data } = await supabase
      .from('tenants')
      .select('stripe_connect_account_id, stripe_connect_charges_enabled, stripe_connect_payouts_enabled')
      .eq('id', tenantId)
      .maybeSingle()
    return connectDestinationForTenant(data as TenantConnectState | null)
  } catch {
    return null
  }
}

/**
 * The payment_intent_data extras that turn a platform charge into a
 * destination charge with QuoteMax's fee.
 */
export function connectPaymentIntentExtras(amountCents: number, dest: ConnectDestination) {
  return {
    on_behalf_of: dest.accountId,
    transfer_data: { destination: dest.accountId },
    application_fee_amount: platformFeeCents(amountCents),
  }
}

/**
 * Session-metadata extras mirroring the fee routing, so the payment webhook
 * can stamp the quote's fee/destination without a second Stripe fetch.
 */
export function connectSessionMetadata(amountCents: number, dest: ConnectDestination) {
  return {
    connect_destination: dest.accountId,
    application_fee_cents: String(platformFeeCents(amountCents)),
  }
}

// ─── Release on job completion ──────────────────────────────────────

/** Sentinel stored in quotes.stripe_payout_id while a release is in flight —
 *  the conditional claim on it makes double-clicks/races single-payout safe
 *  (same pattern as the payment webhook's paid_at claim). */
export const PAYOUT_CLAIM_SENTINEL = 'pending'

export type PayoutQuoteState = {
  paid_at: string | null
  paid_amount_cents: number | null
  platform_fee_cents: number | null
  stripe_connect_destination: string | null
  stripe_payout_id: string | null
}

export type PayoutDecision =
  | { ok: true; amountCents: number; accountId: string }
  | {
      ok: false
      reason:
        | 'not_paid'
        | 'not_connect_routed'
        | 'account_mismatch'
        | 'payouts_not_ready'
        | 'already_released'
        | 'release_in_progress'
        | 'nothing_to_release'
    }

/**
 * Pure release-eligibility check for a quote + its tenant.
 *
 * 'not_connect_routed' covers legacy platform-direct payments: their funds
 * never reached the tradie's Stripe balance, so a payout there would move
 * unrelated money. 'account_mismatch' covers a tenant who re-onboarded onto
 * a new connected account after this job was paid — the funds sit in the OLD
 * account, which we no longer track well enough to auto-release.
 */
export function payoutReleaseDecision(
  quote: PayoutQuoteState,
  tenant: TenantConnectState,
): PayoutDecision {
  if (!quote.paid_at) return { ok: false, reason: 'not_paid' }
  if (!quote.stripe_connect_destination) return { ok: false, reason: 'not_connect_routed' }
  if (quote.stripe_payout_id === PAYOUT_CLAIM_SENTINEL) {
    return { ok: false, reason: 'release_in_progress' }
  }
  if (quote.stripe_payout_id) return { ok: false, reason: 'already_released' }
  if (quote.stripe_connect_destination !== tenant.stripe_connect_account_id) {
    return { ok: false, reason: 'account_mismatch' }
  }
  if (!tenant.stripe_connect_payouts_enabled) return { ok: false, reason: 'payouts_not_ready' }
  const net = (quote.paid_amount_cents ?? 0) - (quote.platform_fee_cents ?? 0)
  if (net <= 0) return { ok: false, reason: 'nothing_to_release' }
  return { ok: true, amountCents: net, accountId: quote.stripe_connect_destination }
}

/**
 * Create the bank payout on the connected account. The caller must hold the
 * PAYOUT_CLAIM_SENTINEL claim on the quote before calling, and release it if
 * this returns ok:false (payouts.create fails synchronously — e.g.
 * `balance_insufficient` while the charge is still settling — so the claim
 * can always be handed back for a later retry).
 */
export async function createConnectPayout(opts: {
  accountId: string
  amountCents: number
  quoteId: string
}): Promise<{ ok: true; payoutId: string } | { ok: false; code: string | null; reason: string }> {
  try {
    const stripe = getStripe()
    const payout = await stripe.payouts.create(
      {
        amount: opts.amountCents,
        currency: 'aud',
        description: 'QuoteMax job payout',
        metadata: { quote_id: opts.quoteId },
      },
      { stripeAccount: opts.accountId },
    )
    return { ok: true, payoutId: payout.id }
  } catch (e: unknown) {
    const err = e as { code?: string; message?: string }
    return {
      ok: false,
      code: err.code ?? null,
      reason: err.message ?? String(e),
    }
  }
}
