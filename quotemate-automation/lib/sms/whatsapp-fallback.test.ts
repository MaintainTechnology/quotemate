// US-008 — the WhatsApp fallback always sends from the global
// TWILIO_WHATSAPP_FROM (a WhatsApp sender can't be a tenant long code).
// For a tenant-number thread that means a failed SMS was re-sent to the
// customer from a STRANGER'S number (2026-07-23 audit). The fallback is
// now allowed only when the reply wasn't meant to come from a tenant's
// own number: no custom `from`, or `from` is the platform's own number.
// Stubs global fetch — no network.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { dispatchQuoteMessage, whatsappFallbackAllowed } from './dispatch'

const ENV = { ...process.env }

const PLATFORM_SMS = '+61481613464'
const TENANT_FROM = '+61468011464'

function permanentFailure() {
  return new Response(JSON.stringify({ code: 12300, message: 'invalid content' }), { status: 400 })
}
function waOk() {
  return new Response(
    JSON.stringify({ sid: 'WA_test', status: 'queued', to: 'whatsapp:+61400000000', from: 'whatsapp:+14155238886', body: 'x', error_code: null }),
    { status: 201 },
  )
}

beforeEach(() => {
  process.env.TWILIO_ACCOUNT_SID = 'AC_test'
  process.env.TWILIO_AUTH_TOKEN = 'tok_test'
  process.env.TWILIO_PHONE_NUMBER = PLATFORM_SMS
  process.env.TWILIO_SMS_NUMBER = PLATFORM_SMS
  process.env.TWILIO_WHATSAPP_FROM = 'whatsapp:+14155238886'
})
afterEach(() => {
  vi.unstubAllGlobals()
  process.env = { ...ENV }
})

describe('whatsappFallbackAllowed', () => {
  it('allowed with no custom from, or the platform number itself', () => {
    expect(whatsappFallbackAllowed(undefined)).toBe(true)
    expect(whatsappFallbackAllowed(PLATFORM_SMS)).toBe(true)
  })
  it('blocked for a tenant-provisioned from', () => {
    expect(whatsappFallbackAllowed(TENANT_FROM)).toBe(false)
  })
})

describe('dispatchQuoteMessage — WhatsApp fallback scoping', () => {
  it('tenant-number thread: failed SMS does NOT fall back to WhatsApp', async () => {
    const fetchMock = vi.fn().mockResolvedValue(permanentFailure())
    vi.stubGlobal('fetch', fetchMock)
    const r = await dispatchQuoteMessage({ to: '+61400000000', text: 'quote', from: TENANT_FROM })
    expect(r.ok).toBe(false)
    // Every request must be plain SMS — none may carry a whatsapp: sender.
    for (const call of fetchMock.mock.calls) {
      const body = (call[1] as { body?: string } | undefined)?.body ?? ''
      expect(decodeURIComponent(body)).not.toContain('whatsapp:')
    }
  })

  it('shared/dev-number thread keeps the WhatsApp fallback', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string, init?: { body?: string }) => {
      const body = decodeURIComponent(init?.body ?? '')
      return Promise.resolve(body.includes('whatsapp:') ? waOk() : permanentFailure())
    })
    vi.stubGlobal('fetch', fetchMock)
    const r = await dispatchQuoteMessage({ to: '+61400000000', text: 'quote', from: PLATFORM_SMS })
    expect(r.ok).toBe(true)
    expect(r.ok && r.channel).toBe('whatsapp')
  })
})
