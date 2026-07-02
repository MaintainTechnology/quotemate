// ════════════════════════════════════════════════════════════════════
// Migrations 079 + 159 — 2-hour customer follow-up check-in cron sweep.
//
// TWO sweeps run per tick, in order:
//
//   1. QUOTE sweep (migration 079) — delivered quotes ('sent'/'viewed',
//      sent_at 2h..24h ago) the customer hasn't replied to. One SMS per
//      quote, ever (quotes.followup_2h_sent_at).
//
//   2. CONVERSATION sweep (migration 159) — open customer threads where
//      the SMS receptionist spoke LAST (asked a question, sent a link…)
//      and the customer has been silent 2h..24h. Covers the stage BEFORE
//      a quote exists — any trade: electrical/plumbing dialog, roofing,
//      painting, solar. One SMS per conversation, ever
//      (sms_conversations.followup_2h_sent_at). Threads whose intake has
//      a delivered quote are skipped ('quote_covered') — those belong to
//      sweep 1. A shared per-tick recipient set guarantees no customer
//      gets two check-ins in the same tick.
//
// Fire gates live in pure modules (unit-tested without Postgres/Twilio):
//   lib/quote/followup-2h.ts            — quote-level gates
//   lib/sms/conversation-followup-2h.ts — conversation-level gates
//
// SCHEDULING — NOT IN vercel.json
// --------------------------------
// Vercel Hobby caps native cron at once per day; the feature needs
// ~15-min granularity. The live trigger is a cron-job.org job (created
// by scripts/setup-cron-job-org.mjs) that GETs this URL every 15 min
// with Authorization: Bearer ${CRON_SECRET}. Alternatives if that ever
// lapses: GitHub Actions cron, or Vercel Pro native cron.
//
// Auth mirrors /api/cron/sms-cleanup exactly — Bearer ${CRON_SECRET}
// required in production, optional in dev for local manual testing.
//
// Idempotency belts (two of them per sweep, deliberately):
//   1. Partial indexes (079/159) + IS NULL select clauses — candidate
//      lists exclude anything we've already sent.
//   2. UPDATE ... WHERE followup_2h_sent_at IS NULL — even if two cron
//      pods see the same candidate row, only one's UPDATE will set the
//      stamp; the other becomes a no-op (rowcount 0).
// ════════════════════════════════════════════════════════════════════
import { createClient } from '@supabase/supabase-js'
import { shouldSendFollowup2h } from '@/lib/quote/followup-2h'
import { shouldSendConversationFollowup2h } from '@/lib/sms/conversation-followup-2h'
import { resolveFollowupTarget } from '@/lib/quote/followup-contact'
import { dispatchQuoteMessage } from '@/lib/sms/dispatch'
import { normaliseAuMobile } from '@/lib/phone/au'
import { buildConversationFollowup2hSms, buildFollowup2hSms } from '@/lib/sms/templates'

export const dynamic = 'force-dynamic'
// Two sweeps of sequential Twilio dispatches can exceed the default
// timeout on a busy tick — same ceiling as the other dispatching routes.
export const maxDuration = 300

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

const LOG_TAG = '[cron/followup-2h]'

function isAuthorised(req: Request): boolean {
  const expected = process.env.CRON_SECRET
  if (process.env.NODE_ENV === 'production') {
    if (!expected) return false
    const got = req.headers.get('authorization')
    return got === `Bearer ${expected}`
  }
  const got = req.headers.get('authorization')
  if (got && expected) return got === `Bearer ${expected}`
  return true
}

type SkipReason =
  // shared / quote-sweep reasons (lib/quote/followup-2h.ts)
  | 'disabled'
  | 'not_sent'
  | 'already_sent'
  | 'customer_replied'
  | 'inspection'
  | 'converted'
  | 'wrong_status'
  | 'too_young'
  | 'too_old'
  // conversation-sweep reasons (lib/sms/conversation-followup-2h.ts)
  | 'wrong_type'
  | 'not_open'
  | 'quote_covered'
  | 'no_messages'
  | 'customer_engaged'
  | 'texted_this_tick'
  // route-level (I/O) reasons
  | 'no_phone'
  | 'bad_phone'
  | 'tenant_unprovisioned'
  | 'dispatch_failed'
  | 'no_tenant'
  | 'row_error'

type Skipped = Partial<Record<SkipReason, number>>

type SweepResult = {
  scanned: number
  sent: number
  skipped: Skipped
  error?: string
}

