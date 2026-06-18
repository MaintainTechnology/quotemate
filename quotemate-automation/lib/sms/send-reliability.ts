// SMS delivery-reliability primitives (R46 + R48 + R49 + R44 helper).
//
// This module is deliberately PURE and dependency-injected: it imports
// nothing from twilio/supabase/next and never performs I/O of its own. The
// route handlers (`app/api/sms/inbound/route.ts`, intake/structure, etc.)
// stay un-unit-testable behind heavy mocks, so the *policy* — retry/backoff,
// retryable-vs-terminal classification, env-knob parsing, debounce sizing,
// and the send-outcome log shape — lives here and is exercised directly by
// `send-reliability.test.ts`.
//
// Why this exists (drift confirmed 2026-06-18 against the running code):
//   - `lib/sms/dispatch.ts` retries Twilio sends, but only classifies by the
//     Twilio *result code* (429 / 5xx / 14107 / 14101 / NETWORK). A fetch that
//     throws AbortError / TimeoutError before producing a result is only
//     incidentally covered (twilio.ts maps a thrown fetch to code 'NETWORK').
//   - `lib/util/retry.ts` (`withRetry`) wraps the intake handoff but (a) has no
//     jitter, (b) has no max-delay cap, (c) throws instead of returning a
//     structured {ok, attempts} outcome an alert can key off, and (d) the
//     inbound route's AI-reply dispatch at route.ts:2297 has NO outer retry at
//     all — it relies solely on dispatch.ts's code-based retry and so SKIPS the
//     AbortError/TimeoutError case as a first-class retryable class.
// `retryWithBackoff` below treats Twilio 429/5xx AND thrown AbortError/timeout/
// network errors as retryable, 4xx (except 429) as terminal, and returns a
// structured outcome with the attempt count.

// ---------------------------------------------------------------------------
// retryWithBackoff (R46)
// ---------------------------------------------------------------------------

export type RetryPolicy<E = unknown> = {
  /** Number of RETRIES after the first attempt. retries=2 ⇒ up to 3 calls. Default 2. */
  retries?: number
  /** Base delay in ms for the first backoff step. Default 500. */
  baseDelayMs?: number
  /** Hard cap on any single backoff delay (pre-jitter ceiling). Default 5000. */
  maxDelayMs?: number
  /** Classify a thrown error / failed result as retryable. Default: isRetryableSendError. */
  isRetryable?: (error: E) => boolean
  /** Sleep impl (injected for tests). Default: setTimeout-backed promise. */
  sleep?: (ms: number) => Promise<void>
  /** Jitter factor in [0,1]; 0 = no jitter (deterministic, for tests). Default 0. */
  jitter?: (attemptIndex: number) => number
  /** Fired before each backoff sleep — useful for pipeline logs. */
  onRetry?: (error: E, nextAttempt: number, delayMs: number) => void
}

export type RetryOutcome<T, E = unknown> =
  | { ok: true; value: T; attempts: number }
  | { ok: false; error: E; attempts: number }

/**
 * Compute the backoff delay (ms) for a given zero-based retry index.
 * Exponential: base * 2^index, clamped to [0, maxDelayMs], with optional
 * multiplicative jitter in [0,1] applied to the *capped* value.
 *
 * Pure + deterministic when `jitterFactor` is omitted (defaults to 0).
 */
export function backoffDelayMs(
  attemptIndex: number,
  baseDelayMs: number,
  maxDelayMs: number,
  jitterFactor = 0,
): number {
  const safeBase = Math.max(0, baseDelayMs)
  const safeMax = Math.max(0, maxDelayMs)
  const raw = safeBase * Math.pow(2, Math.max(0, attemptIndex))
  const capped = Math.min(raw, safeMax)
  const clampedJitter = Math.min(1, Math.max(0, jitterFactor))
  // Jitter only ever REDUCES the delay (full jitter on the low side), so the
  // schedule stays bounded by the capped exponential ceiling: delay ∈ [cap*(1-j), cap].
  const delay = capped - capped * clampedJitter * 0.5
  return Math.round(delay)
}

