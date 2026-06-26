import { describe, expect, it } from 'vitest'
import { renderWelcomeEmail, type WelcomeEmailParams } from '@/lib/email/welcome'

const base = (): WelcomeEmailParams => ({
  tenant: {
    business_name: 'Pilot Sparky Electrical',
    owner_first_name: 'Alex',
    twilio_sms_number: '+61481613464',
    trades: ['electrical'],
  },
  dashboardUrl: 'https://quote-mate-rho.vercel.app/dashboard',
})

describe('renderWelcomeEmail', () => {
  it('includes the welcome framing, business name, and dashboard CTA in both html and text', () => {
    const { subject, html, text } = renderWelcomeEmail(base())
    expect(subject).toContain('Welcome to QuoteMax')
    expect(subject).toContain('Pilot Sparky Electrical')
    for (const out of [html, text]) {
      expect(out).toContain('Welcome to QuoteMax')
      expect(out).toContain('Pilot Sparky Electrical')
      expect(out).toContain('https://quote-mate-rho.vercel.app/dashboard')
    }
    // The CTA is a real anchor to the dashboard.
    expect(html).toContain('href="https://quote-mate-rho.vercel.app/dashboard"')
  })

  it('shows the provisioned QuoteMax number, formatted, when present', () => {
    const { html, text } = renderWelcomeEmail(base())
    for (const out of [html, text]) {
      expect(out).toContain('+61 481 613 464') // formatted AU mobile
    }
    expect(html).toContain('Your QuoteMax number')
  })

  it('omits the phone block entirely when no number is provisioned yet', () => {
    const p = base()
    p.tenant.twilio_sms_number = null
    const { html, text } = renderWelcomeEmail(p)
    expect(html).not.toContain('Your QuoteMax number')
    expect(text).not.toContain('Your QuoteMax number')
  })

  it('greets by first name, falling back to "mate"', () => {
    expect(renderWelcomeEmail(base()).text).toContain("G'day Alex,")
    const noName = renderWelcomeEmail({ ...base(), tenant: { ...base().tenant, owner_first_name: null } })
    expect(noName.text).toContain("G'day mate,")
  })

  it('personalises the trades phrase, joining multi-trade tenants with an ampersand', () => {
    const multi = renderWelcomeEmail({
      ...base(),
      tenant: { ...base().tenant, trades: ['electrical', 'plumbing'] },
    })
    expect(multi.text).toContain('Electrical & Plumbing')
    // single trade still title-cases
    expect(renderWelcomeEmail(base()).text).toContain('Electrical')
  })

  it('HTML-escapes tenant-controlled fields to prevent markup injection', () => {
    const p = base()
    p.tenant.business_name = 'Bob & Sons <script>alert(1)</script>'
    const { html } = renderWelcomeEmail(p)
    expect(html).toContain('Bob &amp; Sons')
    expect(html).not.toContain('<script>alert(1)</script>')
  })

  it('uses the Caterpillar brand palette (charcoal canvas + yellow accent)', () => {
    const { html } = renderWelcomeEmail(base())
    expect(html).toContain('#16120F') // ink-deep canvas
    expect(html).toContain('#FFC400') // Caterpillar yellow accent
  })

  it('throws when the business name is missing', () => {
    const p = base()
    p.tenant.business_name = null
    expect(() => renderWelcomeEmail(p)).toThrow(/business name/)
  })

  it('throws when the dashboard URL is missing', () => {
    const p = base()
    p.dashboardUrl = '   '
    expect(() => renderWelcomeEmail(p)).toThrow(/dashboard URL/)
  })
})
