// POST /api/quote/[id]/issue-final — the step that unblocks a job stuck at
// "site visit paid" (spec post-visit-money-sequence R3).
//
// Before this route, an electrical/plumbing job was structurally TERMINAL
// once the customer paid the $99: the quotes row holds exactly one payment
// (`paid_at` is claimed conditionally and the webhook drops any later
// session), and every tradie mutation — edit, chat-edit, send — 409s on it.
// The only post-payment action was releasing the $99 to the tradie's bank.
//
// So the forward path is a NEW row, not a second payment on the old one: a
// 'final' child carrying the price the tradie confirmed on site, linked to
// the paid parent by parent_quote_id. The parent stays frozen and truthful
// (it records the $99 that was actually paid); the child is a normal
// editable draft that the tradie prices, sends, and collects a deposit on.
//
//   1. Auth via resolveTenantRequest → the tenant must own the parent.
//   2. Preconditions — the site visit is paid, the parent is an initial row,
//      and the tenant can actually be paid (Connect).
//   3. Resolve the deposit % for this job type from the tenant's pricing book.
//   4. INSERT the child. The partial unique index from migration 194 is the
//      idempotency guarantee: a double-click is a 23505, and we hand back the
//      child that already exists rather than creating a second one.
//
// Response: { ok, share_token, quote_id, already } — the dashboard navigates
// to /dashboard/quote/<share_token>.

import { createClient } from '@supabase/supabase-js'
import { generateShareToken } from '@/lib/stripe/checkout'
import { connectDestinationForTenant, type TenantConnectState } from '@/lib/stripe/connect'
import { asMoneyNumber, resolveDepositPct, totalIncGstCents } from '@/lib/quote/money'
import { asQuoteKind, isSiteVisitFirstTrade } from '@/lib/quote/mint-tier'
import { seedLineItems, type SeedableLineItem } from '@/lib/quote/tier-materialise'
import { pipelineLog } from '@/lib/log/pipeline'
import { resolveTenantRequest } from '@/lib/tenant/from-request'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

type Tier = {
  label?: string | null
  subtotal_ex_gst?: number | string | null
  line_items?: SeedableLineItem[] | null
} | null

/** Postgres unique-violation — here, the partial index that allows at most
 *  one UNPAID child of each kind per parent. */
