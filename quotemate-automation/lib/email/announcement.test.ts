import { describe, expect, it } from 'vitest'
import { renderAnnouncementEmail, type AnnouncementParams } from '@/lib/email/announcement'

const base = (): AnnouncementParams => ({
  tenant: {
    business_name: 'Pilot Sparky Electrical',
    business_address: '12 Wattle St, Sydney NSW 2000',
    twilio_sms_number: '+61481613464',
    contact_name: 'Jordan',
  },
  recipientFirstName: 'Alex',
  intakeUrl: 'https://quote-mate-rho.vercel.app/start/tenant-1',
  qrDataUrl: 'data:image/png;base64,AAAA',
  unsubscribeUrl: 'https://quote-mate-rho.vercel.app/api/email/unsubscribe/tok.sig',
})

describe('renderAnnouncementEmail', () => {
  it('includes every required element (R8 + R10)', () => {
    const { subject, html, text } = renderAnnouncementEmail(base())
    expect(subject).toContain('Pilot Sparky Electrical')
    for (const out of [html, text]) {
      expect(out).toContain('Pilot Sparky Electrical') // business name
      expect(out).toContain('12 Wattle St, Sydney NSW 2000') // physical address (R10)
      expect(out).toContain('+61481613464') // twilio number
      expect(out).toContain('https://quote-mate-rho.vercel.app/start/tenant-1') // intake CTA
      expect(out).toContain('unsubscribe/tok.sig') // unsubscribe link (R10)
    }
    expect(html).toContain('data:image/png;base64,AAAA') // QR image embedded
    expect(html).toContain('<img') // rendered as an image tag
  })

  it('greets by recipient first name, falling back to "there"', () => {
    expect(renderAnnouncementEmail(base()).text).toContain('Hi Alex,')
    const noName = renderAnnouncementEmail({ ...base(), recipientFirstName: null })
    expect(noName.text).toContain('Hi there,')
  })

  it('signs off with contact_name, falling back to business name', () => {
    const p = base()
    p.tenant.contact_name = null
    expect(renderAnnouncementEmail(p).text).toContain('Pilot Sparky Electrical')
  })

  it('HTML-escapes tenant-controlled fields to prevent markup injection', () => {
    const p = base()
    p.tenant.business_name = 'Bob & Sons <script>alert(1)</script>'
    const { html } = renderAnnouncementEmail(p)
    expect(html).toContain('Bob &amp; Sons')
    expect(html).not.toContain('<script>alert(1)</script>')
  })

  it('throws when the physical address is missing (compliance backstop)', () => {
    const p = base()
    p.tenant.business_address = null
    expect(() => renderAnnouncementEmail(p)).toThrow(/business address/)
  })

  it('throws when the Twilio number is missing', () => {
    const p = base()
    p.tenant.twilio_sms_number = '   '
    expect(() => renderAnnouncementEmail(p)).toThrow(/Twilio phone number/)
  })

  it('throws when the unsubscribe URL is missing', () => {
    const p = base()
    p.unsubscribeUrl = ''
    expect(() => renderAnnouncementEmail(p)).toThrow(/unsubscribe URL/)
  })

  it('throws when the business name is missing', () => {
    const p = base()
    p.tenant.business_name = null
    expect(() => renderAnnouncementEmail(p)).toThrow(/business name/)
  })
})
