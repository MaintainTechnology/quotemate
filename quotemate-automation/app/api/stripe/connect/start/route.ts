// POST /api/stripe/connect/start
//
// Starts (or resumes) Stripe Connect onboarding for the authed tradie.
//   1. Auth via Bearer supabase token → resolve tenant.
//   2. If the tenant has no stripe_connect_account_id, create a connected
//      account and persist the acct_… id.
//   3. Mint a fresh single-use hosted onboarding link.
//   4. Return { url } — the dashboard redirects the tradie there.
//
// Safe to call repeatedly: an existing account is reused; only the
// onboarding link is regenerated each call (links are single-use).
//
// When STRIPE_PROVISIONING_ENABLED !== 'true' the account create is
// stubbed and there is no real link — the route returns
// { ok:false, error:'provisioning_disabled' } so the dashboard can show
// a "coming soon" state instead of a broken redirect.

import { createClient } from '@supabase/supabase-js'
import {
  provisionStripeConnectAccount,
  createConnectOnboardingLink,
  getConnectAccountStatus,
  isStaleConnectAccountError,
  isConnectNotEnabledError,
} from '@/lib/stripe/provision'

export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

async function userFromBearer(req: Request) {
  const auth = req.headers.get('authorization') ?? ''
  if (!auth.toLowerCase().startsWith('bearer ')) return null
  const token = auth.slice(7).trim()
  if (!token) return null
  const { data, error } = await supabase.auth.getUser(token)
  if (error || !data.user) return null
  return data.user
}

export async function POST(req: Request) {
  const user = await userFromBearer(req)
  if (!user) {
    return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  const { data: tenant, error: tErr } = await supabase
    .from('tenants')
    .select('id, owner_email, business_name, stripe_connect_account_id')
    .eq('owner_user_id', user.id)
    .maybeSingle()

  if (tErr) {
    return Response.json({ ok: false, error: tErr.message }, { status: 500 })
  }
  if (!tenant) {
    return Response.json({ ok: false, error: 'no_tenant' }, { status: 404 })
  }

  const appUrl =
    process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? null
  if (!appUrl) {
    return Response.json(
      { ok: false, error: 'APP_URL not set — cannot build onboarding return URLs' },
      { status: 500 },
    )
  }

  // ─── 1. Ensure a connected account exists ───────────────────────
  let accountId = tenant.stripe_connect_account_id as string | null

  // Validate a stored acct_… id before reusing it. A stale id — created
  // under a different Stripe account/sandbox (key rotation) or since
  // deleted — makes accountLinks.create fail with "The requested account
  // link is for an account that is not connected to your platform or does
  // not exist". Self-heal: discard the stale id (+ its readiness flags) and
  // fall through to provisioning a fresh account.
  if (accountId && process.env.STRIPE_PROVISIONING_ENABLED === 'true') {
    const status = await getConnectAccountStatus(accountId)
    if (!status.ok) {
      if (isConnectNotEnabledError(status.code, status.reason)) {
        return Response.json(
          {
            ok: false,
            error: 'connect_not_enabled',
            detail:
              'Stripe Connect is not enabled on the platform account behind STRIPE_SECRET_KEY. ' +
              'Enable it once at https://dashboard.stripe.com/connect ' +
              '(docs/markdown/stripe-connect-setup.md, Stages 1–2), then retry.',
          },
          { status: 503 },
        )
      }
      if (isStaleConnectAccountError(status.code, status.reason)) {
        // Compare-and-swap on the account id so a concurrent request (the
        // payouts-tab auto-sync in /api/stripe/connect/refresh, or a second
        // click) that already replaced this stale id can't be clobbered back
        // to null — that would orphan a live Stripe account.
        const { data: healed, error: healErr } = await supabase
          .from('tenants')
          .update({
            stripe_connect_account_id: null,
            stripe_connect_charges_enabled: false,
            stripe_connect_payouts_enabled: false,
            stripe_connect_details_submitted: false,
          })
          .eq('id', tenant.id)
          .eq('stripe_connect_account_id', accountId)
          .select('id')
        if (healErr) {
          return Response.json(
            { ok: false, error: 'stale_account_heal_failed', detail: healErr.message },
            { status: 500 },
          )
        }
        if (!healed || healed.length === 0) {
          // A concurrent request changed the id underneath us. Reuse whatever
          // is now stored (a freshly-provisioned account) rather than
          // provisioning a duplicate; null falls through to provisioning.
          const { data: fresh } = await supabase
            .from('tenants')
            .select('stripe_connect_account_id')
            .eq('id', tenant.id)
            .maybeSingle()
          accountId = (fresh?.stripe_connect_account_id as string | null) ?? null
        } else {
          accountId = null
        }
      } else {
        // Transient/unclassified Stripe failure — don't create a duplicate
        // account on top of one that may still exist; surface and retry.
        return Response.json(
          { ok: false, error: 'account_validate_failed', detail: status.reason },
          { status: 502 },
        )
      }
    }
  }

  if (!accountId) {
    const created = await provisionStripeConnectAccount({
      tenantId: tenant.id,
      ownerEmail: tenant.owner_email,
      businessName: tenant.business_name,
    })
    if (!created.ok) {
      if (isConnectNotEnabledError(created.code, created.reason)) {
        return Response.json(
          {
            ok: false,
            error: 'connect_not_enabled',
            detail:
              'Stripe Connect is not enabled on the platform account behind STRIPE_SECRET_KEY. ' +
              'Enable it once at https://dashboard.stripe.com/connect ' +
              '(docs/markdown/stripe-connect-setup.md, Stages 1–2), then retry.',
          },
          { status: 503 },
        )
      }
      return Response.json(
        { ok: false, error: 'account_create_failed', detail: created.reason },
        { status: 502 },
      )
    }
    if (created.stubbed) {
      return Response.json(
        { ok: false, error: 'provisioning_disabled' },
        { status: 503 },
      )
    }
    accountId = created.accountId
    const { error: upErr } = await supabase
      .from('tenants')
      .update({ stripe_connect_account_id: accountId })
      .eq('id', tenant.id)
    if (upErr) {
      // The account exists on Stripe but we failed to persist its id.
      // Surface loudly — a retry would orphan-create a second account.
      return Response.json(
        { ok: false, error: 'account_persist_failed', detail: upErr.message, accountId },
        { status: 500 },
      )
    }
  }

  // ─── 2. Mint a fresh hosted onboarding link ─────────────────────
  const link = await createConnectOnboardingLink({ accountId, appUrl })
  if (!link.ok) {
    return Response.json(
      { ok: false, error: 'link_create_failed', detail: link.reason },
      { status: 502 },
    )
  }

  return Response.json({ ok: true, url: link.url, accountId })
}
