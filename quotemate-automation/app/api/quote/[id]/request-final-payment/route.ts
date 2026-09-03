// POST /api/quote/[id]/request-final-payment — the last step of the chain
// (spec post-visit-money-sequence R10).
//
// The tradie is standing on the finished job with their phone. This creates
// the 'balance' row for what is still owed — total, less the $99 site visit,
// less the deposit already taken — mints nothing itself, and texts the
// customer a /r short-link they can pay there and then.
//
// Why a THIRD row rather than a second payment on the final row: the whole
// chain rests on "one payment per quotes row", which is what makes the
// webhook's conditional `paid_at` claim, the /r never-re-charge redirect and
// the Connect payout release work unchanged. A balance_paid_at column would
// have duplicated that entire payment column set and the release path — the
// exact money code where this repo has grown silent-failure bugs.
//
// Contract, per the house rule: this route NEVER reports ok without sent.
// The row is created first, then the SMS; a dispatch failure returns 502 with
// the row in place so the tradie can retry without creating a second one (the
// partial unique index hands the same row back).

import { createClient } from '@supabase/supabase-js'
import { generateShareToken } from '@/lib/stripe/checkout'
import { connectDestinationForTenant, type TenantConnectState } from '@/lib/stripe/connect'
import {
  MIN_STRIPE_CHARGE_CENTS,
  asMoneyNumber,
  chargedCents,
  clampDepositPct,
  finalBalanceBaseCents,
} from '@/lib/quote/money'
import { asQuoteKind } from '@/lib/quote/mint-tier'
import { buildBalanceRequestSms } from '@/lib/sms/templates'
import { dispatchQuoteMessage } from '@/lib/sms/dispatch'
import { pipelineLog } from '@/lib/log/pipeline'
import { resolveTenantRequest } from '@/lib/tenant/from-request'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

const PG_UNIQUE_VIOLATION = '23505'

/** The deposit has been settled — either really paid, or covered outright by
 *  the $99 credit on a small job (the R8 'credit' stamp). */
