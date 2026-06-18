// R46-sends — dispatch.ts must NEVER throw out of dispatchQuoteMessage, even
// when the underlying sendSms / sendWhatsApp reject (a Vercel teardown /
// undici headers-timeout surfaces as a thrown AbortError, not a Twilio result
// code). Before the throw-guard, that thrown error escaped the retry loop,
// skipped the WhatsApp fallback, and bubbled out of the caller's after()
// block. Here we stub global fetch to THROW and assert the function still
// returns a structured DispatchResult and retried the transient.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { dispatchQuoteMessage } from './dispatch'

const ENV = { ...process.env }

beforeEach(() => {
  process.env.TWILIO_ACCOUNT_SID = 'AC_test'
  process.env.TWILIO_AUTH_TOKEN = 'tok_test'
  process.env.TWILIO_PHONE_NUMBER = '+61481613464'
  process.env.TWILIO_WHATSAPP_FROM = 'whatsapp:+14155238886'
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  process.env = { ...ENV }
})

function okResponse() {
  return new Response(
    JSON.stringify({ sid: 'SM_ok', status: 'queued', to: '+61400000000', from: '+61481613464', body: 'x', error_code: null }),
    { status: 201 },
  )
}

describe('dispatchQuoteMessage — throw guard (never throws)', () => {
  it('treats a thrown AbortError from the SMS send as transient, retries, then succeeds', async () => {
    const abort = () => {
      const e = new Error('The operation was aborted')
      e.name = 'AbortError'
      throw e
    }
    // First fetch throws AbortError; the retry succeeds.
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(abort)
      .mockResolvedValue(okResponse())
    vi.stubGlobal('fetch', fetchMock)

    const r = await dispatchQuoteMessage({ to: '+61400000000', text: 'quote https://q/abc' })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.channel).toBe('sms')
      expect(r.smsAttempts).toBeGreaterThan(1) // it retried the thrown abort
    }
  }, 15000)

  it('returns a DispatchFail (does not throw) when SMS throws every attempt and WhatsApp also throws', async () => {
    const boom = () => {
      const e = new Error('socket hang up')
      e.name = 'AbortError'
      throw e
    }
    const fetchMock = vi.fn().mockImplementation(boom)
    vi.stubGlobal('fetch', fetchMock)

    // Must RESOLVE to a fail, never reject.
    const r = await dispatchQuoteMessage({ to: '+61400000000', text: 'quote https://q/abc' })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      // SMS retried (AbortError is retryable) and WhatsApp was attempted.
      expect(r.smsAttempts).toBeGreaterThan(1)
      expect(r.waAttempt).toBeDefined()
    }
  }, 15000)
})