type TenantRow = { id: string; business_name: string | null; twilio_sms_number: string | null }

// ─── Shared: batch-load tenant config + the per-tenant enable flag ──
//
// followup_2h_enabled is identical across a tenant's pricing_book rows
// post fan-out by /api/tenant/me PATCH, so any row wins. We OR across
// rows defensively just in case a per-trade write ever sets one row
// without the others. The single toggle gates BOTH sweeps.
async function loadTenantMaps(tenantIds: string[]): Promise<{
  tenantById: Map<string, TenantRow>
  enabledByTenant: Map<string, boolean>
  error?: string
}> {
  const ids = tenantIds.length > 0 ? tenantIds : ['__never__']
  const [tenantsRes, booksRes] = await Promise.all([
    supabase.from('tenants').select('id, business_name, twilio_sms_number').in('id', ids),
    supabase.from('pricing_book').select('tenant_id, followup_2h_enabled').in('tenant_id', ids),
  ])

  const tenantById = new Map<string, TenantRow>()
  const enabledByTenant = new Map<string, boolean>()

  if (tenantsRes.error) {
    console.error(LOG_TAG, 'tenant load failed', tenantsRes.error)
    return { tenantById, enabledByTenant, error: tenantsRes.error.message }
  }
  if (booksRes.error) {
    console.error(LOG_TAG, 'pricing_book load failed', booksRes.error)
    return { tenantById, enabledByTenant, error: booksRes.error.message }
  }

  for (const t of tenantsRes.data ?? []) {
    tenantById.set(t.id as string, t as TenantRow)
  }
  for (const b of booksRes.data ?? []) {
    const tid = b.tenant_id as string
    const prev = enabledByTenant.get(tid) ?? false
    enabledByTenant.set(tid, prev || Boolean(b.followup_2h_enabled))
  }
  return { tenantById, enabledByTenant }
}

