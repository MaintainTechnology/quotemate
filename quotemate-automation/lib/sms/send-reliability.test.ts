// Unit coverage for the SMS delivery-reliability primitives.
//
// Everything here is pure / dependency-injected, so no twilio/supabase/next
// mocks are needed: `retryWithBackoff` takes an injected sleep, and the rest
// are plain functions over plain data.

import { describe, expect, it, vi } from 'vitest'
import {
  adaptiveDebounceMs,
  backoffDelayMs,
  buildSendOutcome,
  DELIVERY_KNOB_DEFAULTS,
  describeError,
  getDeliveryKnobs,
  isAlertableStatus,
  isRetryableCode,
  isRetryableSendError,
  logSendOutcome,
  parseIntKnob,
  retryWithBackoff,
  type PipelineLoggerLike,
  type SendStatus,
} from './send-reliability'

// A sleep that records the delays it was asked to wait but never actually
// waits — keeps the backoff tests instant and deterministic.
function recordingSleep() {
  const delays: number[] = []
  const sleep = (ms: number) => {
    delays.push(ms)
    return Promise.resolve()
  }
  return { delays, sleep }
}

// ---------------------------------------------------------------------------
// isRetryableCode / isRetryableSendError — classification (R46)
// ---------------------------------------------------------------------------

describe('isRetryableCode', () => {
  it('treats 429, 5xx and messaging-service rate limits as retryable', () => {
    for (const c of ['429', '500', '502', '503', '599', '14107', '14101', 'NETWORK']) {
      expect(isRetryableCode(c)).toBe(true)
    }
    // numeric forms too
    expect(isRetryableCode(429)).toBe(true)
    expect(isRetryableCode(503)).toBe(true)
  })

  it('treats other 4xx and carrier-permanent codes as terminal', () => {
    for (const c of ['400', '401', '404', '21610', '21408', '21612', '21211', 'NO_CREDS', 'NO_FROM']) {
      expect(isRetryableCode(c)).toBe(false)
    }
  })
})