const DEPOSIT_SETTLED_TIERS = new Set(['deposit', 'credit'])

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const log = pipelineLog('dispatch')
  const { id: finalId } = await ctx.params

  const resolved = await resolveTenantRequest(
    supabase,
    req,
    'id, twilio_sms_number, business_name, stripe_connect_account_id, stripe_connect_charges_enabled, stripe_connect_payouts_enabled',
  )
  if (!resolved) return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  const tenant = resolved.tenant as
    | (TenantConnectState & {
        id: string
        twilio_sms_number: string | null
        business_name: string | null
      })
    | null

  const { data: finalRow } = await supabase
    .from('quotes')
    .select(
      'id, tenant_id, intake_id, quote_kind, paid_at, paid_tier, sent_at, status, total_inc_gst, deposit_pct, scope_of_works, scope_short, assumptions, estimated_timeframe, gst_note, display_mode',
    )
    .eq('id', finalId)
    .maybeSingle()

  if (!finalRow) return Response.json({ ok: false, error: 'no_quote' }, { status: 404 })
  if (!finalRow.tenant_id) {
    return Response.json({ ok: false, error: 'parent_unscoped' }, { status: 409 })
  }
  if (!tenant || finalRow.tenant_id !== tenant.id) {
    return Response.json({ ok: false, error: 'not_owner' }, { status: 403 })
  }
  if (asQuoteKind(finalRow.quote_kind as string | null) !== 'final') {
    return Response.json({ ok: false, error: 'not_final_quote' }, { status: 409 })
  }
  if (!finalRow.sent_at) {
    return Response.json({ ok: false, error: 'final_not_sent' }, { status: 409 })
  }
  if (!finalRow.paid_at || !DEPOSIT_SETTLED_TIERS.has((finalRow.paid_tier as string) ?? '')) {
    return Response.json({ ok: false, error: 'deposit_not_paid' }, { status: 409 })
  }
  if (!connectDestinationForTenant(tenant)) {
    return Response.json({ ok: false, error: 'connect_required' }, { status: 409 })
  }

  // ─── What is still owed ──────────────────────────────────────────
  // From the final row's STORED total and deposit % — the same numbers the
  // deposit was charged from — so $99 + deposit + balance reconciles exactly
  // to the total the customer accepted.
  const totalCents = Math.round(asMoneyNumber(finalRow.total_inc_gst) * 100)
  const depositPct = clampDepositPct(finalRow.deposit_pct as number | null)
  const balanceBase = finalBalanceBaseCents(totalCents, depositPct)
  if (balanceBase < MIN_STRIPE_CHARGE_CENTS) {
    // A job at or under $99 is already paid in full by the site visit.
    return Response.json({ ok: false, error: 'nothing_to_charge' }, { status: 409 })
  }
  const charged = chargedCents(balanceBase)

  // An existing PAID balance child means the job is settled.
  // `.limit(1)` rather than a bare `.maybeSingle()`: the partial unique index
  // constrains only UNPAID children, so this query is not guaranteed unique.
  // maybeSingle() ERRORS on multiple rows, and a swallowed error here would
  // read as "no prior payment" and open a second balance charge.
  {
    const { data: priorPaid, error: priorPaidErr } = await supabase
      .from('quotes')
      .select('id')
      .eq('parent_quote_id', finalRow.id)
      .eq('quote_kind', 'balance')
      .not('paid_at', 'is', null)
      .limit(1)
    if (priorPaidErr) {
      log.err('paid-balance probe failed', priorPaidErr.message, { final_id: finalRow.id })
      return Response.json({ ok: false, error: 'lookup_failed' }, { status: 500 })
    }
    if (priorPaid && priorPaid.length > 0) {
      return Response.json({ ok: false, error: 'balance_already_paid' }, { status: 409 })
    }
  }

  // ─── Create (or recover) the balance row ─────────────────────────
  const shareToken = generateShareToken()
  const nowIso = new Date().toISOString()
  let balanceId: string | null = null
  let balanceToken: string | null = null
  let already = false
  /** sent_at of a row recovered through the 23505 path — how we tell a
   *  double-tap from a deliberate re-send minutes later. */
  let recoveredSentAt: string | null = null

  const { data: created, error: insertErr } = await supabase
    .from('quotes')
    .insert({
      intake_id: finalRow.intake_id,
      tenant_id: finalRow.tenant_id,
      quote_kind: 'balance',
      parent_quote_id: finalRow.id,
      share_token: shareToken,
      // NOT stamped sent here. sent_at must mean "a carrier accepted a text at
      // this time" and nothing else — it is what the double-tap window below
      // reads. Stamping it at insert made a row created 30s ago whose SMS then
      // 502'd indistinguishable from one delivered 30s ago, which suppressed
      // the legitimate retry AND reported it to the tradie as a re-send. Same
      // released_at / quote_sent_at split painting had to make. Stamped after
      // a delivered dispatch below.
      status: 'draft',
      sent_at: null,
      // The balance IS the row's total: /r reads total_inc_gst and deposit_pct
      // and, for a balance row, charges the whole remaining amount.
      total_inc_gst: +(balanceBase / 100).toFixed(2),
      deposit_pct: depositPct,
      needs_inspection: false,
      good: null,
      better: null,
      best: null,
      scope_of_works: finalRow.scope_of_works,
      scope_short: finalRow.scope_short ?? null,
      assumptions: finalRow.assumptions ?? [],
      estimated_timeframe: finalRow.estimated_timeframe,
      gst_note: finalRow.gst_note,
      display_mode: finalRow.display_mode ?? null,
      stripe_links: {},
      price_hold_until: null,
    })
    .select('id, share_token')
    .maybeSingle()

  if (insertErr) {
    if (insertErr.code === PG_UNIQUE_VIOLATION) {
      const { data: existing } = await supabase
        .from('quotes')
        .select('id, share_token, sent_at')
        .eq('parent_quote_id', finalRow.id)
        .eq('quote_kind', 'balance')
        .is('paid_at', null)
        .maybeSingle()
      if (existing) {
        balanceId = existing.id as string
        balanceToken = existing.share_token as string
        already = true
        recoveredSentAt = (existing.sent_at as string | null) ?? null
      }
    }
    if (!balanceId) {
      log.err('balance row insert failed', insertErr.message, { final_id: finalRow.id })
      return Response.json(
        { ok: false, error: 'insert_failed', detail: insertErr.message },
        { status: 500 },
      )
    }
  } else {
    balanceId = (created?.id as string) ?? null
    balanceToken = (created?.share_token as string) ?? shareToken
  }

  // ─── Text the customer ───────────────────────────────────────────
  type IntakeRow = {
    call_id?: string | null
    job_type?: string | null
    caller?: { name?: string; phone?: string } | null
  }
  let intake: IntakeRow | null = null
  if (finalRow.intake_id) {
    const { data } = await supabase
      .from('intakes')
      .select('id, call_id, job_type, caller')
      .eq('id', finalRow.intake_id)
      .maybeSingle()
    intake = (data as unknown as IntakeRow | null) ?? null
  }
  let callerNumber: string | null = intake?.caller?.phone ?? null
  if (!callerNumber && intake?.call_id) {
    const { data: callRow } = await supabase
      .from('calls')
      .select('caller_number')
      .eq('id', intake.call_id)
      .maybeSingle()
    callerNumber = (callRow?.caller_number as string | null) ?? null
  }

  if (!callerNumber) {
    // The row exists and is payable from the dashboard, but we cannot claim
    // a send that did not happen.
    return Response.json(
      {
        ok: false,
        error: 'no_customer_number',
        sent: false,
        quote_id: balanceId,
        share_token: balanceToken,
      },
      { status: 409 },
    )
  }

  // A double-tap on the job must not text the customer twice. The DB index
  // collapses the two INSERTS into one row; this collapses the two SENDS.
  //
  // A CONDITIONAL CLAIM on sent_at, not a timestamp comparison — the same
  // pattern the payment path uses for paid_at, and for the same reason: a
  // time-window check cannot see a first dispatch that is still IN FLIGHT
  // (its sent_at is not written yet), so two near-simultaneous taps would
  // both pass it and both text the customer. Whoever wins this UPDATE owns
  // the send; the loser matches zero rows and reports sent:false.
  //
  // The window is still here, as the claim's WHERE: a row last sent longer
  // ago than this is re-claimable, which is how a tradie deliberately
  // re-sends. And because a failed dispatch REVERTS the claim below, a retry
  // after a carrier failure is never blocked.
  const DOUBLE_TAP_WINDOW_MS = 2 * 60_000
  const claimCutoff = new Date(Date.now() - DOUBLE_TAP_WINDOW_MS).toISOString()
  const { data: claimed, error: claimErr } = await supabase
    .from('quotes')
    .update({ sent_at: nowIso })
    .eq('id', balanceId as string)
    .or(`sent_at.is.null,sent_at.lt.${claimCutoff}`)
    .select('id')
  if (claimErr) {
    log.err('balance send claim failed', claimErr.message, { quote_id: balanceId })
    return Response.json({ ok: false, error: 'claim_failed', sent: false }, { status: 500 })
  }
  if (!claimed || claimed.length === 0) {
    log.ok('balance re-request suppressed — another send holds the claim', {
      quote_id: balanceId,
    })
    return Response.json({
      ok: true,
      sent: false,
      already: true,
      suppressed: 'recently_sent',
      quote_id: balanceId,
      share_token: balanceToken,
      balance_cents: balanceBase,
      charged_cents: charged,
    })
  }

  const appUrl = process.env.APP_URL ?? 'https://www.quotemax.com.au'
  const body = buildBalanceRequestSms({
    firstName: intake?.caller?.name,
    businessName: tenant.business_name,
    jobType: intake?.job_type ?? 'job',
    balanceAud: Math.round(balanceBase / 100),
    chargedAud: Math.round(charged / 100),
    payUrl: `${appUrl}/r/${balanceToken}/balance`,
  })

  const dispatch = await dispatchQuoteMessage({
    to: callerNumber,
    text: body,
    from: tenant.twilio_sms_number ?? undefined,
  })

  if (!dispatch.ok) {
    log.err('balance request SMS failed', null, {
      quote_id: balanceId,
      sms_code: dispatch.smsAttempt.code,
    })
    // Hand the claim back. Without this the failed send would leave sent_at
    // stamped, the row would look delivered, and the tradie's retry would be
    // suppressed for two minutes — the exact window a retry happens in.
    // (Same shape as painting's revertPaintingRelease.)
    const { error: revertErr } = await supabase
      .from('quotes')
      .update({ sent_at: null })
      .eq('id', balanceId as string)
    if (revertErr) {
      log.err('balance send-claim revert failed', revertErr.message, { quote_id: balanceId })
    }
    return Response.json(
      {
        ok: false,
        error: 'send_failed',
        sent: false,
        quote_id: balanceId,
        share_token: balanceToken,
        detail: dispatch.smsAttempt.code ?? null,
      },
      { status: 502 },
    )
  }

  // Delivered. sent_at is already held by the claim above; advance the
  // lifecycle so the row stops reading as a draft awaiting the tradie.
  if (balanceId) {
    const { error: stampErr } = await supabase
      .from('quotes')
      .update({ status: 'sent' })
      .eq('id', balanceId)
    if (stampErr) {
      log.err('balance sent stamp failed', stampErr.message, { quote_id: balanceId })
    }
  }

  log.ok('balance requested', {
    final_id: finalRow.id,
    balance_id: balanceId,
    base_cents: balanceBase,
    charged_cents: charged,
  })

  return Response.json({
    ok: true,
    sent: true,
    already,
    quote_id: balanceId,
    share_token: balanceToken,
    balance_cents: balanceBase,
    charged_cents: charged,
  })
}
