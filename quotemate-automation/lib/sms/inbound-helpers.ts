// Pure decision helpers extracted from app/api/sms/inbound/route.ts so the
// hardening logic added for R42 / R43 / R44 / R47 is unit-testable without the
// heavy supabase/twilio/next mocks the route itself needs.
//
// Everything here is PURE: no I/O, no imports from twilio/supabase/next. The
// route does the I/O (DB reads/writes, dispatch) and feeds the results into
// these functions to decide *what* to do. Retry/backoff + send-outcome logging
// + adaptive debounce live in lib/sms/send-reliability.ts (imported by the
// route directly); this module holds the inbound-specific decisions that don't
// belong in that shared module.
//
// Confirmed root causes (against the running route, 2026-06-18):
//   - R43: the `mode='new'` branch does a plain INSERT with no unique backstop,
//     so two concurrent first-messages for the same brand-new from_number each
//     create their OWN sms_conversations row, each wins its own per-row lock,
//     and BOTH run the dialog → duplicate replies (split-brain), not just an
//     "orphaned loser". The fix is an idempotent insert (ON CONFLICT DO NOTHING
//     on a partial unique index over ACTIVE customer_quote conversations) +
//     re-select the surviving row. `decideConversationUpsert` encodes which row
//     the route should adopt after the racy insert.
//   - R44: the route waited a FIXED 1500ms before reading history. A lone text
//     waits the full window; a fast burst can still trail past it. `arrival-
//     TimestampsFromTurns` extracts the timing signal adaptiveDebounceMs needs.
//   - R47: MessageSid dedup was an inline maybeSingle() + truthiness check. The
//     decision (skip-as-duplicate vs process) is pulled into `decideSidDedup`
//     and the post-insert 23505 handling into `classifyInboundInsert` so the
//     idempotency contract is tested and can't silently regress.

// ---------------------------------------------------------------------------
// R47 — MessageSid idempotency decision.
// ---------------------------------------------------------------------------

/** Minimal shape of an already-persisted inbound row we matched on the SID. */
export type ExistingInboundRow = {
  id: string
  conversation_id?: string | null
} | null | undefined

export type SidDedupDecision =
  | { action: 'process'; reason: 'no_sid' | 'no_existing_row' }
  | { action: 'skip_duplicate'; reason: 'sid_already_persisted'; existingId: string }

/**
 * Decide whether an inbound webhook is a Twilio retry we've already persisted.
 *
 * Twilio retries the webhook on timeout / fallback-URL config; a retry must NOT
 * persist a second inbound row, re-run the dialog, or re-fire the intake
 * handoff / photo SMS. We dedupe on MessageSid: if a row already exists for this
 * SID + direction='inbound', skip. A missing SID (extremely rare) falls through
 * to normal processing rather than failing closed (one stray message beats
 * silently dropping a real customer).
 *
 * Pure: the route does the DB lookup, then hands the (sid, existingRow) here.
 */
export function decideSidDedup(
  messageSid: string | null | undefined,
  existing: ExistingInboundRow,
): SidDedupDecision {
  if (!messageSid) return { action: 'process', reason: 'no_sid' }
  if (existing && existing.id) {
    return { action: 'skip_duplicate', reason: 'sid_already_persisted', existingId: existing.id }
  }
  return { action: 'process', reason: 'no_existing_row' }
}

/** Postgres unique_violation. The partial index from migration 004 fires this
 *  when two retries with the same SID land in the same millisecond (the racy
 *  window the application-layer decideSidDedup can't catch). */
export const PG_UNIQUE_VIOLATION = '23505'

export type InboundInsertOutcome =
  | { action: 'continue' }
  | { action: 'ack_duplicate'; reason: 'unique_sid_race' }
  | { action: 'db_error'; code: string | null }

/**
 * Classify the result of the inbound-row INSERT. A 23505 on the unique-SID
 * index means a concurrent retry beat us — ack as a duplicate (idempotent). Any
 * other error is a real DB failure (500). No error ⇒ continue.
 *
 * `insertError` is the supabase error object (or null); we only read `.code`.
 */
