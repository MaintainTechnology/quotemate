// ════════════════════════════════════════════════════════════════════
// 2-hour customer follow-up — pure decision module.
//
// One quote = one possible follow-up SMS. The cron sweep loads candidates
// via the partial index in migration 079, then calls shouldSendFollowup2h
// for each to make the final fire/skip call. Keeping the decision pure
// means every gate is unit-testable without Postgres/Twilio.
//
// Per-quote semantics (per feature brief): a single customer with 5
// quotes receives 5 separate check-ins — keyed by quote.id /
// followup_2h_sent_at. There is no per-customer dedupe.
//
// Fire window: 2h ≤ age < 24h after quote.sent_at. The lower bound is
// the requested check-in interval. The upper bound prevents reviving
// stale quotes (a forgotten Sunday quote shouldn't ping the customer
// on Wednesday afternoon — the cron's job is to nudge fresh leads, not
// resurrect dead ones).
// ════════════════════════════════════════════════════════════════════

/** Window the cron considers a quote 'ripe' for the auto check-in. */
export const FOLLOWUP_2H_MIN_AGE_MS = 2 * 60 * 60 * 1000   // 2h
export const FOLLOWUP_2H_MAX_AGE_MS = 24 * 60 * 60 * 1000  // 24h

export type Followup2hInput = {
  /** pricing_book.followup_2h_enabled for the quote's tenant. */
  enabledForTenant: boolean
  /** quotes.status — 'sent' or 'viewed' is fire-eligible. */
  quoteStatus: string | null
  /** quotes.sent_at — REQUIRED; null means quote never reached customer. */
  sentAt: string | null
  /** quotes.created_at — fallback for hard 24h ceiling. */
  quoteCreatedAt: string | null
  /** quotes.followup_2h_sent_at — non-null means already sent. */
  followup2hSentAt: string | null
  /** Most recent inbound SMS from this customer on the quote's thread,
   *  or null if no reply ever. If >= sentAt, the customer has replied
   *  and we don't nag. */
  lastCustomerInboundAt: string | null
  /** quotes.needs_inspection — inspection-route quotes skip auto-text. */
  needsInspection: boolean
  /** quotes.paid_at / accepted_at — terminal states skip. */
  paidAt: string | null
  acceptedAt: string | null
  /** Test seam — defaults to Date.now() in production. */
  currentTime?: number
}

export type Followup2hDecision =
  | { fire: true; reason: 'ripe' }
  | {
      fire: false
      reason:
        | 'disabled'
        | 'not_sent'
        | 'already_sent'
        | 'customer_replied'
        | 'inspection'
        | 'converted'
        | 'wrong_status'
        | 'too_young'
        | 'too_old'
    }

export function shouldSendFollowup2h(input: Followup2hInput): Followup2hDecision {
  const now = input.currentTime ?? Date.now()

  // Gate 1 — per-tenant toggle. Default OFF (per migration 079) so this
  //          is a positive opt-in by the tradie.
  if (!input.enabledForTenant) return { fire: false, reason: 'disabled' }

  // Gate 2 — quote must have actually been delivered.
  if (!input.sentAt) return { fire: false, reason: 'not_sent' }

  // Gate 3 — idempotency. We only ever send ONE auto check-in per quote.
  if (input.followup2hSentAt) return { fire: false, reason: 'already_sent' }

  // Gate 4 — inspection quotes use the $99 paid-inspection flow; auto-
  //          texting them would muddle that ask.
  if (input.needsInspection) return { fire: false, reason: 'inspection' }

  // Gate 5 — terminal states (customer already converted or booked).
  if (input.paidAt || input.acceptedAt) return { fire: false, reason: 'converted' }
  if (
    input.quoteStatus === 'paid' ||
    input.quoteStatus === 'accepted' ||
    input.quoteStatus === 'booked' ||
    input.quoteStatus === 'cancelled'
  ) {
    return { fire: false, reason: 'converted' }
  }

  // Gate 6 — only auto-text on 'sent' or 'viewed'. Anything else (draft,
  //          awaiting_tradie_approval, etc.) is not customer-facing yet.
  if (input.quoteStatus !== 'sent' && input.quoteStatus !== 'viewed') {
    return { fire: false, reason: 'wrong_status' }
  }

  // Gate 7 — customer has already replied since the quote was sent.
  //          Compare inbound timestamp to sentAt (not now()), so any
  //          reply after delivery counts even if it predated the 2h mark.
  const sentMs = Date.parse(input.sentAt)
  if (!Number.isFinite(sentMs)) return { fire: false, reason: 'not_sent' }
  if (input.lastCustomerInboundAt) {
    const inboundMs = Date.parse(input.lastCustomerInboundAt)
    if (Number.isFinite(inboundMs) && inboundMs >= sentMs) {
      return { fire: false, reason: 'customer_replied' }
    }
  }

  // Gate 8 — age window. Floor uses sentAt (the precise delivery moment).
  //          Ceiling is exclusive — at exactly 24h the quote rolls off.
  const ageMs = now - sentMs
  if (ageMs < FOLLOWUP_2H_MIN_AGE_MS) return { fire: false, reason: 'too_young' }
  if (ageMs >= FOLLOWUP_2H_MAX_AGE_MS) return { fire: false, reason: 'too_old' }

  return { fire: true, reason: 'ripe' }
}