/**
 * Default retryability classifier shared by the dispatch + AI-reply paths.
 *
 * Retryable (transient):
 *   - thrown AbortError / TimeoutError (Vercel terminating an in-flight fetch,
 *     undici headersTimeout) — the case the AI-reply path currently skips
 *   - network errors (fetch failed / ETIMEDOUT / ECONNRESET / 'NETWORK')
 *   - Twilio 429 (rate limit) and 5xx (server error)
 *   - Twilio messaging-service rate limits 14107 / 14101
 * Terminal:
 *   - any other 4xx (21610 STOP, 21408 geo, 21612 blocked, 21211 invalid, …)
 *   - credential / config errors (NO_CREDS, NO_FROM)
 *   - anything unrecognised → terminal (fail safe: don't burn budget)
 */
export function isRetryableSendError(error: unknown): boolean {
  // 1) Thrown JS errors — AbortError / TimeoutError / network.
  if (error instanceof Error) {
    const name = error.name
    if (name === 'AbortError' || name === 'TimeoutError') return true
    const msg = error.message ?? ''
    if (/abort|timeout|ETIMEDOUT|ECONNRESET|ECONNREFUSED|EAI_AGAIN|UND_ERR_HEADERS_TIMEOUT|fetch failed|socket hang up/i.test(msg)) {
      return true
    }
    // An Error carrying a numeric/string code (e.g. { code: '429' }).
    const code = (error as { code?: unknown }).code
    if (code != null) return isRetryableCode(code)
    return false
  }

  // 2) A Twilio-style failed result object: { ok:false, code }.
  if (error && typeof error === 'object') {
    const obj = error as { ok?: unknown; code?: unknown; name?: unknown }
    if (obj.name === 'AbortError' || obj.name === 'TimeoutError') return true
    if (obj.code != null) return isRetryableCode(obj.code)
    return false
  }

  // 3) A bare code value passed directly.
  if (typeof error === 'string' || typeof error === 'number') {
    return isRetryableCode(error)
  }

  return false
}

/** Classify a Twilio/HTTP status code (string or number) as retryable. */
export function isRetryableCode(code: unknown): boolean {
  const c = String(code).trim()
  if (c === 'NETWORK') return true
  if (c === '429' || c === '14107' || c === '14101') return true
  if (/^5\d\d$/.test(c)) return true // any 5xx
  // 4xx (except 429, handled above) and everything else is terminal.
  return false
}

/**
 * Run `fn` with exponential backoff + optional jitter, returning a structured
 * outcome (never throws for a handled failure). Generic over the success type
 * `T` and the error type `E`.
 *
 * `fn` may signal failure either by THROWING or by being wrapped to throw; we
 * classify whatever it throws via `isRetryable`. On the final failed attempt we
 * return `{ ok:false, error, attempts }` rather than re-throwing so callers (in
 * the route's `after()`) get the attempt count for the alert log.
 */
