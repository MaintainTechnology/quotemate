// Unit coverage for the route-level send orchestration (R46-sends + R48).
//
// These functions are the PURE seam extracted from the estimate/draft after()
// block so the retry/backoff + outcome-classification policy is testable
// without mocking Twilio/supabase/next. The dispatch fn is injected; the clock
// and sleep are injected for determinism.

import { describe, expect, it, vi } from 'vitest'
import type { DispatchResult } from './dispatch'
import {
  classifyDispatchOutcome,
  retryPolicyFromKnobs,
  sendWithRetry,
} from './send-quote-dispatch'
import { DELIVERY_KNOB_DEFAULTS } from './send-reliability'

const KNOBS = DELIVERY_KNOB_DEFAULTS

// A sleep that records the delays it was asked to wait but never waits.
function recordingSleep() {
  const delays: number[] = []
  const sleep = (ms: number) => {
    delays.push(ms)
    return Promise.resolve()
  }
  return { delays, sleep }
}

const okSms: DispatchResult = { ok: true, channel: 'sms', sid: 'SM1', status: 'queued', smsAttempts: 1 }
const okWa: DispatchResult = { ok: true, channel: 'whatsapp', sid: 'WA1', status: 'queued' }
function failBoth(code = '500'): DispatchResult {
  return {
    ok: false,
    smsAttempt: { code, reason: `sms ${code}` },
    smsAttempts: 4,
    waAttempt: { code: '63016', reason: 'wa undeliverable' },
  }
}
function failTerminal(code = '21610'): DispatchResult {
  return {
    ok: false,
    smsAttempt: { code, reason: `sms ${code}` },
    smsAttempts: 1,
    waAttempt: { code, reason: 'wa terminal' },
  }
}

// ---------------------------------------------------------------------------
// classifyDispatchOutcome
// ---------------------------------------------------------------------------

describe('classifyDispatchOutcome', () => {
  it('maps an SMS success to status ok on the sms channel', () => {
    const o = classifyDispatchOutcome('customer_quote', okSms, 1, 42)
    expect(o).toMatchObject({ sendType: 'customer_quote', status: 'ok', attempts: 1, latencyMs: 42, channel: 'sms' })
    expect(o.error).toBeUndefined()
  })

  it('maps a WhatsApp success to the alert-worthy-but-delivered fallback status', () => {
    const o = classifyDispatchOutcome('customer_quote', okWa, 2, 10)
    expect(o.status).toBe('fallback')
    expect(o.channel).toBe('whatsapp')
  })

  it('maps a both-channels failure to failed, carrying the WhatsApp (most proximate) error', () => {
    const o = classifyDispatchOutcome('tradie_notify', failBoth('502'), 3, 99)
    expect(o.status).toBe('failed')
    expect(o.channel).toBeNull()
    expect(o.error).toEqual({ code: '63016', reason: 'wa undeliverable' })
  })

  it('falls back to the SMS attempt error when there is no WhatsApp attempt', () => {
    const noWa: DispatchResult = { ok: false, smsAttempt: { code: '500', reason: 'boom' }, smsAttempts: 4 }
    const o = classifyDispatchOutcome('customer_quote', noWa, 4, 1)
    expect(o.error).toEqual({ code: '500', reason: 'boom' })
  })
})

// ---------------------------------------------------------------------------
// retryPolicyFromKnobs
// ---------------------------------------------------------------------------

describe('retryPolicyFromKnobs', () => {
  it('threads the knob values into the retry policy', () => {
    const p = retryPolicyFromKnobs({ ...KNOBS, sendRetries: 5, sendBaseDelayMs: 250, sendMaxDelayMs: 8000 })
    expect(p.retries).toBe(5)
    expect(p.baseDelayMs).toBe(250)
    expect(p.maxDelayMs).toBe(8000)
    expect(typeof p.isRetryable).toBe('function')
  })
})

// ---------------------------------------------------------------------------
// sendWithRetry — the heart of R46
// ---------------------------------------------------------------------------