// ─── Sweep 1 — delivered quotes (migration 079) ─────────────────────
async function sweepQuotes(
  nowMs: number,
  floorIso: string,
  ceilingIso: string,
  textedThisTick: Set<string>,
): Promise<SweepResult> {
  const skipped: Skipped = {}
  const bump = (reason: SkipReason) => {
    skipped[reason] = (skipped[reason] ?? 0) + 1
  }

  // Candidate scan — bounds the IN-list to status 'sent'/'viewed' + the
  // 2h..24h window so the partial index in migration 079 is the
  // planner's hot path. 200-row cap is a safety bound — at 15-min
  // cadence + a 22h-wide fire window, real load is tens of quotes/tick.
  const { data: candidates, error: scanErr } = await supabase
    .from('quotes')
    .select(
      'id, tenant_id, intake_id, status, sent_at, created_at, followup_2h_sent_at, needs_inspection, paid_at, accepted_at',
    )
    .is('followup_2h_sent_at', null)
    .in('status', ['sent', 'viewed'])
    .not('sent_at', 'is', null)
    .is('paid_at', null)
    .is('accepted_at', null)
    .is('needs_inspection', false)
    .gte('sent_at', floorIso)
    .lte('sent_at', ceilingIso)
    .order('sent_at', { ascending: true })
    .limit(200)

  if (scanErr) {
    console.error(LOG_TAG, 'quote candidate scan failed', scanErr)
    return { scanned: 0, sent: 0, skipped, error: scanErr.message }
  }

  const rows = candidates ?? []
  if (rows.length === 0) {
    return { scanned: 0, sent: 0, skipped }
  }

  const tenantIds = Array.from(new Set(rows.map((r) => r.tenant_id as string).filter(Boolean)))
  const { tenantById, enabledByTenant, error: tenantErr } = await loadTenantMaps(tenantIds)
  if (tenantErr) {
    return { scanned: rows.length, sent: 0, skipped, error: tenantErr }
  }

  // Batch-load last-inbound timestamp per conversation.
  // Convo lookup chain: intake_id → sms_conversations.id → newest inbound
  // sms_messages.created_at. Two SQL round-trips for the whole sweep,
  // not per-row.
  const intakeIds = Array.from(
    new Set(rows.map((r) => r.intake_id as string | null).filter((x): x is string => !!x)),
  )
  const latestInboundByIntake: Record<string, string> = {}
  if (intakeIds.length > 0) {
    const { data: convos, error: convoErr } = await supabase
      .from('sms_conversations')
      .select('id, intake_id')
      .in('intake_id', intakeIds)
    if (convoErr) {
      console.error(LOG_TAG, 'sms_conversations load failed', convoErr)
    } else {
      const convoToIntake: Record<string, string> = {}
      const convoIds: string[] = []
      for (const c of convos ?? []) {
        if (c.id && c.intake_id) {
          convoToIntake[c.id as string] = c.intake_id as string
          convoIds.push(c.id as string)
        }
      }
      if (convoIds.length > 0) {
        const { data: inbounds, error: msgErr } = await supabase
          .from('sms_messages')
          .select('conversation_id, created_at')
          .in('conversation_id', convoIds)
          .eq('direction', 'inbound')
          .order('created_at', { ascending: false })
        if (msgErr) {
          console.error(LOG_TAG, 'sms_messages load failed', msgErr)
        } else {
          for (const m of inbounds ?? []) {
            const intakeId = convoToIntake[m.conversation_id as string]
            if (!intakeId) continue
            // First time we see this intake → newest message (rows are
            // already ordered desc); subsequent rows are ignored.
            if (!latestInboundByIntake[intakeId]) {
              latestInboundByIntake[intakeId] = m.created_at as string
            }
          }
        }
      }
    }
  }

  // Per-candidate evaluation + dispatch.
  let sent = 0
  for (const q of rows) {
    const quoteId = q.id as string
    const tenantId = q.tenant_id as string | null
    if (!tenantId) {
      bump('no_tenant')
      continue
    }
    const tenant = tenantById.get(tenantId)
    if (!tenant) {
      bump('no_tenant')
      continue
    }

    try {
      const intakeId = (q.intake_id as string | null) ?? null
      const lastInbound = intakeId ? latestInboundByIntake[intakeId] ?? null : null

      // Pure decision — every gate is unit-tested in followup-2h.test.ts.
      const decision = shouldSendFollowup2h({
        enabledForTenant: enabledByTenant.get(tenantId) ?? false,
        quoteStatus: (q.status as string | null) ?? null,
        sentAt: (q.sent_at as string | null) ?? null,
        quoteCreatedAt: (q.created_at as string | null) ?? null,
        followup2hSentAt: (q.followup_2h_sent_at as string | null) ?? null,
        lastCustomerInboundAt: lastInbound,
        needsInspection: Boolean(q.needs_inspection),
        paidAt: (q.paid_at as string | null) ?? null,
        acceptedAt: (q.accepted_at as string | null) ?? null,
        currentTime: nowMs,
      })

      if (!decision.fire) {
        bump(decision.reason)
        continue
      }

      // Defensive — toggle shouldn't have been enableable for an
      // unprovisioned tenant, but never spend a Twilio API call on a
      // null `from` number.
      if (!tenant.twilio_sms_number) {
        console.warn(LOG_TAG, 'tenant has no twilio_sms_number; skipping', {
          quoteId,
          tenantId,
        })
        bump('tenant_unprovisioned')
        continue
      }

      // Resolve destination + name SERVER-SIDE from the quote/intake
      // chain (never trust client input — there is no client here, but
      // we reuse the same helper as the dashboard text route for
      // consistency and the ownership guard built into it).
      const target = await resolveFollowupTarget(supabase, quoteId, tenantId)
      if (!target.ok) {
        bump('no_phone')
        continue
      }
      if (!target.phone) {
        bump('no_phone')
        continue
      }

      const toE164 = normaliseAuMobile(target.phone)
      if (!toE164) {
        console.warn(LOG_TAG, 'destination phone failed AU mobile parse', {
          quoteId,
          phone: target.phone,
        })
        bump('bad_phone')
        continue
      }

      const firstName = (target.name ?? '').split(' ')[0] || 'there'
      const body = buildFollowup2hSms({
        firstName,
        businessName: tenant.business_name,
      })

      const result = await dispatchQuoteMessage({
        to: toE164,
        text: body,
        from: tenant.twilio_sms_number,
      })

      if (!result.ok) {
        console.error(LOG_TAG, 'dispatch failed', {
          quoteId,
          smsCode: result.smsAttempt?.code,
          waCode: result.waAttempt?.code,
        })
        bump('dispatch_failed')
        continue
      }

      // ── Stamp idempotency marker. WHERE-IS-NULL guards against two
      //    cron pods double-sending on the same row (the second sees the
      //    column already stamped and the UPDATE matches 0 rows). ──
      const stampIso = new Date().toISOString()
      const { error: stampErr } = await supabase
        .from('quotes')
        .update({ followup_2h_sent_at: stampIso })
        .eq('id', quoteId)
        .is('followup_2h_sent_at', null)
      if (stampErr) {
        console.error(LOG_TAG, 'idempotency stamp failed (SMS already sent)', {
          quoteId,
          err: stampErr.message,
        })
        // SMS already went out — don't double-count as a skip; just log.
      }

      sent++
      // The conversation sweep must not text this customer again this tick.
      textedThisTick.add(`${tenantId}:${toE164}`)

      // ── Best-effort: log into the customer's SMS thread so a reply
      //    re-engages the AI dialog. Wrap in try/catch — never poison
      //    the sweep on a logging hiccup. ──
      try {
        const { data: prior } = await supabase
          .from('sms_conversations')
          .select('id')
          .eq('from_number', toE164)
          .eq('tenant_id', tenantId)
          .order('last_message_at', { ascending: false, nullsFirst: false })
          .limit(1)
          .maybeSingle()
        let conversationId = prior?.id as string | undefined
        if (conversationId) {
          await supabase
            .from('sms_conversations')
            .update({
              status: 'open',
              last_message_at: stampIso,
              updated_at: stampIso,
            })
            .eq('id', conversationId)
        } else {
          const { data: created } = await supabase
            .from('sms_conversations')
            .insert({
              from_number: toE164,
              to_number: tenant.twilio_sms_number,
              tenant_id: tenantId,
              conversation_type: 'customer_quote',
              status: 'open',
              last_message_at: stampIso,
            })
            .select('id')
            .single()
          conversationId = created?.id as string | undefined
        }
        if (conversationId) {
          await supabase.from('sms_messages').insert({
            conversation_id: conversationId,
            direction: 'outbound',
            body,
            twilio_message_sid: result.sid,
          })
        }
      } catch (e) {
        console.error(LOG_TAG, 'thread-logging failed (SMS still sent)', e)
      }

      // ── Best-effort: CRM touch log in quote_followup_events. The
      //    outcome column has a CHECK constraint (migration 039) — only
      //    the listed values are accepted. 'auto_2h_checkin' is NOT in
      //    that set, so we reuse 'text_sent' (the canonical SMS outcome)
      //    and prefix the summary with '[auto-2h]' so the dashboard
      //    timeline can label it specially without a schema change. ──
      try {
        await supabase.from('quote_followup_events').insert({
          tenant_id: tenantId,
          quote_id: quoteId,
          kind: 'sms',
          outcome: 'text_sent',
          summary: `[auto-2h] ${body.slice(0, 120)}`,
        })
      } catch (e) {
        console.error(LOG_TAG, 'event log failed (SMS still sent)', e)
      }
    } catch (rowErr) {
      console.error(LOG_TAG, 'quote row failed', { quoteId, err: rowErr })
      bump('row_error')
      continue
    }
  }

  return { scanned: rows.length, sent, skipped }
}