export async function retryWithBackoff<T, E = unknown>(
  fn: (attempt: number) => Promise<T>,
  policy: RetryPolicy<E> = {},
): Promise<RetryOutcome<T, E>> {
  const retries = Math.max(0, policy.retries ?? 2)
  const baseDelayMs = Math.max(0, policy.baseDelayMs ?? 500)
  const maxDelayMs = Math.max(0, policy.maxDelayMs ?? 5000)
  const isRetryable = policy.isRetryable ?? (isRetryableSendError as (e: E) => boolean)
  const sleep = policy.sleep ?? defaultSleep
  const jitter = policy.jitter

  let attempts = 0
  let lastError: E
  for (let i = 0; i <= retries; i++) {
    attempts++
    try {
      const value = await fn(attempts)
      return { ok: true, value, attempts }
    } catch (err) {
      lastError = err as E
      const isLast = i === retries
      if (isLast || !isRetryable(lastError)) {
        return { ok: false, error: lastError, attempts }
      }
      const delay = backoffDelayMs(i, baseDelayMs, maxDelayMs, jitter ? jitter(i) : 0)
      policy.onRetry?.(lastError, attempts + 1, delay)
      await sleep(delay)
    }
  }
  // Unreachable (loop always returns), but satisfies the type checker.
  return { ok: false, error: lastError!, attempts }
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// ---------------------------------------------------------------------------
// getDeliveryKnobs (R49) — env-tunable without a code change.
// ---------------------------------------------------------------------------

export type DeliveryKnobs = {
  /** Vercel function maxDuration budget (seconds) the after() work runs under. */
  maxDurationSec: number
  /** Debounce window (ms) used to coalesce rapid-fire inbound texts. */
  debounceMs: number
  /** Retries (after the first attempt) for an outbound send. */
  sendRetries: number
  /** Base backoff delay (ms). */
  sendBaseDelayMs: number
  /** Max single backoff delay (ms). */
  sendMaxDelayMs: number
}

export const DELIVERY_KNOB_DEFAULTS: DeliveryKnobs = {
  maxDurationSec: 300,
  debounceMs: 1500,
  sendRetries: 2,
  sendBaseDelayMs: 500,
  sendMaxDelayMs: 5000,
}

// Clamp bounds keep a fat-fingered env value from breaking the pipeline:
// e.g. a 0s maxDuration (no budget) or a 10-minute debounce (texts never reply).
const KNOB_BOUNDS = {
  maxDurationSec: { min: 5, max: 800 },
  debounceMs: { min: 0, max: 60_000 },
  sendRetries: { min: 0, max: 10 },
  sendBaseDelayMs: { min: 0, max: 60_000 },
  sendMaxDelayMs: { min: 0, max: 120_000 },
} as const

/** Parse one numeric env var with default + clamp. Non-numeric ⇒ default. */
export function parseIntKnob(
  raw: string | undefined,
  fallback: number,
  bounds: { min: number; max: number },
): number {
  if (raw == null || raw.trim() === '') return fallback
  const n = Number(raw)
  if (!Number.isFinite(n)) return fallback
  const floored = Math.trunc(n)
  return Math.min(bounds.max, Math.max(bounds.min, floored))
}

/**
 * Parse SMS delivery knobs from an env-like record (R49). Defaults applied when
 * unset/blank/non-numeric; every value clamped to a sane range. Also enforces
 * the invariant maxDelay >= baseDelay so the backoff schedule is monotonic.
 */
export function getDeliveryKnobs(env: Record<string, string | undefined> = process.env): DeliveryKnobs {
  const maxDurationSec = parseIntKnob(env.SMS_MAX_DURATION, DELIVERY_KNOB_DEFAULTS.maxDurationSec, KNOB_BOUNDS.maxDurationSec)
  const debounceMs = parseIntKnob(env.SMS_DEBOUNCE_MS, DELIVERY_KNOB_DEFAULTS.debounceMs, KNOB_BOUNDS.debounceMs)
  const sendRetries = parseIntKnob(env.SMS_SEND_RETRIES, DELIVERY_KNOB_DEFAULTS.sendRetries, KNOB_BOUNDS.sendRetries)
  const sendBaseDelayMs = parseIntKnob(env.SMS_SEND_BASE_DELAY_MS, DELIVERY_KNOB_DEFAULTS.sendBaseDelayMs, KNOB_BOUNDS.sendBaseDelayMs)
  let sendMaxDelayMs = parseIntKnob(env.SMS_SEND_MAX_DELAY_MS, DELIVERY_KNOB_DEFAULTS.sendMaxDelayMs, KNOB_BOUNDS.sendMaxDelayMs)
  // A max below base would silently cap every backoff to base — surprising.
  // Raise max to base so the schedule is at least non-decreasing.
  if (sendMaxDelayMs < sendBaseDelayMs) sendMaxDelayMs = sendBaseDelayMs

  return { maxDurationSec, debounceMs, sendRetries, sendBaseDelayMs, sendMaxDelayMs }
}

// ---------------------------------------------------------------------------
// Send-outcome record + log helper (R48) — every send outcome / skip path is
// logged in a shape an alert can key off.
// ---------------------------------------------------------------------------

/** What kind of outbound send this outcome describes. */
export type SendType =
  | 'customer_reply'    // AI dialog reply (route.ts:2297)
  | 'customer_quote'    // the quote SMS after a successful estimate
  | 'tradie_notify'     // tradie SMS/WhatsApp notification
  | 'photo_link'        // photo-upload link SMS/MMS
  | 'failure_notice'    // "we hit a snag" recovery SMS
  | 'intake_handoff'    // POST to /api/intake/structure

/**
 * Status of a send/skip. `not_dispatched_in_budget` and `quote_no_customer_sms`
 * and `after_near_max_duration` are the explicit ALERTABLE conditions called out
 * in R48 — they are first-class statuses, not buried in a free-text message.
 */
export type SendStatus =
  | 'ok'                        // delivered (possibly after retries / fallback)
  | 'fallback'                  // succeeded on the secondary channel (WhatsApp)
  | 'failed'                    // both channels failed
  | 'skipped'                   // intentionally not sent (dedupe, empty body, …)
  | 'not_dispatched_in_budget'  // ALERT: type never dispatched within time budget
  | 'quote_no_customer_sms'     // ALERT: quote row inserted but customer SMS not sent
  | 'after_near_max_duration'   // ALERT: after() nearing maxDuration

/** The structured record. `alert: true` means a monitor should page on it. */
export type SendOutcomeRecord = {
  sendType: SendType
  status: SendStatus
  attempts: number
  latencyMs: number
  /** channel that ultimately carried the message, when known. */
  channel?: 'sms' | 'whatsapp' | null
  /** terminal error code (Twilio code or thrown error name), when failed. */
  errorCode?: string | null
  /** human-readable reason / error message, when failed or skipped. */
  reason?: string | null
  /** true for any condition a monitor should alert on. */
  alert: boolean
}

const ALERTABLE_STATUSES: ReadonlySet<SendStatus> = new Set<SendStatus>([
  'failed',
  'not_dispatched_in_budget',
  'quote_no_customer_sms',
  'after_near_max_duration',
])

/** Is this status one a monitor should page on? */
export function isAlertableStatus(status: SendStatus): boolean {
  return ALERTABLE_STATUSES.has(status)
}

export type SendOutcomeInput = {
  sendType: SendType
  status: SendStatus
  attempts: number
  latencyMs: number
  channel?: 'sms' | 'whatsapp' | null
  /** an error in any shape (Error, Twilio failed-result, code, string). */
  error?: unknown
}

/** Pull a stable code + message out of any error shape we might be handed. */
export function describeError(error: unknown): { code: string | null; reason: string | null } {
  if (error == null) return { code: null, reason: null }
  if (error instanceof Error) {
    return { code: error.name || null, reason: error.message || null }
  }
  if (typeof error === 'object') {
    const o = error as { code?: unknown; reason?: unknown; message?: unknown; error?: unknown }
    const code = o.code != null ? String(o.code) : null
    const reason =
      o.reason != null ? String(o.reason)
      : o.message != null ? String(o.message)
      : o.error != null ? String(o.error)
      : null
    return { code, reason }
  }
  if (typeof error === 'string') return { code: null, reason: error }
  return { code: String(error), reason: null }
}

/** Build the normalized record (pure — no logging). */
export function buildSendOutcome(input: SendOutcomeInput): SendOutcomeRecord {
  const { code, reason } = describeError(input.error)
  return {
    sendType: input.sendType,
    status: input.status,
    attempts: Math.max(0, Math.trunc(input.attempts)),
    latencyMs: Math.max(0, Math.round(input.latencyMs)),
    channel: input.channel ?? null,
    errorCode: code,
    reason,
    alert: isAlertableStatus(input.status),
  }
}

/**
 * Minimal structural type for the logger returned by `pipelineLog()` in
 * `lib/log/pipeline.ts` — we only need its three emit methods, so we accept a
 * structural subset rather than importing the concrete return type (keeps this
 * module decoupled and trivially mockable in tests).
 */
export type PipelineLoggerLike = {
  ok: (event: string, data?: Record<string, unknown>) => void
  err: (event: string, error?: unknown, data?: Record<string, unknown>) => void
  step?: (event: string, data?: Record<string, unknown>) => void
}

/**
 * Emit a send outcome onto an existing pipeline logger (R48). Maps the record's
 * alertability to the logger's ok/err channel so an alert can grep `[QM` lines
 * with `✗` + `alert=true`, plus the explicit `status` token. Returns the record
 * so callers can also persist it (e.g. recordTrace).
 */
export function logSendOutcome(
  logger: PipelineLoggerLike,
  input: SendOutcomeInput,
): SendOutcomeRecord {
  const record = buildSendOutcome(input)
  const data: Record<string, unknown> = {
    send_type: record.sendType,
    status: record.status,
    attempts: record.attempts,
    latency_ms: record.latencyMs,
    alert: record.alert,
  }
  if (record.channel) data.channel = record.channel
  if (record.errorCode) data.error_code = record.errorCode
  const event = `send ${record.sendType}`
  if (record.alert) {
    logger.err(event, record.reason ?? record.status, data)
  } else {
    logger.ok(event, data)
  }
  return record
}

// ---------------------------------------------------------------------------
// adaptiveDebounceMs (R44 helper) — coalesce rapid-fire texts without dropping.
// ---------------------------------------------------------------------------

/**
 * Given the arrival timestamps (ms epoch) of inbound messages in the current
 * burst and the delivery knobs, compute how long to wait before processing —
 * adapting to the arrival rate so that rapid-fire texts coalesce into one
 * dialog turn while a lone text replies promptly.
 *
 * Algorithm (pure):
 *   - 0 or 1 arrivals ⇒ the base debounce window (knobs.debounceMs).
 *   - For ≥2 arrivals, measure the most recent inter-arrival gap. If the user
 *     is still typing fast (gap < base window), the sender is mid-burst, so we
 *     EXTEND the wait (cap at ~4× base) to let trailing texts land. As the gap
 *     widens toward the base window, we shrink back toward base. We never return
 *     less than the smallest observed gap (so we don't process before the next
 *     known-likely text) and never exceed the cap (so we don't stall forever).
 *
 * Crucially this only sets a WAIT — no message is ever dropped; coalescing
 * means they're processed together once the burst settles.
 */
export function adaptiveDebounceMs(
  arrivalTimestamps: readonly number[],
  knobs: Pick<DeliveryKnobs, 'debounceMs'>,
): number {
  const base = Math.max(0, knobs.debounceMs)
  const cap = base * 4
  const sorted = [...arrivalTimestamps].filter((t) => Number.isFinite(t)).sort((a, b) => a - b)
  if (sorted.length <= 1) return base

  const gaps: number[] = []
  for (let i = 1; i < sorted.length; i++) gaps.push(sorted[i] - sorted[i - 1])
  const lastGap = gaps[gaps.length - 1]
  const minGap = Math.min(...gaps)

  // Fast burst (recent gap below base) ⇒ extend toward the cap, scaled by how
  // much faster than the base window the texts are arriving.
  if (lastGap < base && base > 0) {
    const speed = 1 - lastGap / base // 0 (at base) .. ~1 (instant)
    const extended = base + (cap - base) * speed
    return Math.round(Math.min(cap, Math.max(base, extended)))
  }

  // Burst has settled (gaps >= base): wait the smaller of base and the minimum
  // observed gap so we still don't pre-empt an imminent trailing text, but stay
  // responsive.
  return Math.round(Math.max(0, Math.min(base, minGap)))
}
