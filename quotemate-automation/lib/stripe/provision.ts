// Stripe Connect (Express) provisioning for tradie onboarding.
//
// Two operations, mirroring the Twilio/Vapi provisioning pattern:
//   1. provisionStripeConnectAccount() — create a connected account
//      (`acct_…`) for a tenant. Express-equivalent: Stripe hosts the
//      onboarding form and runs KYC. The platform (QuoteMax) carries
//      fee + dispute liability; the connected account is on a MANUAL
//      payout schedule so QuoteMax controls when funds reach the
//      tradie's bank (released on job completion).
//   2. createConnectOnboardingLink() — a single-use, short-lived hosted
//      onboarding URL the tradie is redirected to.
//
// Gated by env flag `STRIPE_PROVISIONING_ENABLED=true`. When disabled
// (the default — keeps the test phase free of Connect onboarding noise)
// provisionStripeConnectAccount() returns a stub result so the rest of
// the flow can run; createConnectOnboardingLink() refuses (there is no
// real account to onboard).
//
// Charge type this account is built for: DESTINATION CHARGES with
// `on_behalf_of` the connected account (tradie = merchant of record for
// AU GST) + an `application_fee_amount` (QuoteMax's 2%). See
// lib/stripe/checkout.ts for the charge side.

import { getStripe } from './client'

export type StripeProvisionResult =
  | { ok: true; stubbed: false; accountId: string }
  | { ok: true; stubbed: true; accountId: null }
  | { ok: false; reason: string }

/**
 * Create a Stripe Connect connected account for a tenant.
 *
 * Idempotent at the caller level: pass `existingAccountId` to short-circuit
 * (the connect/start route checks tenants.stripe_connect_account_id first).
 */
export async function provisionStripeConnectAccount(opts: {
  tenantId: string
  ownerEmail: string
  businessName: string
}): Promise<StripeProvisionResult> {
  if (process.env.STRIPE_PROVISIONING_ENABLED !== 'true') {
    return { ok: true, stubbed: true, accountId: null }
  }

  try {
    const stripe = getStripe()
    const account = await stripe.accounts.create({
      country: 'AU',
      email: opts.ownerEmail,
      // Controller properties — the modern replacement for the legacy
      // `type: 'express'` preset. This combination IS "Express":
      //   stripe_dashboard.type='express' → Stripe-hosted tradie dashboard
      //   fees.payer='application'        → QuoteMax's account is billed Stripe fees
      //   losses.payments='application'   → QuoteMax carries dispute liability
      //   requirement_collection='stripe' → Stripe runs KYC onboarding
      //
      // ⚠️ Do NOT change losses.payments to 'stripe' or fees.payer to
      // 'account'. Stripe explicitly forbids both with an Express
      // dashboard — Express REQUIRES platform-borne liability + fees.
      // This is the only valid Express controller combination. QuoteMax
      // recoups Stripe's processing fee inside application_fee_amount on
      // the charge (see lib/stripe/checkout.ts), not via fees.payer.
      controller: {
        stripe_dashboard: { type: 'express' },
        fees: { payer: 'application' },
        losses: { payments: 'application' },
        requirement_collection: 'stripe',
      },
      capabilities: {
        card_payments: { requested: true },
        transfers: { requested: true },
      },
      business_type: 'individual',
      // Manual payout schedule — QuoteMax releases funds to the tradie's
      // bank on job completion (the disbursement gate), not automatically.
      settings: {
        payouts: { schedule: { interval: 'manual' } },
      },
      business_profile: {
        name: opts.businessName,
      },
      // Lets the Connect webhook resolve the tenant from the Account object
      // even before stripe_connect_account_id is persisted.
      metadata: { tenant_id: opts.tenantId },
    })
    return { ok: true, stubbed: false, accountId: account.id }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    return { ok: false, reason: msg }
  }
}

/**
 * Create a single-use Stripe-hosted onboarding link for an existing
 * connected account. The tradie is redirected to `url`.
 *
 * Account links expire quickly and are single-use — `refresh_url` is hit
 * by Stripe if the link expires before the tradie finishes, and that
 * route just calls this again.
 */
export async function createConnectOnboardingLink(opts: {
  accountId: string
  appUrl: string
}): Promise<{ ok: true; url: string } | { ok: false; reason: string }> {
  if (process.env.STRIPE_PROVISIONING_ENABLED !== 'true') {
    return {
      ok: false,
      reason: 'STRIPE_PROVISIONING_ENABLED is not true — no live Connect account to onboard',
    }
  }
  try {
    const stripe = getStripe()
    const link = await stripe.accountLinks.create({
      account: opts.accountId,
      refresh_url: `${opts.appUrl}/onboard/stripe/refresh`,
      return_url: `${opts.appUrl}/onboard/stripe/return`,
      type: 'account_onboarding',
    })
    return { ok: true, url: link.url }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    return { ok: false, reason: msg }
  }
}

/**
 * Read the live readiness flags off a connected account. Used by the
 * connect/start route to surface current status, and as a fallback when
 * the webhook hasn't landed yet.
 */
export async function getConnectAccountStatus(accountId: string): Promise<{
  ok: boolean
  chargesEnabled: boolean
  payoutsEnabled: boolean
  detailsSubmitted: boolean
  reason?: string
}> {
  try {
    const stripe = getStripe()
    const a = await stripe.accounts.retrieve(accountId)
    return {
      ok: true,
      chargesEnabled: !!a.charges_enabled,
      payoutsEnabled: !!a.payouts_enabled,
      detailsSubmitted: !!a.details_submitted,
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    return { ok: false, chargesEnabled: false, payoutsEnabled: false, detailsSubmitted: false, reason: msg }
  }
}
