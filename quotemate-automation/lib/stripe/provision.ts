// Stripe Connect (Express-equivalent) provisioning for tradie onboarding.
//
// Accounts are created via the Accounts v2 API (POST /v2/core/accounts /
// `stripe.v2.core.accounts.create`). Stripe deprecated v1 Connect account
// creation for new platforms, so there is no `type: 'express'` here — the
// Express experience is assembled from explicit v2 configuration:
// `dashboard: 'express'` + `defaults.responsibilities` (platform collects
// fees + owns losses) + merchant/recipient capability requests. The MANUAL
// payout schedule (which has no field in v2 create) is set with a v1 interop
// update straight after create. v2 `acct_…` ids stay fully interoperable with
// the v1 charge/payout/balance/retrieve APIs the rest of the app uses.
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
  | { ok: false; reason: string; code?: string | null }

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

    // ── Accounts v2 create (POST /v2/core/accounts) ──────────────────
    // The v2 shape replaces the old `type: 'express'` / `controller`
    // presets with explicit configuration. This combination IS the
    // Express-equivalent:
    //   dashboard: 'express'                       → Stripe-hosted tradie dashboard
    //   responsibilities.fees_collector: 'application'   → QuoteMax billed Stripe fees
    //   responsibilities.losses_collector: 'application' → QuoteMax owns dispute liability
    //   (requirement collection is auto-derived as Stripe-managed for an
    //    application + express account — v2 has no explicit field for it.)
    //
    // ⚠️ Do NOT set losses_collector to 'stripe', or fees_collector to
    // anything but 'application', with an Express dashboard — Stripe forbids
    // it (Express REQUIRES platform-borne fees + losses). QuoteMax recoups
    // Stripe's processing fee inside application_fee_amount on the charge
    // (see lib/stripe/checkout.ts), not via fees_collector.
    //
    // Capabilities requested (both needed for the destination-charge model):
    //   merchant.card_payments        → enables `on_behalf_of` on the charge
    //   recipient.stripe_transfers    → enables `transfer_data.destination`,
    //                                    and Stripe DERIVES the payouts
    //                                    capability from it (payouts is not
    //                                    directly requestable in v2).
    const account = await stripe.v2.core.accounts.create({
      contact_email: opts.ownerEmail,
      display_name: opts.businessName,
      dashboard: 'express',
      identity: {
        // ISO 3166-1 alpha-2. 'AU' matches the returned Account + the prior
        // v1 code; if a create ever 400s on country, Stripe also accepts 'au'.
        country: 'AU',
        entity_type: 'individual',
      },
      configuration: {
        merchant: {
          capabilities: {
            card_payments: { requested: true },
          },
        },
        recipient: {
          capabilities: {
            stripe_balance: {
              stripe_transfers: { requested: true },
            },
          },
        },
      },
      defaults: {
        responsibilities: {
          fees_collector: 'application',
          losses_collector: 'application',
        },
      },
      // Lets the Connect webhook / refresh sync resolve the tenant from the
      // Account object even before stripe_connect_account_id is persisted.
      metadata: { tenant_id: opts.tenantId },
    })

    // ── Manual payout schedule (v1 interop) ──────────────────────────
    // v2 Accounts has NO payout-schedule field, so set the MANUAL schedule
    // with a v1 update on the same acct_… id (v2 accounts are interoperable
    // with the v1 API). Manual is load-bearing: QuoteMax releases each job's
    // funds to the tradie's bank on completion (the disbursement gate) — an
    // account left on Stripe's default AUTOMATIC schedule would silently
    // break that. We read the schedule back from the update response and FAIL
    // CLOSED if it isn't 'manual', so we never persist an auto-payout account.
    // Fail-closed can orphan the just-created account (its id is never
    // persisted, so a retry provisions a fresh one) — an acceptable trade
    // vs. leaking funds through an auto-payout account. The caller surfaces
    // `reason` so the operator can see why.
    const updated = await stripe.accounts.update(account.id, {
      settings: { payouts: { schedule: { interval: 'manual' } } },
    })
    const interval = updated.settings?.payouts?.schedule?.interval
    if (interval !== 'manual') {
      return {
        ok: false,
        code: 'manual_payout_not_set',
        reason:
          `Connected account ${account.id} was created but its payout schedule ` +
          `could not be set to manual (got '${interval ?? 'unknown'}'). Refusing ` +
          `to persist an auto-payout account — QuoteMax must control disbursement.`,
      }
    }

    return { ok: true, stubbed: false, accountId: account.id }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    return { ok: false, reason: msg, code: (e as { code?: string })?.code ?? null }
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
  returnClient?: 'web' | 'mobile'
}): Promise<{ ok: true; url: string } | { ok: false; reason: string; code?: string | null }> {
  if (process.env.STRIPE_PROVISIONING_ENABLED !== 'true') {
    return {
      ok: false,
      reason: 'STRIPE_PROVISIONING_ENABLED is not true — no live Connect account to onboard',
    }
  }
  try {
    const stripe = getStripe()
    const mobileReturn = opts.returnClient === 'mobile'
    const link = await stripe.v2.core.accountLinks.create({
      account: opts.accountId,
      use_case: {
        type: 'account_onboarding',
        account_onboarding: {
          // Collect requirements for BOTH configurations we requested at
          // create. Driving this Stripe-hosted flow IS how "Stripe collects
          // requirements" is expressed in v2 (there is no
          // controller.requirement_collection field): merchant unlocks
          // card_payments, recipient unlocks transfers/payouts.
          configurations: ['merchant', 'recipient'],
          refresh_url: mobileReturn
            ? `${opts.appUrl}/app/sections/payouts?stripe=refresh`
            : `${opts.appUrl}/onboard/stripe/refresh`,
          return_url: mobileReturn
            ? `${opts.appUrl}/app/sections/payouts?stripe=return`
            : `${opts.appUrl}/onboard/stripe/return`,
        },
      },
    })
    return { ok: true, url: link.url }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    return { ok: false, reason: msg, code: (e as { code?: string })?.code ?? null }
  }
}

