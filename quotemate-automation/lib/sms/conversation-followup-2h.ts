// ════════════════════════════════════════════════════════════════════
// 2-hour CONVERSATION follow-up — pure decision module (migration 159).
//
// Companion to lib/quote/followup-2h.ts (migration 079). That module
// covers quotes that were DELIVERED and then ignored; this one covers
// the stage before a quote exists at all: the SMS receptionist asked
// the customer a question mid-intake and the customer went quiet. It is
// trade-agnostic by construction — the unit is the sms_conversations
// thread, so electrical/plumbing dialog, roofing, painting and solar
// receptionist flows are all covered by the same gate.
//
// One conversation = at most ONE auto check-in, ever — keyed by
// sms_conversations.followup_2h_sent_at. The cron sweep
// (/api/cron/followup-2h) loads candidate threads via the partial index
// in migration 159, then calls shouldSendConversationFollowup2h for the
// final fire/skip call. Keeping the decision pure means every gate is
// unit-testable without Postgres/Twilio.
//
// Fire window: 2h ≤ idle < 24h after the LAST message on the thread.
// Same bounds and rationale as the quote module: nudge fresh leads,
// never resurrect dead threads. The sms-cleanup cron flips threads idle
// 24h+ to 'abandoned', so the <24h ceiling also matches the thread
// lifecycle.
// ════════════════════════════════════════════════════════════════════

import {
  FOLLOWUP_2H_MIN_AGE_MS,
  FOLLOWUP_2H_MAX_AGE_MS,
} from '../quote/followup-2h'

export type ConversationFollowup2hInput = {
  /** pricing_book.followup_2h_enabled for the thread's tenant (ORed
   *  across the tenant's rows — same toggle as the quote sweep). */
  enabledForTenant: boolean
  /** sms_conversations.conversation_type — only 'customer_quote'
   *  threads are nudged; tradie_registration/converted are onboarding. */
  conversationType: string | null
  /** sms_conversations.status — only 'open' threads are nudged.
   *  'done' = flow finished or cancelled, 'abandoned' = cleanup cron,
   *  'structuring' = the AI is mid-handoff and owes the next message. */
  conversationStatus: string | null
  /** sms_conversations.followup_2h_sent_at — non-null means already sent. */
  followup2hSentAt: string | null
  /** sms_conversations.last_message_at — anchors the 2h..24h idle window. */
  lastMessageAt: string | null
  /** Direction of the NEWEST sms_messages row on the thread. 'outbound'
   *  means the receptionist spoke last and the customer went quiet —
   *  the only state we nudge. 'inbound' means the ball is in OUR court
   *  (nudging would be nagging someone who already answered). */
  lastMessageDirection: 'inbound' | 'outbound' | null
  /** True when the thread's intake already has a quote with sent_at set.
   *  Delivered quotes are the QUOTE sweep's domain — skipping here is
   *  what prevents the same customer getting two check-ins. */
  hasDeliveredQuote: boolean
  /** Test seam — defaults to Date.now() in production. */
  currentTime?: number
}

export type ConversationFollowup2hDecision =
  | { fire: true; reason: 'ripe' }
  | {
      fire: false
      reason:
        | 'disabled'
        | 'wrong_type'
        | 'not_open'
        | 'already_sent'
        | 'quote_covered'
        | 'no_messages'
        | 'customer_engaged'
        | 'too_young'
        | 'too_old'
    }

export function shouldSendConversationFollowup2h(
  input: ConversationFollowup2hInput,
): ConversationFollowup2hDecision {
  const now = input.currentTime ?? Date.now()

  // Gate 1 — per-tenant toggle. Same positive opt-in as the quote sweep
  //          (pricing_book.followup_2h_enabled, default OFF).
  if (!input.enabledForTenant) return { fire: false, reason: 'disabled' }

  // Gate 2 — customer threads only. tradie_registration / converted
  //          threads are onboarding flows, never check-in targets.
  if (input.conversationType !== 'customer_quote') {
    return { fire: false, reason: 'wrong_type' }
  }

  // Gate 3 — thread must still be live. A roofing cancel persists
  //          status 'done'; the cleanup cron stamps 'abandoned'; both
  //          (and mid-handoff 'structuring') skip.
  if (input.conversationStatus !== 'open') {
    return { fire: false, reason: 'not_open' }
  }

  // Gate 4 — idempotency. ONE auto check-in per conversation, ever.
  if (input.followup2hSentAt) return { fire: false, reason: 'already_sent' }

  // Gate 5 — a delivered quote on this thread belongs to the quote
  //          sweep (lib/quote/followup-2h.ts). Never double-text.
  if (input.hasDeliveredQuote) return { fire: false, reason: 'quote_covered' }

  // Gate 6 — need a real message trail to reason about.
  if (!input.lastMessageAt || !input.lastMessageDirection) {
    return { fire: false, reason: 'no_messages' }
  }
  const lastMs = Date.parse(input.lastMessageAt)
  if (!Number.isFinite(lastMs)) return { fire: false, reason: 'no_messages' }

  // Gate 7 — only nudge when the RECEPTIONIST spoke last. If the newest
  //          message is inbound the customer answered (or texted STOP)
  //          and the AI owes the reply — never check-in over the top.
  if (input.lastMessageDirection !== 'outbound') {
    return { fire: false, reason: 'customer_engaged' }
  }

  // Gate 8 — idle window. Floor is the requested check-in interval;
  //          ceiling is exclusive — at exactly 24h the thread rolls off.
  const ageMs = now - lastMs
  if (ageMs < FOLLOWUP_2H_MIN_AGE_MS) return { fire: false, reason: 'too_young' }
  if (ageMs >= FOLLOWUP_2H_MAX_AGE_MS) return { fire: false, reason: 'too_old' }

  return { fire: true, reason: 'ripe' }
}