export function classifyInboundInsert(
  insertError: { code?: string | null } | null | undefined,
): InboundInsertOutcome {
  if (!insertError) return { action: 'continue' }
  if (insertError.code === PG_UNIQUE_VIOLATION) {
    return { action: 'ack_duplicate', reason: 'unique_sid_race' }
  }
  return { action: 'db_error', code: insertError.code ?? null }
}

/**
 * R47 belt-and-braces for the side-effecting steps (intake handoff + photo SMS).
 * Even past the inbound-row dedup, a duplicate-fired `after()` (two leaders in
 * the R43 race before the index existed, or a manual replay) must not double-run
 * the money path. The route already guards on `hasExistingIntake`; this folds
 * the inflight-continuation + already-drafted signals into a single tested
 * predicate so every side-effect call site agrees on exactly one rule.
 *
 * Returns true when the irreversible side effects (intake/structure POST, photo
 * link) are allowed to fire for this turn.
 */
export function sideEffectsAllowed(args: {
  /** dialog decided action === 'finish' */
  decisionIsFinish: boolean
  /** a quote/intake already exists on this conversation (fresh DB read OR snapshot) */
  hasExistingIntake: boolean
  /** a product choice is pending — the quote is intentionally held */
  wp9HoldingForChoice: boolean
  /** the customer texted while a previous quote is still drafting */
  inflightContinuation: boolean
}): boolean {
  return (
    args.decisionIsFinish &&
    !args.hasExistingIntake &&
    !args.wp9HoldingForChoice &&
    !args.inflightContinuation
  )
}

// ---------------------------------------------------------------------------
// R43 — idempotent first-message conversation create.
// ---------------------------------------------------------------------------

/** Minimal shape of a conversation row for the upsert decision. */
export type ConversationRowLike = {
  id: string
  status?: string | null
  created_at?: string | null
} | null | undefined

export type ConversationUpsertDecision =
  | { action: 'use_created'; id: string }
  | { action: 'use_existing'; id: string; reason: 'lost_insert_race' }
  | { action: 'fail'; reason: 'no_row_after_upsert' }

/**
 * After an idempotent insert (`INSERT ... ON CONFLICT DO NOTHING`), decide which
 * conversation row the route should adopt.
 *
 *   - The insert returned a row  ⇒ we won the race; use it.
 *   - The insert returned no row (ON CONFLICT DO NOTHING swallowed it) ⇒ we lost
 *     the race; adopt the row a concurrent webhook already created (fetched by a
 *     follow-up select). This is the fix for the split-brain: the loser no longer
 *     fabricates a second conversation — it joins the winner's, persists its
 *     inbound there, and the per-conversation lock then coalesces the two
 *     webhooks onto a single dialog turn.
 *   - Neither ⇒ genuine failure (return so the route can 500).
 */
export function decideConversationUpsert(
  created: ConversationRowLike,
  existing: ConversationRowLike,
): ConversationUpsertDecision {
  if (created && created.id) return { action: 'use_created', id: created.id }
  if (existing && existing.id) {
    return { action: 'use_existing', id: existing.id, reason: 'lost_insert_race' }
  }
  return { action: 'fail', reason: 'no_row_after_upsert' }
}

// ---------------------------------------------------------------------------
// R44 — arrival timestamps for adaptiveDebounceMs.
// ---------------------------------------------------------------------------

/** Minimal shape of an sms_messages row for debounce timing. */
export type TimedMessageRow = {
  direction?: string | null
  created_at?: string | null
}

/**
 * Extract the epoch-ms arrival timestamps of the INBOUND messages in the
 * current un-replied burst — i.e. every inbound that landed after the most
 * recent outbound — for `adaptiveDebounceMs`.
 *
 * Feeding only the current burst (not all-time history) keeps the debounce
 * adapting to *this* turn's typing speed: a returning customer's old inbounds
 * must not stretch today's window. Rows with an unparseable/blank created_at are
 * dropped (adaptiveDebounceMs already filters non-finite values, but we keep the
 * contract explicit here). Order-independent — adaptiveDebounceMs sorts.
 */
