import { describe, it, expect } from 'vitest'
import {
  generateShortCode,
  slugifyBusinessName,
  resolveDestination,
  SHORT_CODE_ALPHABET,
} from './qr'

describe('generateShortCode', () => {
  it('produces a 6-char code from the unambiguous alphabet', () => {
    for (let i = 0; i < 50; i++) {
      const code = generateShortCode()
      expect(code).toHaveLength(6)
      for (const ch of code) expect(SHORT_CODE_ALPHABET).toContain(ch)
    }
  })
  it('honours a custom length', () => {
    expect(generateShortCode(8)).toHaveLength(8)
  })
})

describe('slugifyBusinessName', () => {
  it('lowercases and hyphenates', () => {
    expect(slugifyBusinessName('Atomic Electrical')).toBe('atomic-electrical')
    expect(slugifyBusinessName("Pepper's Plumbing!")).toBe('peppers-plumbing')
  })
  it('collapses runs and trims dashes', () => {
    expect(slugifyBusinessName('  A & B   Co  ')).toBe('a-b-co')
  })
  it('caps length at 40', () => {
    expect(slugifyBusinessName('x'.repeat(80)).length).toBeLessThanOrEqual(40)
  })
  it('falls back to "tradie" for empty input', () => {
    expect(slugifyBusinessName('!!!')).toBe('tradie')
  })
})

describe('resolveDestination', () => {
  const appUrl = 'https://quote-mate-rho.vercel.app'
  const tenant = { slug: 'atomic-electrical', twilio_sms_number: '+61468011464' }

  it('landing → a 302-able /t/<slug> url with qr attribution', () => {
    const qr = { short_code: 'aB3xK9', destination_type: 'landing' as const, destination_config: {} }
    const r = resolveDestination(qr, tenant, appUrl)
    expect(r).toEqual({ kind: 'landing', url: `${appUrl}/t/atomic-electrical?qr=aB3xK9` })
  })

  it('sms → an sms: uri with the prefill body encoded', () => {
    const qr = { short_code: 'aB3xK9', destination_type: 'sms' as const, destination_config: { prefill_body: "Hi, I'd like a quote" } }
    const r = resolveDestination(qr, tenant, appUrl)
    expect(r.kind).toBe('sms')
    if (r.kind === 'sms') {
      expect(r.number).toBe('+61468011464')
      expect(r.smsUri).toBe("sms:+61468011464?&body=Hi%2C%20I'd%20like%20a%20quote")
    }
  })

  it('sms with no prefill → bare sms: uri', () => {
    const qr = { short_code: 'x', destination_type: 'sms' as const, destination_config: {} }
    const r = resolveDestination(qr, tenant, appUrl)
    if (r.kind === 'sms') expect(r.smsUri).toBe('sms:+61468011464')
  })

  it('landing with no slug → falls back to app home', () => {
    const qr = { short_code: 'x', destination_type: 'landing' as const, destination_config: {} }
    const r = resolveDestination(qr, { slug: null, twilio_sms_number: null }, appUrl)
    expect(r).toEqual({ kind: 'landing', url: appUrl })
  })
})
