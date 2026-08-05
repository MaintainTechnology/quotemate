// Where inbound SMS is delivered — the one decision the 2026-08-05 cutover
// turns on.
//
// This exists to catch a specific, likely regression: `${appUrl}/api/sms/inbound`
// reads like the obviously-correct value and was what all four call sites used
// before the cutover. Anyone "tidying up" back to it would silently provision
// new tenants onto the in-app receptionist, which is now disabled — a number
// born dead, with no error anywhere. The health check would report it healthy
// too, since it compared against the same wrong constant.

import { afterEach, describe, expect, it } from 'vitest'
import { smsWebhookUrl } from './provision'

const FRONT_DESK = 'https://qm-front-desk-production.up.railway.app/api/sms/inbound'

describe('smsWebhookUrl', () => {
  afterEach(() => {
    delete process.env.SMS_WEBHOOK_URL
    delete process.env.APP_URL
    delete process.env.NEXT_PUBLIC_APP_URL
  })

  it('defaults to the Front Desk', () => {
    expect(smsWebhookUrl()).toBe(FRONT_DESK)
  })

  it('NEVER derives from APP_URL — the in-app receptionist is retired', () => {
    process.env.APP_URL = 'https://www.quotemax.com.au'
    process.env.NEXT_PUBLIC_APP_URL = 'https://www.quotemax.com.au'
    const url = smsWebhookUrl()
    expect(url).toBe(FRONT_DESK)
    expect(url).not.toContain('quotemax.com.au')
  })

  it('honours SMS_WEBHOOK_URL so the Front Desk can move (or the cutover be reversed)', () => {
    process.env.SMS_WEBHOOK_URL = 'https://frontdesk.example.com/api/sms/inbound'
    expect(smsWebhookUrl()).toBe('https://frontdesk.example.com/api/sms/inbound')
  })

  it('treats an EMPTY override as unset rather than as a blank URL', () => {
    // `??` would return '' here and Twilio would be handed a blank SmsUrl,
    // silently un-routing the number. `||` is load-bearing.
    process.env.SMS_WEBHOOK_URL = ''
    expect(smsWebhookUrl()).toBe(FRONT_DESK)
  })
})
