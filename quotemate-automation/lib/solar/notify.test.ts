import { describe, it, expect } from 'vitest'
import { buildSolarTradieNotification, notifySolarEstimate } from './notify'

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
})
