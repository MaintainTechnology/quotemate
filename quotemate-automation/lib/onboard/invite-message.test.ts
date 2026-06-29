import { describe, it, expect } from 'vitest'
import {
  inviteSmsText,
  inviteEmailSubject,
  inviteEmailHtml,
  inviteEmailText,
} from './invite-message'

const INPUT = {
  code: 'MATE2026',
  businessName: 'Pilot Sparky',
  signupUrl: 'https://app.test/signup?code=MATE2026',
}

describe('inviteSmsText', () => {
  it('states the code and the signup link in one line', () => {
    const text = inviteSmsText(INPUT)
    expect(text).toContain('MATE2026')
    expect(text).toContain('https://app.test/signup?code=MATE2026')
    expect(text).toContain('Pilot Sparky')
    expect(text).not.toContain('\n')
  })
})

describe('inviteEmailSubject', () => {
  it('names the inviting business', () => {
    expect(inviteEmailSubject({ businessName: 'Pilot Sparky' })).toBe(
      'Your QuoteMax invite code from Pilot Sparky',
    )
  })
})

describe('inviteEmailText', () => {
  it('includes the code and the link', () => {
    const text = inviteEmailText(INPUT)
    expect(text).toContain('MATE2026')
    expect(text).toContain('https://app.test/signup?code=MATE2026')
    expect(text).toContain('Pilot Sparky')
  })
})

describe('inviteEmailHtml', () => {
  it('renders the code, business, and link', () => {
    const html = inviteEmailHtml(INPUT)
    expect(html).toContain('MATE2026')
    expect(html).toContain('Pilot Sparky')
    expect(html).toContain('https://app.test/signup?code=MATE2026')
    expect(html.startsWith('<!doctype html>')).toBe(true)
  })
  it('escapes HTML-significant characters in the business name', () => {
    const html = inviteEmailHtml({ ...INPUT, businessName: 'A & B <Co>' })
    expect(html).toContain('A &amp; B &lt;Co&gt;')
    expect(html).not.toContain('<Co>')
  })
})
