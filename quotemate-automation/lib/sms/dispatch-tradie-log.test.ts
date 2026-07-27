// Spec specs/tradie-booking-notifications.md AC7 — a tradie alert leaves a
// database trace.
//
// Until now dispatchQuoteMessage wrote nothing: customer messages are
// persisted by their callers, tradie alerts by nobody. Not one tradie alert
// exists in sms_messages on any trade, so "did the tradie actually get told?"
// was answerable only by reading the code path — and a silent Twilio drop was
// undetectable. Recording at dispatch covers every caller at once (roofing
// notify, painting, booking-notify, solar, estimate/draft, web-lead).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./tradie-log', () => ({ recordTradieSend: vi.fn(async () => {}) }))

import { dispatchQuoteMessage } from './dispatch'
import { recordTradieSend } from './tradie-log'

const ENV = { ...process.env }

beforeEach(() => {
  process.env.TWILIO_ACCOUNT_SID = 'AC_test'
  process.env.TWILIO_AUTH_TOKEN = 'tok_test'
  process.env.TWILIO_PHONE_NUMBER = '+61481613464'
  vi.mocked(recordTradieSend).mockClear()
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      new Response(
        JSON.stringify({ sid: 'SM_ok', status: 'queued', to: '+61400111222', from: '+61468048422', body: 'x', error_code: null }),
        { status: 201 },
      ),
    ),
  )
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  process.env = { ...ENV }
})

describe('AC7 tradie sends are recorded', () => {
  it('records a tradie send with recipient, body and the Twilio sid', async () => {
    const r = await dispatchQuoteMessage({
      to: '+61400111222',
      text: 'Hi Jeph - roofing job BOOKED via SMS for Fri, 31 July, 12:00pm.',
      from: '+61468048422',
      audience: 'tradie',
    })
    expect(r.ok).toBe(true)
    expect(recordTradieSend).toHaveBeenCalledTimes(1)
    expect(vi.mocked(recordTradieSend).mock.calls[0][0]).toMatchObject({
      to: '+61400111222',
      body: 'Hi Jeph - roofing job BOOKED via SMS for Fri, 31 July, 12:00pm.',
      ok: true,
      sid: 'SM_ok',
    })
  })

  it('records a FAILED tradie send too — a silent drop is the thing to catch', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ code: 21610, message: 'unsubscribed' }), { status: 400 }),
      ),
    )
    const r = await dispatchQuoteMessage({
      to: '+61400111222',
      text: 'alert',
      from: '+61468048422',
      audience: 'tradie',
    })
    expect(r.ok).toBe(false)
    expect(recordTradieSend).toHaveBeenCalledTimes(1)
    expect(vi.mocked(recordTradieSend).mock.calls[0][0]).toMatchObject({ ok: false })
  })

  it('does NOT record customer sends — those are persisted by their callers', async () => {
    await dispatchQuoteMessage({ to: '+61414530836', text: 'your quote', audience: 'customer' })
    await dispatchQuoteMessage({ to: '+61414530836', text: 'your quote' })
    expect(recordTradieSend).not.toHaveBeenCalled()
  })

  it('a failed recording never fails the send', async () => {
    vi.mocked(recordTradieSend).mockRejectedValueOnce(new Error('db down'))
    const r = await dispatchQuoteMessage({
      to: '+61400111222',
      text: 'alert',
      from: '+61468048422',
      audience: 'tradie',
    })
    expect(r.ok).toBe(true)
  })
})
