import { describe, expect, it } from 'vitest'
import { buildPylonCustomerSms } from './notify'

describe('buildPylonCustomerSms', () => {
  it('carries business, title, price, quote + pdf links', () => {
    const body = buildPylonCustomerSms({
      businessName: 'Solar Safari',
      customerName: 'Hubert',
      title: '13.2kW Solar system',
      totalFormatted: '$7,600.00',
      quoteUrl: 'https://x/q/pylon/tok',
      pdfUrl: 'https://x/api/q/pylon/tok/pdf',
    })
    expect(body).toContain('Hi Hubert,')
    expect(body).toContain('Solar Safari')
    expect(body).toContain('13.2kW Solar system')
    expect(body).toContain('$7,600.00 inc GST')
    expect(body).toContain('https://x/q/pylon/tok')
    expect(body).toContain('PDF copy: https://x/api/q/pylon/tok/pdf')
  })

  it('degrades without name / title / price / pdf', () => {
    const body = buildPylonCustomerSms({
      businessName: 'Solar Safari',
      title: null,
      totalFormatted: null,
      quoteUrl: 'https://x/q/pylon/tok',
    })
    expect(body.startsWith('Hi, ')).toBe(true)
    expect(body).toContain('your solar proposal')
    expect(body).not.toContain('inc GST')
    expect(body).not.toContain('PDF copy')
  })
})