// ─── Sweep 2 — stalled receptionist conversations (migration 159) ───
//
// The screenshot case this exists for: the receptionist asked "What do
// you need done?" and the customer never answered. No quote row exists,
// so sweep 1 can't see it. The unit here is the sms_conversations
// thread; the check-in invites the customer to resume the intake, and a
// reply flows straight back into the normal /api/sms/inbound dialog
// (conversation/roofing/painting state on the row is untouched).
async function sweepConversations(
  nowMs: number,
  floorIso: string,
  ceilingIso: string,
  textedThisTick: Set<string>,
): Promise<SweepResult> {
  const skipped: Skipped = {}
  const bump = (reason: SkipReason) => {
    skipped[reason] = (skipped[reason] ?? 0) + 1
  }

  // Candidate scan — mirrors the partial index in migration 159. The
  // idle window anchors on last_message_at; orphan legacy threads
  // (tenant_id null — pre-provisioning dev traffic) are excluded here
  // because there is no tenant to send as.
  const { data: candidates, error: scanErr } = await supabase
    .from('sms_conversations')
    .select(
      'id, tenant_id, intake_id, from_number, status, conversation_type, conversation_state, followup_2h_sent_at, last_message_at',
    )
    .is('followup_2h_sent_at', null)
    .eq('conversation_type', 'customer_quote')
    .eq('status', 'open')
    .not('tenant_id', 'is', null)
    .gte('last_message_at', floorIso)
    .lte('last_message_at', ceilingIso)
    .order('last_message_at', { ascending: true })
    .limit(200)

  if (scanErr) {
    console.error(LOG_TAG, 'conversation candidate scan failed', scanErr)
    return { scanned: 0, sent: 0, skipped, error: scanErr.message }
  }

  const rows = candidates ?? []
  if (rows.length === 0) {
    return { scanned: 0, sent: 0, skipped }
  }

  const tenantIds = Array.from(new Set(rows.map((r) => r.tenant_id as string).filter(Boolean)))
  const { tenantById, enabledByTenant, error: tenantErr } = await loadTenantMaps(tenantIds)
  if (tenantErr) {
    return { scanned: rows.length, sent: 0, skipped, error: tenantErr }
  }

  // Batch-load the NEWEST message per thread (direction decides whether
  // the customer or the receptionist spoke last). Rows arrive ordered
  // desc; the first row seen per conversation wins. The created_at floor
  // matches the candidate window — every candidate's newest message is
  // ≥ floorIso by construction (last_message_at ≥ floorIso), and the
  // bound keeps the result set safely under supabase-js's row cap even
  // if the 200 threads carry long histories. A thread that somehow has
  // no message in-window resolves to direction null → 'no_messages'
  // skip (safe: we never text on missing evidence).
  const convoIds = rows.map((r) => r.id as string)
  const lastMessageByConvo: Record<string, { direction: string; created_at: string }> = {}
  {
    const { data: msgs, error: msgErr } = await supabase
      .from('sms_messages')
      .select('conversation_id, direction, created_at')
      .in('conversation_id', convoIds)
      .gte('created_at', floorIso)
      .order('created_at', { ascending: false })
    if (msgErr) {
      console.error(LOG_TAG, 'conversation sms_messages load failed', msgErr)
      return { scanned: rows.length, sent: 0, skipped, error: msgErr.message }
    }
    for (const m of msgs ?? []) {
      const cid = m.conversation_id as string
      if (!lastMessageByConvo[cid]) {
        lastMessageByConvo[cid] = {
          direction: m.direction as string,
          created_at: m.created_at as string,
        }
      }
    }
  }

  // Batch-load which intakes already have a DELIVERED quote — those
  // threads belong to sweep 1 ('quote_covered').
  const intakeIds = Array.from(
    new Set(rows.map((r) => r.intake_id as string | null).filter((x): x is string => !!x)),
  )
  const deliveredQuoteIntakes = new Set<string>()
  if (intakeIds.length > 0) {
    const { data: quoteRows, error: quoteErr } = await supabase
      .from('quotes')
      .select('intake_id')
      .in('intake_id', intakeIds)
      .not('sent_at', 'is', null)
    if (quoteErr) {
      // Non-fatal — worst case we treat threads as not-quote-covered and
      // the per-tick recipient set still prevents double-texting.
      console.error(LOG_TAG, 'delivered-quote lookup failed', quoteErr)
    } else {
      for (const qr of quoteRows ?? []) {
        if (qr.intake_id) deliveredQuoteIntakes.add(qr.intake_id as string)
      }
    }
  }

  // Per-candidate evaluation + dispatch.
  let sent = 0
  for (const c of rows) {
    const conversationId = c.id as string
    const tenantId = c.tenant_id as string
    const tenant = tenantById.get(tenantId)
    if (!tenant) {
      bump('no_tenant')
      continue
    }

    try {
      const last = lastMessageByConvo[conversationId] ?? null
      const intakeId = (c.intake_id as string | null) ?? null
      const direction =
        last?.direction === 'inbound' || last?.direction === 'outbound'
          ? last.direction
          : null

      // Pure decision — every gate is unit-tested in
      // conversation-followup-2h.test.ts.
      const decision = shouldSendConversationFollowup2h({
        enabledForTenant: enabledByTenant.get(tenantId) ?? false,
        conversationType: (c.conversation_type as string | null) ?? null,
        conversationStatus: (c.status as string | null) ?? null,
        followup2hSentAt: (c.followup_2h_sent_at as string | null) ?? null,
        lastMessageAt: (c.last_message_at as string | null) ?? null,
        lastMessageDirection: direction,
        hasDeliveredQuote: intakeId ? deliveredQuoteIntakes.has(intakeId) : false,
        currentTime: nowMs,
      })

      if (!decision.fire) {
        bump(decision.reason)
        continue
      }

      if (!tenant.twilio_sms_number) {
        console.warn(LOG_TAG, 'tenant has no twilio_sms_number; skipping thread', {
          conversationId,
          tenantId,
        })
        bump('tenant_unprovisioned')
        continue
      }

      const toE164 = normaliseAuMobile((c.from_number as string | null) ?? '')
      if (!toE164) {
        console.warn(LOG_TAG, 'thread from_number failed AU mobile parse', {
          conversationId,
        })
        bump('bad_phone')
        continue
      }

      // Never text the same customer twice in one tick (sweep 1 may have
      // just sent a quote-level check-in, or the customer may have two
      // open threads).
      if (textedThisTick.has(`${tenantId}:${toE164}`)) {
        bump('texted_this_tick')
        continue
      }

      // First name, when the dialog extracted one (conversation_state is
      // {slots, sources, ...} per migration 012). Roofing/painting flows
      // don't gather names — the template falls back to 'there'.
      const state = c.conversation_state as {
        slots?: { first_name?: string | null } | null
      } | null
      const firstName = state?.slots?.first_name ?? null

      const body = buildConversationFollowup2hSms({
        firstName,
        businessName: tenant.business_name,
      })

      const result = await dispatchQuoteMessage({
        to: toE164,
        text: body,
        from: tenant.twilio_sms_number,
      })

      if (!result.ok) {
        console.error(LOG_TAG, 'conversation dispatch failed', {
          conversationId,
          smsCode: result.smsAttempt?.code,
          waCode: result.waAttempt?.code,
        })
        bump('dispatch_failed')
        continue
      }

      // ── Stamp idempotency marker (same WHERE-IS-NULL belt as sweep 1)
      //    and bump the thread's clock so the dashboard chat list
      //    surfaces the check-in. Status stays 'open' — a reply flows
      //    straight back into the normal inbound dialog. ──
      const stampIso = new Date().toISOString()
      const { error: stampErr } = await supabase
        .from('sms_conversations')
        .update({
          followup_2h_sent_at: stampIso,
          last_message_at: stampIso,
          updated_at: stampIso,
        })
        .eq('id', conversationId)
        .is('followup_2h_sent_at', null)
      if (stampErr) {
        console.error(LOG_TAG, 'conversation stamp failed (SMS already sent)', {
          conversationId,
          err: stampErr.message,
        })
      }

      sent++
      textedThisTick.add(`${tenantId}:${toE164}`)

      // ── Best-effort: log the check-in into the thread itself. ──
      try {
        await supabase.from('sms_messages').insert({
          conversation_id: conversationId,
          direction: 'outbound',
          body,
          twilio_message_sid: result.sid,
        })
      } catch (e) {
        console.error(LOG_TAG, 'conversation thread-logging failed (SMS still sent)', e)
      }
    } catch (rowErr) {
      console.error(LOG_TAG, 'conversation row failed', { conversationId, err: rowErr })
      bump('row_error')
      continue
    }
  }

  return { scanned: rows.length, sent, skipped }
}

