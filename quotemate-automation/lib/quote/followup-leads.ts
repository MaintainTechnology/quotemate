// ════════════════════════════════════════════════════════════════════
// No-quote SMS lead selector (Follow-ups completeness).
//
// The quote-based queue (lib/quote/followup.ts) only sees people who
// already have a drafted quote. But a customer who texts in and never
// gets a quote — the dialog stalled, dropped off, or escalated without a
// draft — is exactly who a VA should also chase. Those live only in
// `sms_conversations`. This selector turns such conversations into
// follow-up rows so the Follow-ups tab lists EVERYTHING, including SMS
// leads that never produced a quote.
//
// A conversation is an open lead when ALL hold:
//   1. It's a customer thread — conversation_type is NOT
//      'tradie_registration' (customer_quote, or legacy NULL, qualify).
//   2. It never produced a quote — its intake_id is not among the
//      tenant's quoted intakes (a conversation whose intake has a quote
//      is already represented by the quote queue).
//   3. Its phone isn't already surfaced in the quote queue — dedupe so
//      one person is never both a quote-followup AND a lead.
//   4. It has a parseable last activity at least `minAgeHours` old.
//
// Pure + DB-free (mirrors followup.ts) so it is fully unit tested. The
// API route feeds `sms_conversations` rows + the two exclusion sets in.
// ════════════════════════════════════════════════════════════════════

import { normaliseAuMobile } from '@/lib/phone/au'
import { ageHoursSince } from './followup'

/** The slice of an sms_conversations row this selector needs. */
export type LeadConversation = {
  id: string
  from_number?: string | null
  conversation_type?: string | null
  intake_id?: string | null
  status?: string | null
  created_at?: string | null
  last_message_at?: string | null
  conversation_state?: { slots?: Record<string, unknown> | null } | null
}

/** A lead follow-up row — the conversation-shaped analogue of the
 *  quote follow-up item. No quote_id/total/tier — there is no quote. */
export type LeadFollowup = {
  conversation_id: string
  phone: string | null
  first_name: string | null
  job_type: string | null
  suburb: string | null
  last_activity: string | null
  age_hours: number | null
}

export type LeadSelectOptions = {
  now: number
  /** Staleness gate in hours. Default 0 — surface everything current. */
  minAgeHours?: number
  /** intake_ids that already have a quote → those conversations belong
   *  to the quote queue, not the lead queue. */
  quotedIntakeIds?: ReadonlySet<string>
  /** Normalised (E.164) phones already in the quote queue → dedupe so a
   *  person is never listed twice. */
  excludePhones?: ReadonlySet<string>
}

function slotStr(
  slots: Record<string, unknown> | null | undefined,
  key: string,
): string | null {
  const v = slots?.[key]
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

/** Most recent meaningful activity on a conversation. */
export function leadLastActivity(c: LeadConversation): string | null {
  return c.last_message_at ?? c.created_at ?? null
}

/** Is this SMS conversation an open lead the VA should chase? */
export function isLeadFollowup(
  c: LeadConversation,
  opts: LeadSelectOptions,
): boolean {
  if (c.conversation_type === 'tradie_registration') return false
  if (c.intake_id && opts.quotedIntakeIds?.has(c.intake_id)) return false
  const e164 = normaliseAuMobile(c.from_number)
  if (e164 && opts.excludePhones?.has(e164)) return false
  const minAgeHours = opts.minAgeHours ?? 0
  const age = ageHoursSince(leadLastActivity(c), opts.now)
  if (age === null) return false
  return age >= minAgeHours
}

/** Project a conversation into a lead follow-up row. */
export function toLeadFollowup(c: LeadConversation, now: number): LeadFollowup {
  const slots = c.conversation_state?.slots ?? null
  const last = leadLastActivity(c)
  const age = ageHoursSince(last, now)
  return {
    conversation_id: c.id,
    phone: normaliseAuMobile(c.from_number) ?? c.from_number?.trim() ?? null,
    first_name: slotStr(slots, 'first_name'),
    job_type: slotStr(slots, 'job_type'),
    suburb: slotStr(slots, 'suburb'),
    last_activity: last,
    age_hours: age === null ? null : Math.floor(age),
  }
}

function activityMs(c: LeadConversation): number {
  const t = Date.parse(leadLastActivity(c) ?? '')
  return Number.isFinite(t) ? t : Number.NEGATIVE_INFINITY
}

/** Filter conversations to the open-lead queue, one row per customer
 *  (deduped by phone, keeping the most-recently-active thread), oldest
 *  activity first — same "work the most overdue first" order as quotes. */
export function selectLeadFollowups(
  convos: readonly LeadConversation[],
  opts: LeadSelectOptions,
): LeadFollowup[] {
  // Collapse multiple no-quote threads from the same number into one row.
  const chosen = new Map<string, LeadConversation>()
  for (const c of convos) {
    if (!isLeadFollowup(c, opts)) continue
    const e164 = normaliseAuMobile(c.from_number)
    const key = e164 ?? c.from_number?.trim() ?? `c:${c.id}`
    const prev = chosen.get(key)
    if (!prev || activityMs(c) > activityMs(prev)) chosen.set(key, c)
  }
  return [...chosen.values()]
    .map((c) => toLeadFollowup(c, opts.now))
    .sort((a, b) => {
      const ta = Date.parse(a.last_activity ?? '')
      const tb = Date.parse(b.last_activity ?? '')
      const va = Number.isFinite(ta) ? ta : Number.POSITIVE_INFINITY
      const vb = Number.isFinite(tb) ? tb : Number.POSITIVE_INFINITY
      return va - vb
    })
}