export function arrivalTimestampsFromTurns(rows: readonly TimedMessageRow[] | null | undefined): number[] {
  const list = rows ?? []
  let lastOutboundIdx = -1
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i]?.direction === 'outbound') { lastOutboundIdx = i; break }
  }
  const burst = list.slice(lastOutboundIdx + 1)
  const out: number[] = []
  for (const r of burst) {
    if (r?.direction !== 'inbound') continue
    const ts = r.created_at ? Date.parse(r.created_at) : NaN
    if (Number.isFinite(ts)) out.push(ts)
  }
  return out
}

// ---------------------------------------------------------------------------
// R46-inbound — adapt a dispatchQuoteMessage result into a throw retryWithBackoff
// can classify.
// ---------------------------------------------------------------------------

/** The subset of a dispatch result this adapter reads. */
export type DispatchResultLike =
  | { ok: true }
  | { ok: false; smsAttempt?: { code?: string | null; reason?: string | null } | null; waAttempt?: { code?: string | null; reason?: string | null } | null }

/**
 * An error that carries a Twilio/HTTP `code` so `isRetryableSendError` (which
 * reads `error.code`) can classify a dispatch failure the same way it classifies
 * a thrown network error. `dispatchQuoteMessage` RETURNS `{ok:false, smsAttempt}`
 * rather than throwing, so the route's retry `fn` must convert a failed result
 * into a throw — otherwise retryWithBackoff sees a fulfilled promise and never
 * retries. This is the precise R46-inbound gap: the AI-reply send at route.ts
 * had no outer retry, so an AbortError/timeout (mapped by dispatch to a NETWORK
 * result, or thrown outright) was delivered once and never retried.
 */
export class DispatchFailedError extends Error {
  readonly code: string
  readonly waCode: string | null
  constructor(code: string, message: string, waCode: string | null = null) {
    super(message)
    this.name = 'DispatchFailedError'
    this.code = code
    this.waCode = waCode
  }
}

/**
 * Throw a classifiable error for a failed dispatch result, or return the
 * successful result unchanged. Use inside a `retryWithBackoff` `fn`:
 *
 *     const outcome = await retryWithBackoff(() =>
 *       throwIfDispatchFailed(await dispatchQuoteMessage(...)))
 *
 * A successful dispatch passes through. A failed one throws DispatchFailedError
 * carrying the SMS attempt's code (e.g. 'NETWORK' / '429' / '21610') so the
 * shared classifier decides retryable (transient) vs terminal (carrier-permanent).
 */
export function throwIfDispatchFailed<T extends DispatchResultLike>(result: T): T {
  if (result.ok) return result
  const code = result.smsAttempt?.code ?? 'UNKNOWN'
  const reason = result.smsAttempt?.reason ?? 'dispatch failed (both channels)'
  const waCode = result.waAttempt?.code ?? null
  throw new DispatchFailedError(String(code), String(reason), waCode != null ? String(waCode) : null)
}

// ---------------------------------------------------------------------------
// R42 — after() budget guard.
// ---------------------------------------------------------------------------

/**
 * Decide whether the `after()` block is dangerously close to the function's
 * maxDuration budget — used to emit the `after_near_max_duration` alert via
 * logSendOutcome so an operator knows sends may be getting cut off (the signal
 * that a true offload/queue, not just a bigger cap, is needed).
 *
 *   elapsedMs       — wall-clock since after() started
 *   maxDurationSec  — the function budget (from getDeliveryKnobs)
 *   marginRatio     — fraction of the budget that counts as "near" (default 0.85)
 *
 * Returns true once elapsed crosses marginRatio * budget.
 */
export function isNearMaxDuration(
  elapsedMs: number,
  maxDurationSec: number,
  marginRatio = 0.85,
): boolean {
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) return false
  if (!Number.isFinite(maxDurationSec) || maxDurationSec <= 0) return false
  const ratio = Math.min(1, Math.max(0, marginRatio))
  return elapsedMs >= maxDurationSec * 1000 * ratio
}