describe('sendWithRetry', () => {
  it('returns ok on first try without sleeping', async () => {
    const { delays, sleep } = recordingSleep()
    const fn = vi.fn(async () => okSms)
    const r = await sendWithRetry('customer_quote', fn, { knobs: KNOBS, sleep, now: () => 0 })
    expect(fn).toHaveBeenCalledTimes(1)
    expect(r.attempts).toBe(1)
    expect(r.dispatch).toEqual(okSms)
    expect(r.outcome.status).toBe('ok')
    expect(delays).toEqual([])
  })

  it('retries a TRANSIENT failed DispatchResult up to the knob budget, then reports failed', async () => {
    const { delays, sleep } = recordingSleep()
    const fn = vi.fn(async () => failBoth('503'))
    const r = await sendWithRetry('customer_quote', fn, {
      knobs: { ...KNOBS, sendRetries: 2 },
      sleep,
      now: () => 0,
    })
    // retries=2 ⇒ 3 total dispatch attempts.
    expect(fn).toHaveBeenCalledTimes(3)
    expect(r.attempts).toBe(3)
    expect(delays).toHaveLength(2) // slept before each retry
    expect(r.dispatch?.ok).toBe(false)
    expect(r.outcome.status).toBe('failed')
    // the real Twilio codes survive into the outcome for the alert.
    expect(r.outcome.error).toEqual({ code: '63016', reason: 'wa undeliverable' })
  })

  it('does NOT retry a TERMINAL failed DispatchResult (e.g. STOP 21610)', async () => {
    const { delays, sleep } = recordingSleep()
    const fn = vi.fn(async () => failTerminal('21610'))
    const r = await sendWithRetry('customer_quote', fn, { knobs: KNOBS, sleep, now: () => 0 })
    expect(fn).toHaveBeenCalledTimes(1) // no retry burned on a permanent failure
    expect(r.attempts).toBe(1)
    expect(delays).toEqual([])
    expect(r.outcome.status).toBe('failed')
    expect(r.dispatch?.ok).toBe(false)
  })

  it('recovers when a transient failure is followed by success', async () => {
    const { sleep } = recordingSleep()
    let n = 0
    const fn = vi.fn(async () => (++n === 1 ? failBoth('429') : okSms))
    const r = await sendWithRetry('tradie_notify', fn, { knobs: KNOBS, sleep, now: () => 0 })
    expect(fn).toHaveBeenCalledTimes(2)
    expect(r.dispatch).toEqual(okSms)
    expect(r.outcome.status).toBe('ok')
    expect(r.attempts).toBe(2)
  })

  it('retries a THROWN transient (AbortError) and reports failed with no dispatch when exhausted', async () => {
    const { delays, sleep } = recordingSleep()
    const fn = vi.fn(async () => {
      const e = new Error('aborted')
      e.name = 'AbortError'
      throw e
    })
    const r = await sendWithRetry('customer_quote', fn, {
      knobs: { ...KNOBS, sendRetries: 1 },
      sleep,
      now: () => 0,
    })
    expect(fn).toHaveBeenCalledTimes(2) // first + 1 retry
    expect(delays).toHaveLength(1)
    expect(r.dispatch).toBeNull() // the fn threw — no DispatchResult to carry
    expect(r.outcome.status).toBe('failed')
  })

  it('does NOT retry a THROWN terminal error and never throws out', async () => {
    const { delays, sleep } = recordingSleep()
    const fn = vi.fn(async () => {
      throw new Error('programmer error: cannot read property of undefined')
    })
    const r = await sendWithRetry('customer_quote', fn, { knobs: KNOBS, sleep, now: () => 0 })
    expect(fn).toHaveBeenCalledTimes(1)
    expect(delays).toEqual([])
    expect(r.dispatch).toBeNull()
    expect(r.outcome.status).toBe('failed')
  })

  it('measures latency via the injected clock', async () => {
    // now() is read exactly twice: once for `started`, once for the end.
    const times = [1000, 1350]
    let i = 0
    const now = () => times[Math.min(i++, times.length - 1)]
    const fn = vi.fn(async () => okSms)
    const r = await sendWithRetry('customer_quote', fn, { knobs: KNOBS, now })
    expect(r.outcome.latencyMs).toBe(350)
  })

  it('fires onRetry before each backoff sleep with the scheduled delay', async () => {
    const { sleep } = recordingSleep()
    const onRetry = vi.fn()
    const fn = vi.fn(async () => failBoth('500'))
    await sendWithRetry('customer_quote', fn, {
      knobs: { ...KNOBS, sendRetries: 2, sendBaseDelayMs: 100, sendMaxDelayMs: 10000 },
      sleep,
      now: () => 0,
      onRetry,
    })
    expect(onRetry).toHaveBeenCalledTimes(2)
    // exponential: 100 then 200 (base * 2^i, no jitter).
    expect(onRetry.mock.calls[0][2]).toBe(100)
    expect(onRetry.mock.calls[1][2]).toBe(200)
  })

  it('honours sendRetries=0 — exactly one attempt, no sleep', async () => {
    const { delays, sleep } = recordingSleep()
    const fn = vi.fn(async () => failBoth('500'))
    const r = await sendWithRetry('customer_quote', fn, {
      knobs: { ...KNOBS, sendRetries: 0 },
      sleep,
      now: () => 0,
    })
    expect(fn).toHaveBeenCalledTimes(1)
    expect(delays).toEqual([])
    expect(r.outcome.status).toBe('failed')
  })
})
