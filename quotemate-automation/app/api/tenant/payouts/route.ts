// GET /api/tenant/payouts — data for the dashboard Payouts tab.
//
// Returns the tenant's Connect account readiness plus their Connect-routed
// paid jobs: what was collected, QuoteMax's 2% fee, the net held for them,
// and each job's release state (awaiting completion / payout in flight /
// released). Legacy platform-direct payments (no stripe_connect_destination)
// are excluded — those funds never entered the tradie's held balance.

import { createClient } from '@supabase/supabase-js'
import { PAYOUT_CLAIM_SENTINEL } from '@/lib/stripe/connect'
import { getStripe } from '@/lib/stripe/client'

export const dynamic = 'force-dynamic'
// The route now makes best-effort Stripe reads (bank, balance, payout
// statuses) on top of the DB query — give it headroom over the Hobby 10s.
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
  payout: {
    id: string
    amount_cents: number | null
    created_at: string | null
    /** Live Stripe payout status (paid | in_transit | pending | canceled |
     *  failed), merged in when the Stripe fetch succeeds. Null when Stripe
     *  is unreachable — the UI falls back to the release date. */
    status?: string | null
    /** Unix seconds — when the bank expects the funds. Null pre-transit or
     *  when Stripe is unreachable. */
    arrival_date?: number | null
  } | null
}

/** Bank account the tradie's payouts land in (Stripe external account). */
export type PayoutBank = {
  bank_name: string | null
  last4: string | null
  currency: string | null
}

/** The connected account's Stripe balance, summed for AUD (in cents). */
export type PayoutBalance = {
  available_cents: number
  pending_cents: number
  currency: string
}

/** Live Stripe-sourced account details, best-effort. Null fields when the
 *  Stripe fetch fails so the tab still renders from the DB alone. */
export type PayoutAccountDetails = {
  bank: PayoutBank | null
  /** Stripe payout schedule interval — 'manual' for QuoteMax (released on
   *  job completion), else Stripe's automatic cadence. */
  payout_schedule: string | null
  balance: PayoutBalance | null
  /** Count of Stripe requirements still `currently_due` — a non-zero value
   *  means verification could pause payouts if left unaddressed. */
  requirements_due: number
}

const EMPTY_DETAILS: PayoutAccountDetails = {
  bank: null,
  payout_schedule: null,
  balance: null,
  requirements_due: 0,
}

// Cap the best-effort Stripe reads so a slow/hanging Stripe (a socket that
// never settles, not a fast error) can't hold the response past the function
// budget — a timed-out enrichment resolves to the DB-only fallback instead of
// 504-ing the whole Payouts tab. 4s leaves headroom under maxDuration.
const STRIPE_ENRICH_TIMEOUT_MS = 4000

function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ])
}

/**
 * Read live account details off the connected account: the destination bank,
 * payout schedule, held Stripe balance, and any outstanding verification
 * requirements. Best-effort — any Stripe hiccup returns null so the Payouts
 * tab still renders from the DB. Never throws.
 */
export async function fetchAccountDetails(accountId: string): Promise<PayoutAccountDetails | null> {
  try {
    const stripe = getStripe()
    const [account, balance] = await Promise.all([
      stripe.accounts.retrieve(accountId),
      stripe.balance.retrieve({}, { stripeAccount: accountId }).catch(() => null),
    ])

    const banks = (account.external_accounts?.data ?? []).filter(
      (e) => e.object === 'bank_account',
    ) as Array<{
      bank_name?: string | null
      last4?: string | null
      currency?: string | null
      default_for_currency?: boolean | null
    }>
    // Prefer the default-for-currency bank — that's where funds actually land
    // (createConnectPayout issues an AUD payout with no explicit destination,
    // so Stripe routes to default_for_currency). Fall back to the first bank.
    const ext = banks.find((b) => b.default_for_currency) ?? banks[0]
    const bank: PayoutBank | null = ext
      ? {
          bank_name: ext.bank_name ?? null,
          last4: ext.last4 ?? null,
          currency: ext.currency ?? null,
        }
      : null

    const sumAud = (rows: Array<{ amount: number; currency: string }> | undefined): number =>
      (rows ?? [])
        .filter((r) => r.currency === 'aud')
        .reduce((sum, r) => sum + r.amount, 0)
    const bal: PayoutBalance | null = balance
      ? {
          available_cents: sumAud(balance.available),
          pending_cents: sumAud(balance.pending),
          currency: 'aud',
        }
      : null

    return {
      bank,
      payout_schedule: account.settings?.payouts?.schedule?.interval ?? null,
      balance: bal,
      requirements_due: account.requirements?.currently_due?.length ?? 0,
    }
  } catch {
    return null
  }
}

/**
 * Map of `po_…` → live status + arrival date, pulled from the connected
 * account's recent payouts. Used to enrich released jobs with a transit
 * state ("in transit · arriving Tue") rather than a bare release date.
 * Best-effort — an empty map just means the UI shows the DB fallback.
 */
export async function fetchPayoutStatuses(
  accountId: string,
): Promise<Map<string, { status: string | null; arrival_date: number | null }>> {
  const map = new Map<string, { status: string | null; arrival_date: number | null }>()
  try {
    const stripe = getStripe()
    const list = await stripe.payouts.list({ limit: 100 }, { stripeAccount: accountId })
    for (const p of list.data) {
      map.set(p.id, { status: p.status ?? null, arrival_date: p.arrival_date ?? null })
    }
  } catch {
    /* degrade to the DB-only view */
  }
  return map
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
    .limit(200)
  if (qErr) {
    return Response.json({ ok: false, error: qErr.message }, { status: 500 })
  }

  let jobs = (rows ?? []).map((r) => toPayoutJob(r as unknown as Parameters<typeof toPayoutJob>[0]))

  // Best-effort live enrichment from Stripe. Gated on a secret key so unit
  // tests (no key) and key-less environments skip the network entirely and
  // fall back to the DB-only view. Never blocks or fails the response.
  let details: PayoutAccountDetails = EMPTY_DETAILS
  if (tenant.stripe_connect_account_id && process.env.STRIPE_SECRET_KEY) {
    const accountId = tenant.stripe_connect_account_id
    const [acctDetails, statuses] = await Promise.all([
      withTimeout(fetchAccountDetails(accountId), STRIPE_ENRICH_TIMEOUT_MS, null),
      withTimeout(
        fetchPayoutStatuses(accountId),
        STRIPE_ENRICH_TIMEOUT_MS,
        new Map<string, { status: string | null; arrival_date: number | null }>(),
      ),
    ])
    if (acctDetails) details = acctDetails
    if (statuses.size > 0) {
      jobs = jobs.map((j) =>
        j.payout && statuses.has(j.payout.id)
          ? { ...j, payout: { ...j.payout, ...statuses.get(j.payout.id)! } }
          : j,
      )
    }
  }

  return Response.json({
    ok: true,
    account: {
      has_account: !!tenant.stripe_connect_account_id,
      charges_enabled: !!tenant.stripe_connect_charges_enabled,
      payouts_enabled: !!tenant.stripe_connect_payouts_enabled,
      details_submitted: !!tenant.stripe_connect_details_submitted,
      onboarded_at: tenant.stripe_connect_onboarded_at ?? null,
      bank: details.bank,
      payout_schedule: details.payout_schedule,
      balance: details.balance,
      requirements_due: details.requirements_due,
    },
    jobs,
  })
}
