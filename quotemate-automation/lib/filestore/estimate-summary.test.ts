import { describe, expect, it } from 'vitest'
import type { PricedBom } from '../estimation/price'
import { electricalEstimateSummaryText } from './estimate-summary'

const bom: PricedBom = {
  lines: [
    {
      type: 'double GPO',
      count: 12,
      matched: 'Double power point',
      unitPriceExGst: 45,
      materialExGst: 540,
      labourHours: 6,
      labourExGst: 660,
      lineExGst: 1200,
      trace: {} as PricedBom['lines'][number]['trace'],
    },
  ],
  unmatched: [{ type: 'EV charger', count: 1 }],
  materialExGst: 540,
  labourExGst: 660,
  labourFloorAddedExGst: 0,
  subtotalExGst: 1200,
  gstExGst: 120,
  totalIncGst: 1320,
  gstRegistered: true,
  assumptions: { hourlyRate: 110, markupPct: 30, minLabourHours: 2 },
}

describe('electricalEstimateSummaryText', () => {
  it('lists priced lines with the matched assembly and line total', () => {
    const text = electricalEstimateSummaryText(bom)
    expect(text).toContain('12 × double GPO (matched to "Double power point")')
    expect(text).toContain('line total $1,200 ex GST')
  })

  it('lists unmatched items separately', () => {
    const text = electricalEstimateSummaryText(bom)
    expect(text).toContain('Items with no catalogue match')
    expect(text).toContain('1 × EV charger')
  })

  it('includes totals and assumptions', () => {
    const text = electricalEstimateSummaryText(bom, { jobLabel: 'Smith rewire', pricedAt: '2026-06-16T00:00:00Z' })
    expect(text).toContain('Job: Smith rewire')
    expect(text).toContain('Total inc GST: $1,320')
    expect(text).toContain('hourly rate $110')
    expect(text).toContain('markup 30%')
    expect(text).toContain('GST registered.')
  })

  it('handles an empty BOM without throwing', () => {
    const empty: PricedBom = {
      lines: [],
      unmatched: [],
      materialExGst: 0,
      labourExGst: 0,
      labourFloorAddedExGst: 0,
      subtotalExGst: 0,
      gstExGst: 0,
      totalIncGst: 0,
      gstRegistered: false,
      assumptions: { hourlyRate: 0, markupPct: 0, minLabourHours: 0 },
    }
    const text = electricalEstimateSummaryText(empty)
    expect(text).toContain('(no priced lines)')
    expect(text).toContain('Not GST registered.')
  })
})
