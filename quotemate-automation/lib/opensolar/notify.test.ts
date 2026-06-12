import { describe, expect, it } from 'vitest'
import { buildOpenSolarCustomerSms } from './notify'

describe('buildOpenSolarCustomerSms', () => {
  it('builds the full message with name, price and pdf', () => {
    const sms = buildOpenSolarCustomerSms({
      businessName: 'Solar Safari Pty Ltd',
      customerName: 'Sam',
      title: 'System 1 (6.21 kW)',
      totalFormatted: '$8,990.00',
      quoteUrl: 'https://app/q/opensolar/tok',
      pdfUrl: 'https://app/api/q/opensolar/tok/pdf',
    })
    expect(sms).toBe(
      'Hi Sam, your solar proposal from Solar Safari Pty Ltd is ready: ' +
        'System 1 (6.21 kW) — $8,990.00 inc GST. View it: https://app/q/opensolar/tok' +
        ' · PDF copy: https://app/api/q/opensolar/tok/pdf',
    )
  })

  it('degrades gracefully without name/price/pdf', () => {
    const sms = buildOpenSolarCustomerSms({
      businessName: 'Solar Safari Pty Ltd',
      title: null,
      totalFormatted: null,
      quoteUrl: 'https://app/q/opensolar/tok',
    })
    expect(sms).toBe(
      'Hi, your solar proposal from Solar Safari Pty Ltd is ready: ' +
        'your solar proposal. View it: https://app/q/opensolar/tok',
    )
  })
})
