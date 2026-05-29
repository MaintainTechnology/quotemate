// ════════════════════════════════════════════════════════════════════
// Migration 079 — 2-hour customer follow-up check-in cron sweep.
//
// Runs every 15 minutes (see vercel.json). For each opted-in tenant,
// finds delivered quotes in the 2h..24h window that the customer hasn't
// replied to and hasn't already been auto-followed up on, and sends ONE
// friendly "just checking in" SMS per quote.
//
// Per the feature brief, the unit is the QUOTE not the customer: a
// single person with 5 quotes receives 5 separate check-ins. The fire
// gate lives in lib/quote/followup-2h.ts (pure module, 24 unit tests).
// This route is just the DB layer + dispatch + bookkeeping.
//
// Auth mirrors /api/cron/sms-cleanup exactly — Bearer ${CRON_SECRET}
// required in production, optional in dev for local manual testing.
//
// Idempotency belts (two of them, deliberately):
//   1. Partial index quotes_followup_2h_pending_idx + status filter +
//      followup_2h_sent_at IS NULL select clause — candidate list excludes
//      anything we've already sent.
//   2. UPDATE ... WHERE followup_2h_sent_at IS NULL — even if two cron
//      pods see the same candidate row, only one's UPDATE will set the
//      stamp; the other becomes a no-op (rowcount 0).
// ════════════════════════════════════════════════════════════════════
import { createClient } from '@supabase/supabase-js'
import { shouldSendFollowup2h } from '@/lib/quote/followup-2h'
import { resolveFollowupTarget } from '@/lib/quote/followup-contact'
import { dispatchQuoteMessage } from '@/lib/sms/dispatch'
import { normaliseAuMobile } from '@/lib/phone/au'
import { buildFollowup2hSms } from '@/lib/sms/templates'

export const dynamic = 'force-dynamic'

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
  | 'disabled'
  | 'not_sent'
  | 'already_sent'
  | 'customer_replied'
  | 'inspection'
  | 'converted'
  | 'wrong_status'
  | 'too_young'
  | 'too_old'
  | 'no_phone'
  | 'bad_phone'
  | 'tenant_unprovisioned'
  | 'dispatch_failed'
  | 'no_tenant'
  | 'row_error'

type Skipped = Partial<Record<SkipReason, number>>

export async function GET(req: Request) {
  if (!isAuthorised(req)) {
    return Response.json({ ok: false, error: 'unauthorised' }, { status: 401 })
  }

  const startedAt = Date.now()
  const skipped: Skipped = {}
  function bump(reason: SkipReason) {
    skipped[reason] = (skipped[reason] ?? 0) + 1
  }

  // ─── 1. Candidate scan ────────────────────────────────────────────
  //
  // Bounds the IN-list to status 'sent'/'viewed' + the 2h..24h window so
  // the partial index in migration 079 is the planner's hot path. 200-row
  // cap is a safety bound — at 15-min cadence + a 22h-wide fire window,
  // real load is tens of quotes per tick.
  const nowMs = Date.now()
  const floorIso = new Date(nowMs - 24 * 60 * 60 * 1000).toISOString()
  const ceilingIso = new Date(nowMs - 2 * 60 * 60 * 1000).toISOString()

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
    console.error(LOG_TAG, 'candidate scan failed', scanErr)
    return Response.json({ ok: false, error: scanErr.message }, { status: 500 })
  }

  const rows = candidates ?? []
  if (rows.length === 0) {
    console.log(LOG_TAG, 'no candidates', {
      window: { from: floorIso, to: ceilingIso },
    })
    return Response.json({
      ok: true,
      scanned: 0,
      sent: 0,
      skipped,
      durationMs: Date.now() - startedAt,
    })
  }

  // ─── 2. Batch-load tenant config + the per-tenant enable flag ─────
  //
  // followup_2h_enabled is identical across a tenant's pricing_book rows
  // post fan-out by /api/tenant/me PATCH, so any row wins. We OR across
  // rows defensively just in case a per-trade write ever sets one row
  // without the others.
  const tenantIds = Array.from(new Set(rows.map((r) => r.tenant_id as string).filter(Boolean)))
  const [tenantsRes, booksRes] = await Promise.all([
    supabase
      .from('tenants')
      .select('id, business_name, twilio_sms_number')
      .in('id', tenantIds.length > 0 ? tenantIds : ['__never__']),
    supabase
      .from('pricing_book')
      .select('tenant_id, followup_2h_enabled')
      .in('tenant_id', tenantIds.length > 0 ? tenantIds : ['__never__']),
  ])

  if (tenantsRes.error) {
    console.error(LOG_TAG, 'tenant load failed', tenantsRes.error)
    return Response.json({ ok: false, error: tenantsRes.error.message }, { status: 500 })
  }
  if (booksRes.error) {
    console.error(LOG_TAG, 'pricing_book load failed', booksRes.error)
    return Response.json({ ok: false, error: booksRes.error.message }, { status: 500 })
  }

  type TenantRow = { id: string; business_name: string | null; twilio_sms_number: string | null }
  const tenantById = new Map<string, TenantRow>()
  for (const t of tenantsRes.data ?? []) {
    tenantById.set(t.id as string, t as TenantRow)
  }

  const enabledByTenant = new Map<string, boolean>()
  for (const b of booksRes.data ?? []) {
    const tid = b.tenant_id as string
    const prev = enabledByTenant.get(tid) ?? false
    enabledByTenant.set(tid, prev || Boolean(b.followup_2h_enabled))
  }

  // ─── 3. Batch-load last-inbound timestamp per conversation ────────
  //
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

  // ─── 4. Per-candidate evaluation + dispatch ───────────────────────
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
      console.error(LOG_TAG, 'row failed', { quoteId, err: rowErr })
      bump('row_error')
      continue
    }
  }

  const durationMs = Date.now() - startedAt
  console.log(LOG_TAG, 'sweep complete', {
    scanned: rows.length,
    sent,
    skipped,
    durationMs,
  })

  return Response.json({
    ok: true,
    scanned: rows.length,
    sent,
    skipped,
    durationMs,
  })
}