const PG_UNIQUE_VIOLATION = '23505'

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const log = pipelineLog('dispatch')
  const { id: parentId } = await ctx.params

  const resolved = await resolveTenantRequest(
    supabase,
    req,
    'id, stripe_connect_account_id, stripe_connect_charges_enabled, stripe_connect_payouts_enabled',
  )
  if (!resolved) return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  const tenant = resolved.tenant as (TenantConnectState & { id: string }) | null

  const { data: parent } = await supabase
    .from('quotes')
    .select(
      'id, tenant_id, intake_id, paid_at, paid_tier, quote_kind, good, better, best, selected_tier, scope_of_works, scope_short, assumptions, risk_flags, estimated_timeframe, gst_note, display_mode, optional_upsells',
    )
    .eq('id', parentId)
    .maybeSingle()

  if (!parent) return Response.json({ ok: false, error: 'no_quote' }, { status: 404 })

  // Legacy tenant-less rows can't be owned, priced against a pricing book, or
  // paid out — refuse rather than create an unreachable child.
  if (!parent.tenant_id) {
    return Response.json({ ok: false, error: 'parent_unscoped' }, { status: 409 })
  }
  if (!tenant || parent.tenant_id !== tenant.id) {
    return Response.json({ ok: false, error: 'not_owner' }, { status: 403 })
  }
  if (asQuoteKind(parent.quote_kind as string | null) !== 'initial') {
    return Response.json({ ok: false, error: 'not_initial' }, { status: 409 })
  }
  // The final quote exists to charge the balance of a job that has BEEN
  // visited. Without the paid site visit there is no $99 to credit and no
  // confirmed price to quote.
  if (!parent.paid_at || parent.paid_tier !== 'inspection') {
    return Response.json({ ok: false, error: 'site_visit_not_paid' }, { status: 409 })
  }
  // Unlike the $99 — which falls back to a platform-direct charge — a deposit
  // MUST be Connect-routed: a platform-direct child can never be released to
  // the tradie (payoutReleaseDecision → 'not_connect_routed'), so the money
  // would strand in QuoteMax's account. Refuse before creating the row.
  if (!connectDestinationForTenant(tenant)) {
    return Response.json({ ok: false, error: 'connect_required' }, { status: 409 })
  }

  // A job takes ONE deposit. The partial unique index only blocks a second
  // UNPAID child, so once the first final quote is paid it stops guarding —
  // and without this check the toolbar would happily issue a second final
  // row whose /r/<token>/deposit link is a fully chargeable second deposit.
  // Worse, /q/<initial token> resolves to the NEWEST final child, so the link
  // still sitting in the customer's SMS thread would start rendering the new
  // unpriced draft instead of the quote they actually paid against.
  {
    const { data: paidChild, error: paidChildErr } = await supabase
      .from('quotes')
      .select('id')
      .eq('parent_quote_id', parent.id)
      .eq('quote_kind', 'final')
      .not('paid_at', 'is', null)
      .limit(1)
    if (paidChildErr) {
      log.err('paid-child probe failed', paidChildErr.message, { parent_id: parent.id })
      return Response.json({ ok: false, error: 'lookup_failed' }, { status: 500 })
    }
    if (paidChild && paidChild.length > 0) {
      return Response.json({ ok: false, error: 'final_already_paid' }, { status: 409 })
    }
  }

  // ─── Trade + job type drive the gate and the deposit % ───────────
  // supabase-js RESOLVES {data,error} on failure rather than throwing, so a
  // bare `const { data }` here would make a transient read error look
  // identical to "this intake has no trade" — and answer with a misleading
  // not_site_visit_first 409.
  const { data: intakeRow, error: intakeErr } = await supabase
    .from('intakes')
    .select('trade, job_type')
    .eq('id', parent.intake_id)
    .maybeSingle()
  if (intakeErr) {
    log.err('intake read failed', intakeErr.message, { parent_id: parent.id })
    return Response.json({ ok: false, error: 'intake_unavailable' }, { status: 500 })
  }
  const trade = (intakeRow?.trade as string | null) ?? null
  const jobType = (intakeRow?.job_type as string | null) ?? null

  // Only the site-visit-first trades have a post-visit step to unblock. The
  // other trades on this shared funnel still sell a deposit up front.
  if (!isSiteVisitFirstTrade(trade)) {
    return Response.json({ ok: false, error: 'not_site_visit_first' }, { status: 409 })
  }

  // ─── Deposit % for this job type (spec R2) ───────────────────────
  // Read the tenant's book for THIS trade only — no any-row fallback: on a
  // multi-trade tenant that would silently price an electrical job off the
  // plumbing (or roofing) book's map.
  //
  // The `error` check is load-bearing, not hygiene: this row decides the
  // deposit PERCENTAGE that gets stamped on the child and charged for real.
  // A swallowed read error would leave overlays null, resolveDepositPct would
  // return the platform default 30, and an EV charger job configured at 50%
  // would quietly collect a deposit short by 20% of the job — with nothing
  // downstream able to tell it apart from a correctly-resolved 30%. Refuse
  // instead: the tradie can retry, and a retry costs nothing.
  const { data: book, error: bookErr } = await supabase
    .from('pricing_book')
    .select('overlays, gst_registered')
    .eq('tenant_id', parent.tenant_id)
    .eq('trade', trade)
    .maybeSingle()
  if (bookErr) {
    log.err('pricing_book read failed', bookErr.message, {
      parent_id: parent.id,
      trade,
    })
    return Response.json({ ok: false, error: 'pricing_book_unavailable' }, { status: 500 })
  }
  const overlays = (book?.overlays as Record<string, unknown> | null) ?? null
  const gstRegistered = (book?.gst_registered as boolean | null) ?? true
  const depositPct = resolveDepositPct(overlays?.deposit_pct_by_job_type, jobType)

  // ─── The child's price ───────────────────────────────────────────
  // Start from whatever the parent actually quoted. An inspection-routed
  // parent has NULL tiers by design (an Opus-drafted inspection quote may
  // not ship fabricated prices) — which is the COMMON electrical case — so
  // seed a single whole-of-job line at $0 for the tradie to price on site.
  const selectedKey = (parent.selected_tier as 'good' | 'better' | 'best' | null) ?? null
  const source: Tier =
    (selectedKey ? (parent[selectedKey] as Tier) : null) ??
    (parent.better as Tier) ??
    (parent.good as Tier) ??
    (parent.best as Tier) ??
    null

  const sourceSubtotal = asMoneyNumber(source?.subtotal_ex_gst ?? 0)
  const seeded = source ? seedLineItems({ ...source, subtotal_ex_gst: sourceSubtotal }) : []
  const good = {
    label: source?.label?.trim() || 'Final quote',
    subtotal_ex_gst: sourceSubtotal,
    line_items:
      seeded.length > 0
        ? seeded
        : [
            {
              description: 'Job as quoted — confirmed on site',
              quantity: 1,
              unit: 'job',
              unit_price_ex_gst: 0,
              total_ex_gst: 0,
            },
          ],
  }

  const totalIncGst = totalIncGstCents(sourceSubtotal, { gstRegistered }) / 100
  const gst = +(totalIncGst - sourceSubtotal).toFixed(2)

  const shareToken = generateShareToken()
  const childRow = {
    // Copied from the parent — same job, same customer, same scope.
    intake_id: parent.intake_id,
    tenant_id: parent.tenant_id,
    scope_of_works: parent.scope_of_works,
    scope_short: parent.scope_short ?? null,
    assumptions: parent.assumptions ?? [],
    risk_flags: parent.risk_flags ?? [],
    estimated_timeframe: parent.estimated_timeframe,
    gst_note: parent.gst_note,
    display_mode: parent.display_mode ?? null,
    optional_upsells: parent.optional_upsells ?? [],

    // The chain.
    quote_kind: 'final',
    parent_quote_id: parent.id,
    share_token: shareToken,
    deposit_pct: depositPct,

    // A normal editable draft — NOT inspection-routed, or the editor 409s
    // (`cannot_edit_inspection_quote`) and the PDF refuses to render.
    status: 'draft',
    needs_inspection: false,
    inspection_reason: null,
    // One confirmed price, in the `good` slot. 'good' (not the DB default
    // 'better') so the single populated tier is the selected one everywhere.
    selected_tier: 'good',
    good,
    better: null,
    best: null,
    subtotal_ex_gst: sourceSubtotal,
    gst,
    total_inc_gst: totalIncGst,

    // Deliberately NOT copied — each would misrepresent the child:
    //   paid_*/stripe_links/pdf_*/sent_at → this row has transacted nothing;
    //   booking_state/scheduled_* → the visit is behind us;
    //   early_bird_*/applied_discount_pct → an inherited live offer would let
    //     resolveMintDiscount silently discount the deposit;
    //   price_hold_until → a final quote is not a 7-day estimate, and the
    //     mint skips the hold gate for children anyway.
    stripe_links: {},
    price_hold_until: null,
  }

  const { data: created, error: insertErr } = await supabase
    .from('quotes')
    .insert(childRow)
    .select('id, share_token')
    .maybeSingle()

  if (insertErr) {
    // The partial unique index did its job: an open final child already
    // exists for this parent (double-click, double-tab). Hand back the
    // existing one — the tradie wanted to get to it, not to make a second.
    if (insertErr.code === PG_UNIQUE_VIOLATION) {
      const { data: existing } = await supabase
        .from('quotes')
        .select('id, share_token')
        .eq('parent_quote_id', parent.id)
        .eq('quote_kind', 'final')
        .is('paid_at', null)
        .maybeSingle()
      if (existing) {
        return Response.json({
          ok: true,
          already: true,
          quote_id: existing.id,
          share_token: existing.share_token,
        })
      }
    }
    log.err('final quote insert failed', insertErr.message, { parent_id: parent.id })
    return Response.json(
      { ok: false, error: 'insert_failed', detail: insertErr.message },
      { status: 500 },
    )
  }

  log.ok('final quote issued', {
    parent_id: parent.id,
    child_id: created?.id,
    deposit_pct: depositPct,
    job_type: jobType,
  })

  return Response.json({
    ok: true,
    already: false,
    quote_id: created?.id ?? null,
    share_token: created?.share_token ?? shareToken,
    deposit_pct: depositPct,
  })
}