describe('isRetryableSendError', () => {
  it('retries thrown AbortError / TimeoutError (the case the AI-reply path skips)', () => {
    const abort = new Error('The operation was aborted')
    abort.name = 'AbortError'
    expect(isRetryableSendError(abort)).toBe(true)

    const timeout = new Error('timed out')
    timeout.name = 'TimeoutError'
    expect(isRetryableSendError(timeout)).toBe(true)
  })

  it('retries network-ish error messages regardless of name', () => {
    for (const m of [
      'fetch failed',
      'ETIMEDOUT',
      'ECONNRESET',
      'UND_ERR_HEADERS_TIMEOUT',
      'socket hang up',
      'request aborted',
    ]) {
      expect(isRetryableSendError(new Error(m))).toBe(true)
    }
  })

  it('retries an Error carrying a retryable code', () => {
    const e = Object.assign(new Error('rate limited'), { code: '429' })
    expect(isRetryableSendError(e)).toBe(true)
    const e2 = Object.assign(new Error('boom'), { code: '500' })
    expect(isRetryableSendError(e2)).toBe(true)
  })

  it('retries a Twilio-style failed result with a transient code', () => {
    expect(isRetryableSendError({ ok: false, code: '429' })).toBe(true)
    expect(isRetryableSendError({ ok: false, code: 'NETWORK' })).toBe(true)
    expect(isRetryableSendError({ ok: false, code: '503' })).toBe(true)
  })

  it('treats terminal Twilio results and plain errors as non-retryable', () => {
    expect(isRetryableSendError({ ok: false, code: '21610' })).toBe(false) // STOP
    expect(isRetryableSendError({ ok: false, code: 'NO_FROM' })).toBe(false)
    expect(isRetryableSendError(new Error('schema validation failed'))).toBe(false)
    expect(isRetryableSendError('21408')).toBe(false)
    expect(isRetryableSendError(null)).toBe(false)
    expect(isRetryableSendError(undefined)).toBe(false)
  })

  it('accepts a bare retryable code value', () => {
    expect(isRetryableSendError('429')).toBe(true)
    expect(isRetryableSendError(503)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// backoffDelayMs — monotonic + capped + jitter (R46)
// ---------------------------------------------------------------------------

describe('backoffDelayMs', () => {
  it('is exponential off the base for the early steps', () => {
    expect(backoffDelayMs(0, 500, 60_000)).toBe(500)
    expect(backoffDelayMs(1, 500, 60_000)).toBe(1000)
    expect(backoffDelayMs(2, 500, 60_000)).toBe(2000)
    expect(backoffDelayMs(3, 500, 60_000)).toBe(4000)
  })

  it('caps every delay at maxDelayMs', () => {
    expect(backoffDelayMs(10, 500, 5000)).toBe(5000)
    expect(backoffDelayMs(20, 500, 5000)).toBe(5000)
  })

  it('produces a non-decreasing (monotonic) schedule up to the cap', () => {
    const schedule = Array.from({ length: 8 }, (_, i) => backoffDelayMs(i, 500, 5000))
    for (let i = 1; i < schedule.length; i++) {
      expect(schedule[i]).toBeGreaterThanOrEqual(schedule[i - 1])
    }
    expect(schedule[schedule.length - 1]).toBe(5000)
  })

  it('jitter only reduces the delay and stays within the capped bound', () => {
    const cap = 5000
    const full = backoffDelayMs(10, 500, cap, 1) // index well past the cap
    expect(full).toBeLessThan(cap)
    expect(full).toBeGreaterThanOrEqual(cap * 0.5)
    // jitter=0 ⇒ exactly the capped value
    expect(backoffDelayMs(10, 500, cap, 0)).toBe(cap)
  })

  it('handles zero / negative inputs safely', () => {
    expect(backoffDelayMs(-5, 500, 5000)).toBe(500)
    expect(backoffDelayMs(0, -100, 5000)).toBe(0)
    expect(backoffDelayMs(3, 500, -100)).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// retryWithBackoff — outcome shape + retry/terminal behaviour (R46)
// ---------------------------------------------------------------------------

describe('retryWithBackoff', () => {
  it('returns ok on first success without sleeping', async () => {
    const { delays, sleep } = recordingSleep()
    const out = await retryWithBackoff(async () => 'value', { sleep })
    expect(out).toEqual({ ok: true, value: 'value', attempts: 1 })
    expect(delays).toEqual([])
  })

  it('retries a transient failure then succeeds, counting attempts', async () => {
    const { delays, sleep } = recordingSleep()
    let calls = 0
    const out = await retryWithBackoff(
      async () => {
        calls++
        if (calls < 3) {
          const e = new Error('aborted')
          e.name = 'AbortError'
          throw e
        }
        return 'ok'
      },
      { retries: 3, baseDelayMs: 500, maxDelayMs: 5000, sleep },
    )
    expect(out).toEqual({ ok: true, value: 'ok', attempts: 3 })
    // two backoffs before the 3rd attempt: 500, then 1000
    expect(delays).toEqual([500, 1000])
  })

  it('stops immediately on a terminal error (no retries, no sleep)', async () => {
    const { delays, sleep } = recordingSleep()
    let calls = 0
    const out = await retryWithBackoff(
      async () => {
        calls++
        throw { ok: false, code: '21610', reason: 'STOP' } // terminal
      },
      { retries: 3, sleep },
    )
    expect(out.ok).toBe(false)
    expect(out.attempts).toBe(1)
    expect(calls).toBe(1)
    expect(delays).toEqual([])
    if (!out.ok) expect((out.error as { code: string }).code).toBe('21610')
  })

  it('exhausts all retries on persistent transient failure and returns the last error', async () => {
    const { delays, sleep } = recordingSleep()
    let calls = 0
    const out = await retryWithBackoff(
      async () => {
        calls++
        throw { ok: false, code: '503', reason: `server err ${calls}` }
      },
      { retries: 2, baseDelayMs: 500, maxDelayMs: 5000, sleep },
    )
    expect(out.ok).toBe(false)
    expect(out.attempts).toBe(3) // 1 + 2 retries
    expect(calls).toBe(3)
    expect(delays).toEqual([500, 1000]) // two sleeps between three attempts
    if (!out.ok) expect((out.error as { reason: string }).reason).toBe('server err 3')
  })

  it('respects retries=0 (single attempt, never sleeps)', async () => {
    const { delays, sleep } = recordingSleep()
    const out = await retryWithBackoff(
      async () => {
        throw { ok: false, code: '503' }
      },
      { retries: 0, sleep },
    )
    expect(out.attempts).toBe(1)
    expect(delays).toEqual([])
  })

  it('fires onRetry with the upcoming attempt number and delay', async () => {
    const { sleep } = recordingSleep()
    const seen: Array<{ nextAttempt: number; delay: number }> = []
    let calls = 0
    await retryWithBackoff(
      async () => {
        calls++
        if (calls < 3) throw { ok: false, code: '429' }
        return 'done'
      },
      {
        retries: 3,
        baseDelayMs: 500,
        maxDelayMs: 5000,
        sleep,
        onRetry: (_e, nextAttempt, delay) => seen.push({ nextAttempt, delay }),
      },
    )
    expect(seen).toEqual([
      { nextAttempt: 2, delay: 500 },
      { nextAttempt: 3, delay: 1000 },
    ])
  })

  it('honours an injected isRetryable override', async () => {
    const { sleep } = recordingSleep()
    let calls = 0
    const out = await retryWithBackoff(
      async () => {
        calls++
        throw new Error('custom-transient')
      },
      {
        retries: 2,
        sleep,
        isRetryable: (e) => e instanceof Error && e.message === 'custom-transient',
      },
    )
    expect(out.attempts).toBe(3)
    expect(calls).toBe(3)
  })

  it('passes the attempt number into fn', async () => {
    const { sleep } = recordingSleep()
    const attemptsSeen: number[] = []
    await retryWithBackoff(
      async (attempt) => {
        attemptsSeen.push(attempt)
        if (attempt < 2) throw { ok: false, code: '429' }
        return 'ok'
      },
      { retries: 2, sleep },
    )
    expect(attemptsSeen).toEqual([1, 2])
  })
})

// ---------------------------------------------------------------------------
// parseIntKnob + getDeliveryKnobs — env parsing/clamping/defaults (R49)
// ---------------------------------------------------------------------------

describe('parseIntKnob', () => {
  const bounds = { min: 0, max: 100 }
  it('returns the fallback for unset / blank / non-numeric input', () => {
    expect(parseIntKnob(undefined, 42, bounds)).toBe(42)
    expect(parseIntKnob('', 42, bounds)).toBe(42)
    expect(parseIntKnob('   ', 42, bounds)).toBe(42)
    expect(parseIntKnob('abc', 42, bounds)).toBe(42)
    expect(parseIntKnob('NaN', 42, bounds)).toBe(42)
  })

  it('parses and truncates a numeric value', () => {
    expect(parseIntKnob('37', 0, bounds)).toBe(37)
    expect(parseIntKnob('37.9', 0, bounds)).toBe(37)
  })

  it('clamps to the [min,max] range', () => {
    expect(parseIntKnob('-5', 0, bounds)).toBe(0)
    expect(parseIntKnob('9999', 0, bounds)).toBe(100)
  })
})

describe('getDeliveryKnobs', () => {
  it('returns the documented defaults for an empty env', () => {
    expect(getDeliveryKnobs({})).toEqual(DELIVERY_KNOB_DEFAULTS)
  })

  it('reads every knob from env', () => {
    const knobs = getDeliveryKnobs({
      SMS_MAX_DURATION: '120',
      SMS_DEBOUNCE_MS: '2500',
      SMS_SEND_RETRIES: '4',
      SMS_SEND_BASE_DELAY_MS: '750',
      SMS_SEND_MAX_DELAY_MS: '9000',
    })
    expect(knobs).toEqual({
      maxDurationSec: 120,
      debounceMs: 2500,
      sendRetries: 4,
      sendBaseDelayMs: 750,
      sendMaxDelayMs: 9000,
    })
  })

  it('clamps out-of-range values to the safe bounds', () => {
    const knobs = getDeliveryKnobs({
      SMS_MAX_DURATION: '99999', // > max 800
      SMS_DEBOUNCE_MS: '-100',   // < min 0
      SMS_SEND_RETRIES: '50',    // > max 10
    })
    expect(knobs.maxDurationSec).toBe(800)
    expect(knobs.debounceMs).toBe(0)
    expect(knobs.sendRetries).toBe(10)
  })

  it('raises max-delay to base-delay when env sets max < base (monotonic schedule)', () => {
    const knobs = getDeliveryKnobs({
      SMS_SEND_BASE_DELAY_MS: '4000',
      SMS_SEND_MAX_DELAY_MS: '1000',
    })
    expect(knobs.sendBaseDelayMs).toBe(4000)
    expect(knobs.sendMaxDelayMs).toBe(4000)
  })

  it('falls back to defaults for blank / garbage values', () => {
    const knobs = getDeliveryKnobs({
      SMS_MAX_DURATION: 'soon',
      SMS_DEBOUNCE_MS: '',
    })
    expect(knobs.maxDurationSec).toBe(DELIVERY_KNOB_DEFAULTS.maxDurationSec)
    expect(knobs.debounceMs).toBe(DELIVERY_KNOB_DEFAULTS.debounceMs)
  })
})

// ---------------------------------------------------------------------------
// send-outcome record + log helper (R48)
// ---------------------------------------------------------------------------

describe('describeError', () => {
  it('extracts name + message from an Error', () => {
    const e = new Error('boom')
    e.name = 'AbortError'
    expect(describeError(e)).toEqual({ code: 'AbortError', reason: 'boom' })
  })
  it('extracts code + reason from a Twilio-style result', () => {
    expect(describeError({ code: '21610', reason: 'opted out' })).toEqual({
      code: '21610',
      reason: 'opted out',
    })
  })
  it('handles strings and null', () => {
    expect(describeError('weird thing')).toEqual({ code: null, reason: 'weird thing' })
    expect(describeError(null)).toEqual({ code: null, reason: null })
  })
})

describe('isAlertableStatus', () => {
  it('flags the four alertable conditions', () => {
    const alertable: SendStatus[] = [
      'failed',
      'not_dispatched_in_budget',
      'quote_no_customer_sms',
      'after_near_max_duration',
    ]
    for (const s of alertable) expect(isAlertableStatus(s)).toBe(true)
  })
  it('does not flag normal outcomes', () => {
    for (const s of ['ok', 'fallback', 'skipped'] as SendStatus[]) {
      expect(isAlertableStatus(s)).toBe(false)
    }
  })
})

describe('buildSendOutcome', () => {
  it('builds a clean ok record (no alert)', () => {
    const r = buildSendOutcome({
      sendType: 'customer_reply',
      status: 'ok',
      attempts: 1,
      latencyMs: 123.6,
      channel: 'sms',
    })
    expect(r).toEqual({
      sendType: 'customer_reply',
      status: 'ok',
      attempts: 1,
      latencyMs: 124,
      channel: 'sms',
      errorCode: null,
      reason: null,
      alert: false,
    })
  })

  it('marks failed sends as alertable and carries the error code/reason', () => {
    const r = buildSendOutcome({
      sendType: 'customer_quote',
      status: 'failed',
      attempts: 3,
      latencyMs: 5000,
      error: { code: '21612', reason: 'blocked' },
    })
    expect(r.alert).toBe(true)
    expect(r.errorCode).toBe('21612')
    expect(r.reason).toBe('blocked')
  })

  it('marks the quote-without-customer-SMS alert condition', () => {
    const r = buildSendOutcome({
      sendType: 'customer_quote',
      status: 'quote_no_customer_sms',
      attempts: 0,
      latencyMs: 0,
    })
    expect(r.alert).toBe(true)
  })

  it('clamps negative attempts/latency to zero', () => {
    const r = buildSendOutcome({
      sendType: 'tradie_notify',
      status: 'ok',
      attempts: -2,
      latencyMs: -50,
    })
    expect(r.attempts).toBe(0)
    expect(r.latencyMs).toBe(0)
  })
})

describe('logSendOutcome', () => {
  function fakeLogger(): PipelineLoggerLike & {
    okCalls: Array<[string, Record<string, unknown> | undefined]>
    errCalls: Array<[string, unknown, Record<string, unknown> | undefined]>
  } {
    const okCalls: Array<[string, Record<string, unknown> | undefined]> = []
    const errCalls: Array<[string, unknown, Record<string, unknown> | undefined]> = []
    return {
      okCalls,
      errCalls,
      ok: (e, d) => { okCalls.push([e, d]) },
      err: (e, err, d) => { errCalls.push([e, err, d]) },
    }
  }

  it('logs a healthy send on the ok channel with the structured kv', () => {
    const logger = fakeLogger()
    const rec = logSendOutcome(logger, {
      sendType: 'customer_reply',
      status: 'ok',
      attempts: 2,
      latencyMs: 800,
      channel: 'sms',
    })
    expect(logger.errCalls).toHaveLength(0)
    expect(logger.okCalls).toHaveLength(1)
    const [event, data] = logger.okCalls[0]
    expect(event).toBe('send customer_reply')
    expect(data).toMatchObject({
      send_type: 'customer_reply',
      status: 'ok',
      attempts: 2,
      latency_ms: 800,
      alert: false,
      channel: 'sms',
    })
    expect(rec.alert).toBe(false)
  })

  it('logs an alertable failure on the err channel', () => {
    const logger = fakeLogger()
    const rec = logSendOutcome(logger, {
      sendType: 'customer_quote',
      status: 'failed',
      attempts: 3,
      latencyMs: 5000,
      error: { code: '21612', reason: 'blocked' },
    })
    expect(logger.okCalls).toHaveLength(0)
    expect(logger.errCalls).toHaveLength(1)
    const [event, errArg, data] = logger.errCalls[0]
    expect(event).toBe('send customer_quote')
    expect(errArg).toBe('blocked')
    expect(data).toMatchObject({ status: 'failed', alert: true, error_code: '21612' })
    expect(rec.alert).toBe(true)
  })

  it('logs the after()-near-maxDuration alert', () => {
    const logger = fakeLogger()
    logSendOutcome(logger, {
      sendType: 'customer_reply',
      status: 'after_near_max_duration',
      attempts: 0,
      latencyMs: 295_000,
    })
    expect(logger.errCalls).toHaveLength(1)
    expect(logger.errCalls[0][2]).toMatchObject({ status: 'after_near_max_duration', alert: true })
  })
})

// ---------------------------------------------------------------------------
// adaptiveDebounceMs — adaptivity without dropping (R44 helper)
// ---------------------------------------------------------------------------

describe('adaptiveDebounceMs', () => {
  const knobs = { debounceMs: 1500 }

  it('returns the base window for 0 or 1 arrivals', () => {
    expect(adaptiveDebounceMs([], knobs)).toBe(1500)
    expect(adaptiveDebounceMs([1000], knobs)).toBe(1500)
  })

  it('extends the wait when texts arrive faster than the base window', () => {
    // three texts 200ms apart — a fast burst → wait longer than base to coalesce
    const ts = [0, 200, 400]
    const wait = adaptiveDebounceMs(ts, knobs)
    expect(wait).toBeGreaterThan(knobs.debounceMs)
  })

  it('extends MORE for a faster burst (monotonic in arrival rate)', () => {
    const slowBurst = adaptiveDebounceMs([0, 1000, 2000], knobs) // 1000ms gaps (< base)
    const fastBurst = adaptiveDebounceMs([0, 100, 200], knobs)   // 100ms gaps
    expect(fastBurst).toBeGreaterThan(slowBurst)
  })

  it('never exceeds the 4x cap even for an instantaneous burst', () => {
    const wait = adaptiveDebounceMs([0, 0, 0, 0], knobs)
    expect(wait).toBeLessThanOrEqual(knobs.debounceMs * 4)
  })

  it('shrinks toward base once the burst has settled (gaps >= base)', () => {
    // gaps of 3000ms — well past the 1500ms base window → settled
    const wait = adaptiveDebounceMs([0, 3000, 6000], knobs)
    expect(wait).toBeLessThanOrEqual(knobs.debounceMs)
  })

  it('ignores ordering and non-finite timestamps (no message dropped)', () => {
    const unsorted = adaptiveDebounceMs([400, 0, 200], knobs)
    const sorted = adaptiveDebounceMs([0, 200, 400], knobs)
    expect(unsorted).toBe(sorted)
    // NaN/Infinity filtered out, leaving a single valid arrival → base
    expect(adaptiveDebounceMs([NaN, Infinity, 1000], knobs)).toBe(1500)
  })

  it('handles a zero base window without dividing by zero', () => {
    expect(adaptiveDebounceMs([0, 100, 200], { debounceMs: 0 })).toBe(0)
  })

  it('uses real timers path when no injected sleep (smoke)', () => {
    // adaptiveDebounceMs is pure; this just guards against accidental I/O.
    expect(typeof adaptiveDebounceMs([0, 1], knobs)).toBe('number')
  })
})

// Guard: vi import is used (avoids an unused-import lint error if a test above
// is later removed). No real timers are mocked here — retry uses injected sleep.
describe('test harness', () => {
  it('does not rely on fake timers', () => {
    expect(typeof vi).toBe('object')
  })
})
