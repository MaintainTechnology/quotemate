// Route-level send orchestration for the estimate/draft after() block.
//
// The draft route's after() does two independent customer-affecting sends —
// the customer quote SMS and the tradie notification. R46-sends requires each
// to retry INDEPENDENTLY (one failing must never abort the other) via the
// shared retryWithBackoff, and R48-wiring requires every outcome (success,
// failure, skip) to be logged through logSendOutcome as a first-class,
// alertable record.
//
// A Next route handler isn't unit-testable without heavy mocks, so the POLICY
// added here lives in these PURE, dependency-injected functions and is
// exercised directly by send-quote-dispatch.test.ts:
//   - sendWithRetry: wrap any dispatch-returning fn in retryWithBackoff using
//     the env knobs, returning a normalized {dispatch?, outcome} where outcome
//     is a logSendOutcome-ready SendOutcomeInput.
//   - classifyDispatchOutcome: pure map from a DispatchResult (+ attempts +
//     latency) to a SendOutcomeInput (ok / fallback / failed).
//
// The route imports these and only does the I/O (calling dispatchQuoteMessage,
// reading the clock, and handing the outcome to logSendOutcome).

import type { DispatchResult } from './dispatch'
import {
  getDeliveryKnobs,
  isRetryableSendError,
  retryWithBackoff,
  type DeliveryKnobs,
  type SendOutcomeInput,
  type SendType,
} from './send-reliability'

/**
 * Build the retryWithBackoff policy for a route-level send from the delivery
 * knobs. Pure — no env read of its own; the caller passes knobs (defaults to
 * getDeliveryKnobs()). Shared classifier so route-level retries agree with
 * dispatch.ts on what's transient.
 */
export function retryPolicyFromKnobs(
  knobs: DeliveryKnobs,
  opts?: { onRetry?: (error: unknown, nextAttempt: number, delayMs: number) => void },
) {
  return {
    retries: knobs.sendRetries,
    baseDelayMs: knobs.sendBaseDelayMs,
    maxDelayMs: knobs.sendMaxDelayMs,
    isRetryable: isRetryableSendError,
    onRetry: opts?.onRetry,
  }
}

/**
 * Map a settled DispatchResult into a logSendOutcome-ready SendOutcomeInput.
 * Pure. `attempts` is the route-level retry attempt count (>=1), `latencyMs`
 * the measured wall time. A WhatsApp-fallback success is 'fallback' (carried,
 * but worth surfacing); a both-channels failure is the alertable 'failed'.
 */
export function classifyDispatchOutcome(
  sendType: SendType,
  result: DispatchResult,
  attempts: number,
  latencyMs: number,
): SendOutcomeInput {
  if (result.ok) {
    return {
      sendType,
      status: result.channel === 'whatsapp' ? 'fallback' : 'ok',
      attempts,
      latencyMs,
      channel: result.channel,
    }
  }
  // Both SMS retries and the WhatsApp fallback failed. Prefer the WhatsApp
  // failure code/reason when present (it was the last channel tried), else the
  // SMS attempt's — so the alert carries the most proximate error.
  const error = result.waAttempt ?? result.smsAttempt
  return {
    sendType,
    status: 'failed',
    attempts,
    latencyMs,
    channel: null,
    error,
  }
}

/** What a single route-level send resolves to. */
export type SendWithRetryResult = {
  /** the final DispatchResult, or null if the dispatch fn THREW on every try. */
  dispatch: DispatchResult | null
  /** route-level retry attempts actually made (>=1). */
  attempts: number
  /** logSendOutcome-ready record describing the final state. */
  outcome: SendOutcomeInput
}

/**
 * Run a dispatch-returning fn under retryWithBackoff and normalize the result.
 *
 * Two failure shapes are unified:
 *   1. fn RESOLVES to a failed DispatchResult ({ ok:false }) — dispatch.ts's
 *      own SMS+WhatsApp path exhausted. We retry the WHOLE dispatch only when
 *      the failure is transient (so a 21610 STOP doesn't burn the budget).
 *   2. fn THROWS — should be rare now that dispatch.ts swallows throws, but a
 *      caller-side error (URL building, signer) still surfaces here; classified
 *      via the same retryability rule.
 *
 * Never throws: callers in after() get a structured outcome they can log even
 * on total failure, so a silent "quote inserted but SMS never sent" can't
 * happen. The clock is injected for deterministic tests.
 */
export async function sendWithRetry(
  sendType: SendType,
  fn: () => Promise<DispatchResult>,
  opts?: {
    knobs?: DeliveryKnobs
    now?: () => number
    onRetry?: (error: unknown, nextAttempt: number, delayMs: number) => void
    sleep?: (ms: number) => Promise<void>
  },
): Promise<SendWithRetryResult> {
  const knobs = opts?.knobs ?? getDeliveryKnobs()
  const now = opts?.now ?? Date.now
  const started = now()
  const policy = retryPolicyFromKnobs(knobs, { onRetry: opts?.onRetry })

  // We want retryWithBackoff to retry on BOTH a thrown transient AND a
  // resolved-but-transient-failed DispatchResult. retryWithBackoff only retries
  // on throws, so convert a transient failed result into a throw, and let a
  // terminal failed result resolve (no point retrying a STOP'd number).
  //
  // Retryability keys off the SMS leg — it's the PRIMARY channel, so a fresh
  // whole-dispatch retry gives the SMS another shot. The WhatsApp fallback's
  // own code is irrelevant here: a terminal WA failure (e.g. recipient never
  // opted into the sandbox, 63016) must NOT make a transient SMS 429/5xx look
  // un-retryable.
  const outcome = await retryWithBackoff<DispatchResult>(
    async () => {
      const r = await fn()
      if (!r.ok && isRetryableSendError(r.smsAttempt)) {
        // throw to trigger a backoff+retry, but carry the result so the
        // final (exhausted) attempt can still be reported as a DispatchFail.
        throw Object.assign(new Error('dispatch failed (transient)'), {
          __dispatchResult: r,
          code: r.smsAttempt.code,
        })
      }
      return r
    },
    { ...policy, sleep: opts?.sleep },
  )

  const latencyMs = now() - started

  if (outcome.ok) {
    return {
      dispatch: outcome.value,
      attempts: outcome.attempts,
      outcome: classifyDispatchOutcome(sendType, outcome.value, outcome.attempts, latencyMs),
    }
  }

  // Failed after exhausting retries. The thrown error may carry the last
  // DispatchResult (transient-failed path) — surface it so the log keeps the
  // real Twilio codes; otherwise the fn itself threw (no DispatchResult).
  const carried = (outcome.error as { __dispatchResult?: DispatchResult } | undefined)?.__dispatchResult
  if (carried) {
    return {
      dispatch: carried,
      attempts: outcome.attempts,
      outcome: classifyDispatchOutcome(sendType, carried, outcome.attempts, latencyMs),
    }
  }
  return {
    dispatch: null,
    attempts: outcome.attempts,
    outcome: {
      sendType,
      status: 'failed',
      attempts: outcome.attempts,
      latencyMs,
      channel: null,
      error: outcome.error,
    },
  }
}