export async function GET(req: Request) {
  if (!isAuthorised(req)) {
    return Response.json({ ok: false, error: 'unauthorised' }, { status: 401 })
  }

  const startedAt = Date.now()
  const nowMs = startedAt
  const floorIso = new Date(nowMs - 24 * 60 * 60 * 1000).toISOString()
  const ceilingIso = new Date(nowMs - 2 * 60 * 60 * 1000).toISOString()

  // Shared per-tick recipient set (`${tenantId}:${toE164}`) — the belt
  // that guarantees one customer never receives two check-ins in a tick.
  const textedThisTick = new Set<string>()

  const quotes = await sweepQuotes(nowMs, floorIso, ceilingIso, textedThisTick)
  const conversations = await sweepConversations(nowMs, floorIso, ceilingIso, textedThisTick)

  const durationMs = Date.now() - startedAt
  console.log(LOG_TAG, 'sweep complete', {
    window: { from: floorIso, to: ceilingIso },
    quotes,
    conversations,
    durationMs,
  })

  // A fatal scan/config error in either sweep → 500 so the external cron
  // dashboard (cron-job.org) flags the tick and someone looks at logs.
  const fatal = quotes.error ?? conversations.error ?? null
  return Response.json(
    { ok: !fatal, quotes, conversations, durationMs, ...(fatal ? { error: fatal } : {}) },
    fatal ? { status: 500 } : undefined,
  )
}
