// POST /api/stripe/connect/refresh — pull-based Connect onboarding sync.
//
// The dashboard's payout status is derived from the tenant row's
// stripe_connect_* flags, which are otherwise only written by the
// `account.updated` Connect webhook. That webhook is unreliable as the SOLE
// signal: it can't reach localhost in dev, may not be configured, and lags
// in prod — so a tradie who finished Stripe's hosted onboarding lands back on
// a tab still reading the stale `false` flags and is told, wrongly, that
// setup is incomplete (an endless loop).
//
// This endpoint closes that loop: it reads the LIVE readiness straight off
// the connected account and writes the flags itself, no webhook round-trip.
// The dashboard calls it on return from Stripe (and on demand), then re-pulls
// /api/tenant/me so the status line flips to "Payouts active" immediately.
//
// It mirrors the webhook's write exactly (same three flags + onboarded_at
// stamp) so the two paths converge on the same state, and self-heals a stored
// account id the current key can no longer access (key/sandbox rotation) so
// the tab resets to "not set up" instead of erroring.

import { createClient } from '@supabase/supabase-js'
import {
  getConnectAccountStatus,
  isStaleConnectAccountError,
  isConnectNotEnabledError,
} from '@/lib/stripe/provision'

export const dynamic = 'force-dynamic'
export const maxDuration = 15

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

const NO_ACCOUNT = {
  has_account: false,
  charges_enabled: false,
  payouts_enabled: false,
  details_submitted: false,
  onboarded_at: null as string | null,
}

export async function POST(req: Request) {
  const user = await userFromBearer(req)
  if (!user) {
    return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  const { data: tenant, error: tErr } = await supabase
    .from('tenants')
    .select(
      'id, stripe_connect_account_id, stripe_connect_charges_enabled, stripe_connect_payouts_enabled, stripe_connect_details_submitted, stripe_connect_onboarded_at',
    )
    .eq('owner_user_id', user.id)
    .maybeSingle()
  if (tErr) {
    return Response.json({ ok: false, error: tErr.message }, { status: 500 })
  }
  if (!tenant) {
    return Response.json({ ok: false, error: 'no_tenant' }, { status: 404 })
  }

  const accountId = tenant.stripe_connect_account_id as string | null
  if (!accountId) {
    // Nothing to reconcile — no connected account yet.
    return Response.json({ ok: true, synced: false, account: NO_ACCOUNT })
  }

  const status = await getConnectAccountStatus(accountId)

  if (!status.ok) {
    if (isConnectNotEnabledError(status.code, status.reason)) {
      return Response.json(
        {
          ok: false,
          error: 'connect_not_enabled',
          detail:
            'Stripe Connect is not enabled on the platform account behind STRIPE_SECRET_KEY. ' +
            'Enable it once at https://dashboard.stripe.com/connect, then retry.',
        },
        { status: 503 },
      )
    }
    if (isStaleConnectAccountError(status.code, status.reason)) {
      // The stored account is unusable under the current key. Clear it so the
      // tab resets to "not set up" and the tradie can re-onboard cleanly.
      // Compare-and-swap on the account id: if a concurrent connect/start
      // just provisioned a FRESH account and persisted its id, this heal
      // matches 0 rows and must NOT null the new id (which would orphan a
      // live Stripe account). In that case, re-read and report the current
      // truth instead of clobbering.
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
        const { data: fresh } = await supabase
          .from('tenants')
          .select(
            'stripe_connect_account_id, stripe_connect_charges_enabled, stripe_connect_payouts_enabled, stripe_connect_details_submitted, stripe_connect_onboarded_at',
          )
          .eq('id', tenant.id)
          .maybeSingle()
        return Response.json({
          ok: true,
          synced: true,
          account: {
            has_account: !!fresh?.stripe_connect_account_id,
            charges_enabled: !!fresh?.stripe_connect_charges_enabled,
            payouts_enabled: !!fresh?.stripe_connect_payouts_enabled,
            details_submitted: !!fresh?.stripe_connect_details_submitted,
            onboarded_at: (fresh?.stripe_connect_onboarded_at as string | null) ?? null,
          },
        })
      }
      return Response.json({ ok: true, synced: true, healed: true, account: NO_ACCOUNT })
    }
    return Response.json(
      { ok: false, error: 'sync_failed', detail: status.reason },
      { status: 502 },
    )
  }

  const patch: Record<string, unknown> = {
    stripe_connect_charges_enabled: status.chargesEnabled,
    stripe_connect_payouts_enabled: status.payoutsEnabled,
    stripe_connect_details_submitted: status.detailsSubmitted,
  }
  // Stamp the first time the account is fully live; never clear it after
  // (mirrors the connect-webhook so the two writers agree).
  let onboardedAt = tenant.stripe_connect_onboarded_at as string | null
  if (status.chargesEnabled && status.payoutsEnabled && !onboardedAt) {
    onboardedAt = new Date().toISOString()
    patch.stripe_connect_onboarded_at = onboardedAt
  }

  const { error: upErr } = await supabase
    .from('tenants')
    .update(patch)
    .eq('id', tenant.id)
  if (upErr) {
    return Response.json(
      { ok: false, error: 'sync_persist_failed', detail: upErr.message },
      { status: 500 },
    )
  }

  return Response.json({
    ok: true,
    synced: true,
    account: {
      has_account: true,
      charges_enabled: status.chargesEnabled,
      payouts_enabled: status.payoutsEnabled,
      details_submitted: status.detailsSubmitted,
      onboarded_at: onboardedAt,
    },
  })
}
