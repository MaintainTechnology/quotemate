// POST /api/quote/[id]/complete — the disbursement gate.
//
// The tradie marks a paid job complete; QuoteMax releases their share
// (paid − 2% platform fee) from the connected account's held Stripe balance
// to their bank via a manual Payout (the account's payout schedule is
// 'manual' — lib/stripe/provision.ts — so nothing moves until this runs).
//
//   1. Auth via Bearer supabase token → tenant must own the quote.
//   2. Stamp quotes.completed_at (idempotent — a job stays completed).
//   3. Release eligibility via payoutReleaseDecision (paid, Connect-routed,
//      account still current, payouts enabled, not already released).
//   4. Sentinel claim on quotes.stripe_payout_id ('pending') so a double
//      click / concurrent request can never create two payouts, then
//      stripe.payouts.create on the connected account and stamp the po_… id.
//      A failed create (e.g. balance_insufficient while the charge is still
//      settling) hands the claim back so the tradie can retry later.
//
// Response shape: { ok, completed, released, ... } — completion can succeed
// while the release is blocked (legacy platform-direct payment, re-onboarded
// account, funds still settling); the dashboard explains the block.

import { createClient } from '@supabase/supabase-js'
import {
  payoutReleaseDecision,
  createConnectPayout,
  PAYOUT_CLAIM_SENTINEL,
  type PayoutQuoteState,
  type TenantConnectState,
} from '@/lib/stripe/connect'
import { pipelineLog } from '@/lib/log/pipeline'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

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

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const log = pipelineLog('dispatch')
  const { id: quoteId } = await ctx.params

  const user = await userFromBearer(req)
  if (!user) {
    return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  const { data: quote } = await supabase
    .from('quotes')
    .select(
      'id, tenant_id, paid_at, paid_tier, paid_amount_cents, platform_fee_cents, stripe_connect_destination, completed_at, stripe_payout_id, payout_amount_cents, payout_created_at',
    )
    .eq('id', quoteId)
    .maybeSingle()
  if (!quote) return Response.json({ ok: false, error: 'no_quote' }, { status: 404 })
  if (!quote.tenant_id) {
    return Response.json({ ok: false, error: 'unscoped_quote' }, { status: 403 })
  }

  const { data: tenant } = await supabase
    .from('tenants')
    .select(
      'id, owner_user_id, stripe_connect_account_id, stripe_connect_charges_enabled, stripe_connect_payouts_enabled',
    )
    .eq('id', quote.tenant_id)
    .maybeSingle()
  if (!tenant || tenant.owner_user_id !== user.id) {
    return Response.json({ ok: false, error: 'not_owner' }, { status: 403 })
  }

  if (!quote.paid_at) {
    return Response.json({ ok: false, error: 'not_paid' }, { status: 409 })
  }

  // ─── 2. Completion is a job-state fact — stamp it first ─────────
  let completedAt = quote.completed_at as string | null
  if (!completedAt) {
    completedAt = new Date().toISOString()
    const { error: doneErr } = await supabase
      .from('quotes')
      .update({ completed_at: completedAt })
      .eq('id', quoteId)
    if (doneErr) {
      return Response.json(
        { ok: false, error: 'complete_stamp_failed', detail: doneErr.message },
        { status: 500 },
      )
    }
  }

  // ─── 3. Release eligibility ──────────────────────────────────────
  const decision = payoutReleaseDecision(
    quote as PayoutQuoteState,
    tenant as TenantConnectState,
  )

  if (!decision.ok) {
    if (decision.reason === 'already_released') {
      return Response.json({
        ok: true,
        completed: true,
        released: true,
        already: true,
        completed_at: completedAt,
        payout: {
          id: quote.stripe_payout_id,
          amount_cents: quote.payout_amount_cents,
          created_at: quote.payout_created_at,
        },
      })
    }
    return Response.json({
      ok: true,
      completed: true,
      released: false,
      completed_at: completedAt,
      block: decision.reason,
    })
  }

  // ─── 4. Single-payout claim, then move the money ────────────────
  const { data: claimed, error: claimErr } = await supabase
    .from('quotes')
    .update({ stripe_payout_id: PAYOUT_CLAIM_SENTINEL })
    .eq('id', quoteId)
    .is('stripe_payout_id', null)
    .select('id')
  if (claimErr) {
    return Response.json(
      { ok: false, error: 'payout_claim_failed', detail: claimErr.message },
      { status: 500 },
    )
  }
  if (!claimed || claimed.length === 0) {
    return Response.json({
      ok: true,
      completed: true,
      released: false,
      completed_at: completedAt,
      block: 'release_in_progress',
    })
  }

  const payout = await createConnectPayout({
    accountId: decision.accountId,
    amountCents: decision.amountCents,
    quoteId,
  })

  if (!payout.ok) {
    // Hand the claim back so the tradie can retry (typically once the
    // charge finishes settling and the balance becomes available).
    await supabase
      .from('quotes')
      .update({ stripe_payout_id: null })
      .eq('id', quoteId)
      .eq('stripe_payout_id', PAYOUT_CLAIM_SENTINEL)
    log.err('payout create failed — claim released for retry', payout.reason, {
      quote_id: quoteId,
      code: payout.code,
    })
    return Response.json(
      { ok: false, error: 'payout_failed', code: payout.code, detail: payout.reason },
      { status: 502 },
    )
  }

  const payoutCreatedAt = new Date().toISOString()
  const { error: stampErr } = await supabase
    .from('quotes')
    .update({
      stripe_payout_id: payout.payoutId,
      payout_amount_cents: decision.amountCents,
      payout_created_at: payoutCreatedAt,
    })
    .eq('id', quoteId)
  if (stampErr) {
    // The payout EXISTS on Stripe — never claim otherwise. Log loudly; the
    // 'pending' sentinel stays (blocking a duplicate) until reconciled.
    log.err('payout created but DB stamp failed — reconcile manually', stampErr.message, {
      quote_id: quoteId,
      payout_id: payout.payoutId,
    })
  }

  log.done('job completed, payout released', {
    quote_id: quoteId,
    payout_id: payout.payoutId,
    amount_cents: decision.amountCents,
  })

  return Response.json({
    ok: true,
    completed: true,
    released: true,
    completed_at: completedAt,
    payout: {
      id: payout.payoutId,
      amount_cents: decision.amountCents,
      created_at: payoutCreatedAt,
    },
  })
}