/**
 * Read the live readiness flags off a connected account. Used by the
 * connect/start route to surface current status, and as a fallback when
 * the webhook hasn't landed yet.
 *
 * Deliberately uses the v1 `accounts.retrieve` even for v2-created accounts:
 * a v2 `acct_…` id is interoperable with the v1 endpoint, which returns the
 * real `charges_enabled` / `payouts_enabled` / `details_submitted` booleans.
 * The v2 retrieve has no `details_submitted` and only exposes per-capability
 * statuses, so v1 interop is both simpler and more accurate here (same reason
 * the payouts route keeps its v1 retrieve for `external_accounts`).
 */
export async function getConnectAccountStatus(accountId: string): Promise<{
  ok: boolean
  chargesEnabled: boolean
  payoutsEnabled: boolean
  detailsSubmitted: boolean
  reason?: string
  /** Stripe error code (e.g. 'resource_missing') for failure classification. */
  code?: string | null
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
    const code = (e as { code?: string })?.code ?? null
    return { ok: false, chargesEnabled: false, payoutsEnabled: false, detailsSubmitted: false, reason: msg, code }
  }
}

/**
 * A stored acct_… id that this platform can no longer operate on — it was
 * created under a DIFFERENT Stripe account/sandbox (key rotation) or deleted.
 * Reusing it is what produces "The requested account link is for an account
 * that is not connected to your platform or does not exist" — the fix is to
 * discard the id and provision a fresh account.
 */
export function isStaleConnectAccountError(code: string | null | undefined, message: string | null | undefined): boolean {
  if (code === 'resource_missing' || code === 'account_invalid') return true
  const m = message ?? ''
  return /not connected to your platform|does not exist|does not have access to account/i.test(m)
}

/**
 * The PLATFORM itself can't use Connect yet — "sign up for Connect" is a
 * one-time Stripe Dashboard action (https://dashboard.stripe.com/connect;
 * docs/markdown/stripe-connect-setup.md Stage 1). No account create/retrieve
 * works until it's done, so surface it as an actionable operator error
 * instead of retry-looping.
 */
export function isConnectNotEnabledError(code: string | null | undefined, message: string | null | undefined): boolean {
  if (code === 'platform_account_required') return true
  return /signed up for Connect|sign up for Connect/i.test(message ?? '')
}
