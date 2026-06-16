import { describe, it, expect } from 'vitest'
import { buildSolarTradieNotification, buildSolarCustomerSms, notifySolarEstimate } from './notify'

describe('buildSolarTradieNotification', () => {
  it('names the customer, system size, and the review URL', () => {
    const body = buildSolarTradieNotification({
      tradieFirstName: 'Sam',
      customerName: 'Mia',
      systemKw: 6.6,
      netIncGst: 8019,
      reviewUrl: 'https://app/q/solar/TOKEN123',
      dashboardUrl: 'https://app/dashboard',
    })
    expect(body).toContain('Sam')
    expect(body).toContain('Mia')
    expect(body).toContain('6.6')
    expect(body).toContain('TOKEN123')
    expect(body.toLowerCase()).toContain('confirm')
  })

  it('falls back gracefully when names are missing', () => {
    const body = buildSolarTradieNotification({
      tradieFirstName: null,
      customerName: undefined,
      systemKw: 10,
      netIncGst: 12000,
      reviewUrl: 'https://app/q/solar/T',
      dashboardUrl: 'https://app/dashboard',
    })
    expect(typeof body).toBe('string')
    expect(body.length).toBeGreaterThan(0)
  })

  it('switches to "sent to your customer" wording when released (Path B)', () => {
    const body = buildSolarTradieNotification({
      tradieFirstName: 'Sam',
      customerName: 'Mia',
      systemKw: 6.6,
      netIncGst: 8019,
      reviewUrl: 'https://app/q/solar/TOKEN123',
      dashboardUrl: 'https://app/dashboard',
      released: true,
    })
    expect(body.toLowerCase()).toContain('sent to your customer')
    expect(body).not.toContain('before it goes live')
    expect(body).toContain('TOKEN123')
  })

  it('keeps "confirm before it goes live" wording for a flagged (un-released) estimate', () => {
    const body = buildSolarTradieNotification({
      tradieFirstName: 'Sam',
      customerName: 'Mia',
      systemKw: 6.6,
      netIncGst: 8019,
      reviewUrl: 'https://app/q/solar/TOKEN123',
      dashboardUrl: 'https://app/dashboard',
      released: false,
    })
    expect(body.toLowerCase()).toContain('confirm')
    expect(body).toContain('before it goes live')
  })
})

describe('buildSolarCustomerSms', () => {
  const base = {
    businessName: 'Pilot Solar',
    customerName: 'Mia',
    systemKw: 6.6,
    netIncGst: 8019,
    quoteUrl: 'https://app/q/solar/TOKEN123',
  }

  it('carries the business, system size, net price and quote link', () => {
    const sms = buildSolarCustomerSms({ ...base, pdfUrl: 'https://app/api/q/solar/TOKEN123/pdf' })
    expect(sms).toContain('Hi Mia,')
    expect(sms).toContain('Pilot Solar')
    expect(sms).toContain('6.6 kW')
    expect(sms).toContain('$8,019')
    expect(sms).toContain(base.quoteUrl)
    expect(sms).toContain('PDF copy:')
  })

  it('omits the PDF segment when no PDF was rendered', () => {
    const sms = buildSolarCustomerSms({ ...base, pdfUrl: null })
    expect(sms).not.toContain('PDF copy:')
    expect(sms).toContain(base.quoteUrl)
  })

  it('falls back to a plain greeting without a name', () => {
    const sms = buildSolarCustomerSms({ ...base, customerName: null })
    expect(sms.startsWith('Hi, ')).toBe(true)
  })
})

describe('notifySolarEstimate', () => {
  it('dispatches to the tenant owner mobile and reports ok', async () => {
    const calls: Array<{ to: string; text: string }> = []
    const r = await notifySolarEstimate({
      tenant: { owner_mobile: '+61400000111', owner_first_name: 'Sam', twilio_sms_number: '+61480000000' },
      customerName: 'Mia',
      systemKw: 6.6,
      netIncGst: 8019,
      shareToken: 'TOKEN123',
      appUrl: 'https://app',
      dispatch: async ({ to, text }) => {
        calls.push({ to, text })
        return { ok: true as const, channel: 'sms' as const, sid: 'SM1' }
      },
    })
    expect(r.notified).toBe(true)
    expect(calls).toHaveLength(1)
    expect(calls[0].to).toBe('+61400000111')
    expect(calls[0].text).toContain('TOKEN123')
  })

  it('reports not-notified (never throws) when no mobile is resolvable', async () => {
    const r = await notifySolarEstimate({
      tenant: { owner_mobile: null, owner_first_name: null, twilio_sms_number: null },
      customerName: 'Mia',
      systemKw: 6.6,
      netIncGst: 8019,
      shareToken: 'TOKEN123',
      appUrl: 'https://app',
      dispatch: async () => ({ ok: true as const, channel: 'sms' as const, sid: 'X' }),
    })
    expect(r.notified).toBe(false)
  })

  it('swallows a throwing dispatch and reports not-notified', async () => {
    const r = await notifySolarEstimate({
      tenant: { owner_mobile: '+61400000111', owner_first_name: 'Sam', twilio_sms_number: null },
      customerName: 'Mia',
      systemKw: 6.6,
      netIncGst: 8019,
      shareToken: 'TOKEN123',
      appUrl: 'https://app',
      dispatch: async () => {
        throw new Error('twilio down')
      },
    })
    expect(r.notified).toBe(false)
  })

  it('reports not-notified when dispatch resolves with ok: false', async () => {
    const r = await notifySolarEstimate({
      tenant: { owner_mobile: '+61400000111', owner_first_name: 'Sam', twilio_sms_number: null },
      customerName: 'Mia',
      systemKw: 6.6,
      netIncGst: 8019,
      shareToken: 'TOKEN123',
      appUrl: 'https://app',
      dispatch: async () => ({ ok: false as const }),
    })
    expect(r.notified).toBe(false)
  })
})
