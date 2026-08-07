// Public self-serve quote-request form — POST handler, every trade.
//
// spec: specs/generic-quote-request-form.md §3.
//
// Token = trade_lead_requests.token. No auth: the unguessable token IS the
// capability, exactly like the public quote pages and /api/paint-request.
// One-shot — a submitted link cannot be re-run.
//
// Order of operations, and why:
//   1. load the lead (error CHECKED — a PostgREST outage is a 503, not
//      "your link is invalid")
//   2. validate the body against the schema for THAT lead's trade
//   3. CLAIM the token with a conditional update (status pending → submitted).
//      This is the one-shot gate AND the double-submit guard: a second tab
//      matches zero rows and gets a 409 instead of a second quote.
//   4. write the submission onto the SMS thread (the electrical/plumbing
//      hand-off structures the transcript, so an unwritten brief means a
//      quote drafted off nothing)
//   5. run that trade's estimate path — the SAME one the SMS gather uses
//   6. on any failure, RELEASE the claim (status back to pending) and
//      return non-2xx. Never 200 on a failed write or hand-off.
//
// Differences from the painting reference are deliberate, not drift: it
// returns 200 on a failed estimate, bare-awaits its mark-submitted write,
// and reads a lead-lookup error as an invalid link. All three are fixed here.

import { createClient } from '@supabase/supabase-js'
import { isQuoteRequestTrade, type QuoteRequestTrade } from '@/lib/quote-request/fields'
import {
  intakeJobTypeHint,
  parseQuoteRequest,
  summariseSubmission,
  type QuoteRequestData,
} from '@/lib/quote-request/schema'
import { runAndSavePaintingQuote } from '@/lib/painting/quote-dispatch'
import { revertPaintingRelease, sendPaintingQuoteToCustomer } from '@/lib/painting/release'
import { measureAndDispatchRoofing } from '@/lib/sms/roofing-measure-dispatch'
import { sendSms } from '@/lib/sms/twilio'
import type { SupabaseClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
// The estimate is awaited inline (a provider measure, or the whole Opus
// intake→draft chain) so a failure can be reported honestly instead of
// disappearing into after().
export const maxDuration = 300

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

// APEX, never www: the www host 307-redirects cross-origin and strips
// Authorization, which 401s the internal intake hand-off below.
const APP_BASE_URL = (
  process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL ?? 'https://quotemax.com.au'
).replace(/\/$/, '')

type Lead = {
  token: string
  trade: string
  tenant_id: string | null
  conversation_id: string | null
  customer_phone: string | null
  status: string
}

type Conversation = { to_number: string | null; conversation_state: Record<string, unknown> | null }

/** What a trade's estimate path reports back. `ok:false` releases the claim. */
type Handoff =
  | { ok: true; quoteToken: string | null; inspection: boolean; texted?: boolean }
  | { ok: false; reason: string }

const fail = (status: number, error: string, extra?: Record<string, unknown>) =>
  Response.json({ ok: false, error, ...extra }, { status })

export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params

  // 1. Load the lead. supabase-js RESOLVES { data, error } — the error is
  //    checked so an outage never renders as "invalid or expired link".
  const { data: leadRow, error: leadErr } = await supabase
    .from('trade_lead_requests')
    .select('token, trade, tenant_id, conversation_id, customer_phone, status')
    .eq('token', token)
    .maybeSingle()
  if (leadErr) {
    console.error('[quote-request] lead lookup failed', leadErr.message)
    return fail(503, 'lookup_failed')
  }
  if (!leadRow) return fail(404, 'invalid_link')

  const lead = leadRow as Lead
  if (lead.status === 'submitted') return fail(409, 'already_submitted')
  if (lead.status !== 'pending') return fail(410, 'link_expired')
  if (!isQuoteRequestTrade(lead.trade)) {
    console.error('[quote-request] lead carries a trade this form cannot serve', lead.trade)
    return fail(500, 'unsupported_trade')
  }

  // 2. Body + per-trade Zod. Both before any write.
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return fail(400, 'invalid_json')
  }
  const parsed = parseQuoteRequest(lead.trade, body)
  if (!parsed.ok) return fail(400, 'invalid_request', { issues: parsed.issues })
  const data = parsed.data

  // 3. Claim the token. Conditional on status='pending', so two concurrent
  //    submits cannot both proceed — the loser matches zero rows.
  const { data: claimed, error: claimErr } = await supabase
    .from('trade_lead_requests')
    .update({ status: 'submitted', submitted_at: new Date().toISOString() })
    .eq('token', token)
    .eq('status', 'pending')
    .select('token')
  if (claimErr) {
    console.error('[quote-request] claim write failed', claimErr.message)
    return fail(503, 'claim_failed')
  }
  if (!Array.isArray(claimed) || claimed.length === 0) return fail(409, 'already_submitted')

  const release = async () => {
    const { error } = await supabase
      .from('trade_lead_requests')
      .update({ status: 'pending', submitted_at: null })
      .eq('token', token)
    if (error) {
      // The customer sees a non-2xx either way; this only means the link
      // stays spent. Loud, because it needs a human to reopen it.
      console.error('[quote-request] could not release the claimed link', token, error.message)
    }
  }

  try {
    // 4. Put the submission on the thread. Load the conversation once —
    //    the roofing branch needs its from-number, electrical/plumbing need
    //    its state, and both need the message written.
    let conv: Conversation | null = null
    if (lead.conversation_id) {
      const { data: c, error: convErr } = await supabase
        .from('sms_conversations')
        .select('to_number, conversation_state')
        .eq('id', lead.conversation_id)
        .maybeSingle()
      if (convErr) {
        console.error('[quote-request] conversation lookup failed', convErr.message)
        await release()
        return fail(502, 'thread_read_failed')
      }
      conv = (c as Conversation | null) ?? null

      const { error: msgErr } = await supabase.from('sms_messages').insert({
        conversation_id: lead.conversation_id,
        direction: 'inbound',
        body: summariseSubmission(data),
      })
      if (msgErr) {
        // Fatal on purpose: /api/intake/structure structures the TRANSCRIPT,
        // so a dropped message means electrical/plumbing would be quoted off
        // a brief the customer never gave.
        console.error('[quote-request] could not write the submission to the thread', msgErr.message)
        await release()
        return fail(502, 'thread_write_failed')
      }
    }

    // 5. Trade's own estimate path.
    const handoff = await runHandoff({ lead, trade: lead.trade, data, conv })
    if (!handoff.ok) {
      console.error('[quote-request] estimate hand-off failed', lead.trade, handoff.reason)
      await release()
      return fail(502, 'estimate_failed', { reason: handoff.reason })
    }

    if (handoff.quoteToken) {
      const { error: tokErr } = await supabase
        .from('trade_lead_requests')
        .update({ quote_token: handoff.quoteToken })
        .eq('token', token)
      // Best-effort BY DESIGN, and the only write here that is: the quote
      // has already been produced and texted. A non-2xx now would send the
      // customer back to resubmit and quote them twice. Ops-visible instead.
      if (tokErr) console.error('[quote-request] quote_token not recorded', token, tokErr.message)
    }

    return Response.json({ ok: true, inspection: handoff.inspection, texted: handoff.texted ?? false })
  } catch (e) {
    console.error('[quote-request] unhandled failure', e)
    await release()
    return fail(500, 'server_error')
  }
}

