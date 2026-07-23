// resolveOutboundFromNumber — ONE policy for which number an outbound
// customer message originates from (2026-07-23).
//
// Live incident: a caller rang Sparky's provisioned number, the call died,
// and the "didn't catch enough" SMS arrived from the PLATFORM's env-default
// number (+614890833xx) — a stranger's number as far as the customer is
// concerned. Voice-sourced sends had `from: undefined` "to preserve prior
// behaviour" from before tenants owned numbers. Policy now: the tenant's
// number wins on EVERY channel; env fallbacks only for legacy tenant-less
// traffic (SMS → TWILIO_SMS_NUMBER; voice → dispatch default).

import { afterEach, describe, expect, it } from 'vitest'
import { resolveOutboundFromNumber } from './outbound-from'

const ORIGINAL_ENV = { ...process.env }

afterEach(() => {
  process.env = { ...ORIGINAL_ENV }
})

describe('resolveOutboundFromNumber', () => {
  it('tenant number wins for voice-sourced sends', () => {
    expect(
      resolveOutboundFromNumber({ tenantSmsNumber: '+61468048422', sourceChannel: 'voice' }),
    ).toBe('+61468048422')
  })

  it('tenant number wins for sms-sourced sends', () => {
    expect(
      resolveOutboundFromNumber({ tenantSmsNumber: '+61468048422', sourceChannel: 'sms' }),
    ).toBe('+61468048422')
  })

  it('legacy sms (no tenant) falls back to TWILIO_SMS_NUMBER', () => {
    process.env.TWILIO_SMS_NUMBER = '+61481613464'
    expect(
      resolveOutboundFromNumber({ tenantSmsNumber: null, sourceChannel: 'sms' }),
    ).toBe('+61481613464')
  })

  it('legacy voice (no tenant) returns undefined so dispatch uses its default', () => {
    expect(
      resolveOutboundFromNumber({ tenantSmsNumber: null, sourceChannel: 'voice' }),
    ).toBeUndefined()
  })
})
