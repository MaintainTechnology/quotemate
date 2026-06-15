import { describe, it, expect } from 'vitest'
import { buildTradieWelcomeSms, buildTradieIntentStillOpenSms } from './templates'

const appUrl = 'https://quote-mate-rho.vercel.app'

describe('tradie SMS builders — invitation code threading', () => {
  it('welcome: appends &code= when a code is supplied', () => {
    const body = buildTradieWelcomeSms({ appUrl, token: 'abc123', code: 'JON-JUNE-7K2P' })
    expect(body).toContain(`${appUrl}/signup?intent=abc123&code=JON-JUNE-7K2P`)
  })

  it('welcome: omits code param when no code', () => {
    const body = buildTradieWelcomeSms({ appUrl, token: 'abc123' })
    expect(body).toContain(`${appUrl}/signup?intent=abc123`)
    expect(body).not.toContain('&code=')
  })

  it('still-open: appends &code= when a code is supplied', () => {
    const body = buildTradieIntentStillOpenSms({ appUrl, token: 'tok', code: 'QM-PROMO-9X2K' })
    expect(body).toContain(`${appUrl}/signup?intent=tok&code=QM-PROMO-9X2K`)
  })

  it('url-encodes codes (defensive — codes are alnum+dash but encode anyway)', () => {
    const body = buildTradieWelcomeSms({ appUrl, token: 't', code: 'A B' })
    expect(body).toContain('&code=A%20B')
  })
})
