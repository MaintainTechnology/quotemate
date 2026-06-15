import { describe, expect, it } from 'vitest'
import { buildPaintCustomerSms, normaliseAuMobile } from './notify'

describe('normaliseAuMobile', () => {
  it('normalises a spaced national mobile to E.164', () => {
    expect(normaliseAuMobile('0412 345 678')).toBe('+61412345678')
  })
  it('normalises a bare national mobile', () => {
    expect(normaliseAuMobile('0412345678')).toBe('+61412345678')
  })
  it('normalises a 61-prefixed number without +', () => {
    expect(normaliseAuMobile('61412345678')).toBe('+61412345678')
  })
  it('normalises a national-significant number (no leading 0)', () => {
    expect(normaliseAuMobile('412345678')).toBe('+61412345678')
  })
  it('passes through a valid +61 mobile', () => {
    expect(normaliseAuMobile('+61 412 345 678')).toBe('+61412345678')
  })
  it('passes through a generic international E.164 number', () => {
    expect(normaliseAuMobile('+14155550123')).toBe('+14155550123')
  })
  it('rejects a landline / non-mobile national number', () => {
    expect(normaliseAuMobile('0212345678')).toBeNull() // Sydney landline (02)
  })
  it('rejects too-short and empty input', () => {
    expect(normaliseAuMobile('0412')).toBeNull()
    expect(normaliseAuMobile('')).toBeNull()
    expect(normaliseAuMobile(null)).toBeNull()
    expect(normaliseAuMobile(undefined)).toBeNull()
  })
})

describe('buildPaintCustomerSms', () => {
  const base = {
    businessName: 'Coastline Painting',
    totalIncGst: 18450.4,
    quoteUrl: 'https://quote-mate-rho.vercel.app/q/abc123',
  }

  it('builds the full body with name, job, total, links and PDF', () => {
    const body = buildPaintCustomerSms({
      ...base,
      customerName: 'Jordan',
      jobName: 'Swan Street warehouse',
      pdfUrl: 'https://quote-mate-rho.vercel.app/api/q/abc123/pdf',
    })
    expect(body).toBe(
      'Hi Jordan, your painting quote from Coastline Painting for Swan Street warehouse is ready: ' +
        '$18,450 inc GST. View the full quote: https://quote-mate-rho.vercel.app/q/abc123 · ' +
        'PDF copy: https://quote-mate-rho.vercel.app/api/q/abc123/pdf — reply to confirm.',
    )
  })

  it('omits the PDF clause when no PDF was produced', () => {
    const body = buildPaintCustomerSms({ ...base, customerName: 'Jordan' })
    expect(body).not.toContain('PDF copy')
    expect(body).toContain('View the full quote: https://quote-mate-rho.vercel.app/q/abc123 — reply to confirm.')
  })

  it('falls back to a generic greeting and no job clause', () => {
    const body = buildPaintCustomerSms(base)
    expect(body.startsWith('Hi, your painting quote from Coastline Painting is ready:')).toBe(true)
  })
})
