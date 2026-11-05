import { describe, expect, it } from 'vitest'
import { buildQuoteSms, buildQuoteUpdatedSms } from './templates'

const intake = {
  job_type: 'ev_charger',
  caller: { name: 'Steve' },
  scope: {
    description: 'Supply one EV charger. Installation is excluded.',
    specs: { service_mode: 'supply_only', supplied_by: 'tradie' },
  },
}

const quote = {
  good: null,
  better: {
    label: '7kW EV charger unit',
    subtotal_ex_gst: 800,
    line_items: [{
      description: '7kW EV charger unit', quantity: 1, unit: 'each',
      unit_price_ex_gst: 800, total_ex_gst: 800,
    }],
  },
  best: null,
  selected_tier: 'better' as const,
  scope_of_works: 'Supply one 7kW EV charger. Installation and electrical work are excluded.',
  scope_short: '7kW EV charger supply only',
  assumptions: [],
  estimated_timeframe: '1-2 business days',
  needs_inspection: false,
  quote_view_url: 'https://quotemax.test/q/tok',
  pay_links: {
    better: 'https://quotemax.test/r/tok/better',
    inspection: 'https://quotemax.test/r/tok/inspection',
  },
  deposit_pct: 30,
}

describe('EV charger supply-only quote SMS', () => {
  it.each([buildQuoteSms, buildQuoteUpdatedSms])('uses the product payment and never offers a site visit', (build) => {
    const body = build(intake, quote, { trade: 'electrical', tierMode: 'single' })
    expect(body).toContain('Tap to pay: https://quotemax.test/r/tok/better')
    expect(body).toMatch(/charger order/i)
    expect(body).toMatch(/delivery or collection/i)
    expect(body).not.toContain('/inspection')
    expect(body).not.toMatch(/\$99|site visit|book you in/i)
  })
})
