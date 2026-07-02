// GET /api/tenant/payouts — data for the dashboard Payouts tab.
//
// Returns the tenant's Connect account readiness plus their Connect-routed
// paid jobs: what was collected, QuoteMax's 2% fee, the net held for them,
// and each job's release state (awaiting completion / payout in flight /
// released). Legacy platform-direct payments (no stripe_connect_destination)
// are excluded — those funds never entered the tradie's held balance.

import { createClient } from '@supabase/supabase-js'
import { PAYOUT_CLAIM_SENTINEL } from '@/lib/stripe/connect'

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

export type PayoutJob = {
  quote_id: string
  job_type: string | null
  paid_tier: string | null
  paid_at: string
  paid_amount_cents: number | null
  platform_fee_cents: number | null
  net_cents: number
  completed_at: string | null
  release_state: 'released' | 'in_flight' | 'awaiting'
  payout: { id: string; amount_cents: number | null; created_at: string | null } | null
}

export function toPayoutJob(row: {
  id: string
  paid_tier: string | null
  paid_at: string
  paid_amount_cents: number | null
  platform_fee_cents: number | null
  completed_at: string | null
  stripe_payout_id: string | null
  payout_amount_cents: number | null
  payout_created_at: string | null
  intakes?: { job_type?: string | null } | null
}): PayoutJob {
  const released = !!row.stripe_payout_id && row.stripe_payout_id !== PAYOUT_CLAIM_SENTINEL
  return {
    quote_id: row.id,
    job_type: row.intakes?.job_type ?? null,
    paid_tier: row.paid_tier,
    paid_at: row.paid_at,
    paid_amount_cents: row.paid_amount_cents,
    platform_fee_cents: row.platform_fee_cents,
    net_cents: (row.paid_amount_cents ?? 0) - (row.platform_fee_cents ?? 0),
    completed_at: row.completed_at,
    release_state: released
      ? 'released'
      : row.stripe_payout_id === PAYOUT_CLAIM_SENTINEL
        ? 'in_flight'
        : 'awaiting',
    payout: released
      ? {
          id: row.stripe_payout_id as string,
          amount_cents: row.payout_amount_cents,
          created_at: row.payout_created_at,
        }
      : null,
  }
}

export async function GET(req: Request) {
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

  const { data: rows, error: qErr } = await supabase
    .from('quotes')
    .select(
      'id, paid_tier, paid_at, paid_amount_cents, platform_fee_cents, completed_at, stripe_payout_id, payout_amount_cents, payout_created_at, intakes ( job_type )',
    )
    .eq('tenant_id', tenant.id)
    .not('paid_at', 'is', null)
    .not('stripe_connect_destination', 'is', null)
    .order('paid_at', { ascending: false })
    .limit(50)
  if (qErr) {
    return Response.json({ ok: false, error: qErr.message }, { status: 500 })
  }

  return Response.json({
    ok: true,
    account: {
      has_account: !!tenant.stripe_connect_account_id,
      charges_enabled: !!tenant.stripe_connect_charges_enabled,
      payouts_enabled: !!tenant.stripe_connect_payouts_enabled,
      details_submitted: !!tenant.stripe_connect_details_submitted,
      onboarded_at: tenant.stripe_connect_onboarded_at ?? null,
    },
    jobs: (rows ?? []).map((r) => toPayoutJob(r as unknown as Parameters<typeof toPayoutJob>[0])),
  })
}