async function runHandoff(args: {
  lead: Lead
  trade: QuoteRequestTrade
  data: QuoteRequestData
  conv: Conversation | null
}): Promise<Handoff> {
  const { lead, data, conv } = args
  const client = supabase as unknown as SupabaseClient

  if (data.trade === 'painting') {
    // Identical entry point to the painting SMS receptionist and the
    // existing /paint-request form, so the three cannot drift.
    const disp = await runAndSavePaintingQuote({
      supabase: client,
      tenantId: lead.tenant_id,
      customerPhone: lead.customer_phone,
      customerName: data.first_name ?? null,
      request: { address: data.address, inputs: data.inputs },
    })
    if (!disp.ok) return { ok: false, reason: disp.reason }

    const { sent } = await sendPaintingQuoteToCustomer(client, {
      publicToken: disp.token,
      appUrl: APP_BASE_URL,
    })
    // A priced row is released at save time. If nothing reached the
    // customer, hold it again so /p can retry — never leave a row claiming
    // a delivery that did not happen.
    if (!sent && !disp.inspection) await revertPaintingRelease(client, disp.token)
    return { ok: true, quoteToken: disp.token, inspection: disp.inspection, texted: sent }
  }

  if (data.trade === 'roofing') {
    if (!lead.conversation_id || !lead.customer_phone) {
      return { ok: false, reason: 'roofing needs the SMS thread it was offered from' }
    }
    let fromNumber = conv?.to_number ?? null
    let tenantTrade: string | null = null
    if (lead.tenant_id) {
      const { data: t } = await supabase
        .from('tenants')
        .select('trade, twilio_sms_number')
        .eq('id', lead.tenant_id)
        .maybeSingle()
      const tenant = (t as { trade?: string | null; twilio_sms_number?: string | null } | null) ?? null
      tenantTrade = tenant?.trade ?? null
      if (!fromNumber) fromNumber = tenant?.twilio_sms_number ?? null
    }
    const conversationId = lead.conversation_id
    const customerPhone = lead.customer_phone

    const dispatched = await measureAndDispatchRoofing({
      supabase: client,
      tenantId: lead.tenant_id,
      tenantTrade,
      conversationId,
      customerPhone,
      replyFrom: fromNumber ?? undefined,
      firstName: data.first_name ?? null,
      baseUrl: APP_BASE_URL,
      slots: {
        address: data.address.address,
        postcode: data.address.postcode,
        state: data.address.state,
        // The customer typed and confirmed it on the form; there is no
        // read-back turn to re-verify against.
        address_confirmed: true,
        addr_verified: data.address.address,
        material: data.inputs.material,
        pitch: data.inputs.pitch,
        intent: data.inputs.intent,
        year_built: data.inputs.building_year_built ?? null,
      },
      // The deterministic pricer owns the inspection decision (cement
      // sheet, unknown pitch, 3+ storeys, no footprint …). The form must
      // not pre-empt it — that would be a second, drifting copy of the
      // routing rules.
      isInspection: false,
      sendReply: async (text: string) => {
        const res = await sendSms({ to: customerPhone, from: fromNumber ?? undefined, text })
        if (!res.ok) {
          console.error('[quote-request] Twilio rejected the roofing reply', res.code, res.reason)
          return
        }
        const { error } = await supabase
          .from('sms_messages')
          .insert({ conversation_id: conversationId, direction: 'outbound', body: text })
        if (error) console.error('[quote-request] roofing reply not persisted', error.message)
      },
    })
    if (!dispatched.ok) return { ok: false, reason: dispatched.reason }

    const { error: stateErr } = await supabase
      .from('sms_conversations')
      .update({ roofing_state: dispatched.state, updated_at: new Date().toISOString() })
      .eq('id', conversationId)
    if (stateErr) {
      // Not fatal: the quote exists and the customer has it. But the thread
      // has forgotten it, so the next reply restarts — worth an alert.
      console.error('[quote-request] roofing_state not persisted', stateErr.message)
    }

    const routing = (dispatched.quote as { routing?: { decision?: string } } | null)?.routing?.decision
    return {
      ok: true,
      quoteToken: dispatched.token,
      inspection: routing === 'inspection_required',
      texted: true,
    }
  }

  // electrical / plumbing — the transcript-driven pipeline. The form answers
  // were written onto the thread above; this fires the identical hand-off the
  // SMS gather fires on `finish`.
  if (!lead.conversation_id) {
    return { ok: false, reason: `${data.trade} needs the SMS thread it was offered from` }
  }

  const jobType = intakeJobTypeHint(data)
  if (jobType) {
    // Grounds the structurer in the right trade's vocabulary
    // (deriveTradeFromJobType). Merged, never clobbering the slots the
    // dialog already filled.
    const state = (conv?.conversation_state ?? {}) as { slots?: Record<string, unknown> }
    const { error } = await supabase
      .from('sms_conversations')
      .update({
        conversation_state: { ...state, slots: { ...(state.slots ?? {}), job_type: jobType } },
        updated_at: new Date().toISOString(),
      })
      .eq('id', lead.conversation_id)
    if (error) return { ok: false, reason: `job_type hint not stored: ${error.message}` }
  }

  const res = await fetch(`${APP_BASE_URL}/api/intake/structure`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      // Internal self-call — isCronAuthorised is the only gate on this route.
      Authorization: `Bearer ${process.env.CRON_SECRET}`,
    },
    body: JSON.stringify({ conversationId: lead.conversation_id, sourceChannel: 'sms' }),
  })
  if (!res.ok) {
    return { ok: false, reason: `intake/structure HTTP ${res.status}: ${(await res.text()).slice(0, 200)}` }
  }
  // The pipeline owns the customer's quote SMS from here.
  return { ok: true, quoteToken: null, inspection: false }
}
