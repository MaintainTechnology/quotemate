import { describe, it, expect } from 'vitest'
import { buildPaintQuotePayloads, buildTenderTier } from './save-quote-helpers'
import { buildPaintTenderReportHtml } from './report-html'
import { pricePaintTakeoff } from './price'
import { resolvePaintRates } from './rates'
import type { PaintRateRow, PaintTakeoffItem } from './types'

const ROWS: PaintRateRow[] = [
  { kind: 'labour', code: 'labour:spray_matt:spray', label: 'Spray', system: 'spray_matt', method: 'spray', coverage_m2_per_hr: 25 },
  { kind: 'labour', code: 'labour:low_sheen:roller', label: 'Roller', system: 'low_sheen', method: 'roller', coverage_m2_per_hr: 10 },
  { kind: 'material', code: 'mat:ceiling_spray_matt', label: 'Matt', system: 'spray_matt', product: 'Spray matt', spread_m2_per_l: 12, price_per_l_ex_gst: 10 },
  { kind: 'material', code: 'mat:wall_low_sheen', label: 'LS', system: 'low_sheen', product: 'Low sheen', spread_m2_per_l: 15, price_per_l_ex_gst: 11 },
  { kind: 'modifier', code: 'mod:labour_rate', label: 'rate', value: 75 },
  { kind: 'equipment', code: 'equip:scissor_lift', label: 'Scissor lift', value: 300 },
]

const items: PaintTakeoffItem[] = [
  { surface: 'Retail ceiling', room: 'Retail', substrate: 'concrete', system: 'spray_matt', unit: 'm2', quantity: 420, coats: 2, height_m: 5.2, confidence: 'high', source: 'both' },
  { surface: 'BOH walls', room: 'BOH', substrate: 'plasterboard', system: 'low_sheen', unit: 'm2', quantity: 88.5, coats: 2, confidence: 'high', source: 'both' },
  { surface: 'Fridge window wall', room: 'Retail', substrate: 'plasterboard', system: 'low_sheen', unit: 'm2', quantity: 20, coats: 2, confidence: 'high', source: 'plan', separate_price: true },
]

const bom = pricePaintTakeoff(items, resolvePaintRates(ROWS))

describe('buildTenderTier', () => {
  const tier = buildTenderTier(bom)

  it('carries every priced line + equipment as line items in the established shape', () => {
    // 2 main lines + 1 scissor-lift line (5.2 m ceiling triggers it).
    expect(tier.line_items).toHaveLength(3)
    const lift = tier.line_items.find((l) => l.unit === 'days')!
    expect(lift.description).toContain('Scissor lift')
    for (const li of tier.line_items) {
      expect(li.total_ex_gst).toBeGreaterThan(0)
      expect(li.unit_price_ex_gst).toBeGreaterThan(0)
      expect(li.source).toBe('paint_rates')
    }
  })

  it('separate-price lines stay OUT of the tender tier', () => {
    expect(tier.line_items.some((l) => l.description.includes('Fridge window'))).toBe(false)
    expect(tier.subtotal_ex_gst).toBe(bom.subtotalExGst)
    expect(tier.total_inc_gst).toBe(bom.totalIncGst)
  })
})

describe('buildPaintQuotePayloads', () => {
  const { intake, quote } = buildPaintQuotePayloads({
    bom,
    tenantId: 'T1',
    shareToken: 'tok_abc',
    jobName: 'IGA Swan Street',
    siteAddress: '480 Swan St, Richmond VIC',
  })

  it('intake is trade commercial_painting with takeoff facts in scope', () => {
    expect(intake.trade).toBe('commercial_painting')
    expect(intake.tenant_id).toBe('T1')
    expect(intake.scope.total_m2).toBeCloseTo(508.5, 1)
    expect(intake.scope.labour_hours).toBe(bom.labour.hours)
    expect(intake.inspection_required).toBe(false)
  })

  it('quote wraps the single tender into good/better/best with selected better', () => {
    expect(quote.share_token).toBe('tok_abc')
    expect(quote.selected_tier).toBe('better')
    expect(quote.good).toEqual(quote.better)
    expect(quote.best).toEqual(quote.better)
    expect(quote.subtotal_ex_gst).toBe(bom.subtotalExGst)
    expect(quote.gst).toBe(bom.gst)
    expect(quote.total_inc_gst).toBe(bom.totalIncGst)
    expect(quote.routing_decision).toBe('tradie_review')
    expect(quote.needs_inspection).toBe(false)
  })

  it('assumptions and scope read as a tender summary', () => {
    expect(quote.scope_of_works).toContain('IGA Swan Street')
    expect(quote.scope_of_works).toContain('crew of')
    expect(quote.assumptions.length).toBeGreaterThan(0)
  })
})

describe('buildPaintTenderReportHtml', () => {
  const html = buildPaintTenderReportHtml({
    businessName: 'Pilot Painters <Pty> Ltd',
    jobName: 'IGA Swan Street',
    siteAddress: '480 Swan St, Richmond VIC',
    bom,
    quoteViewUrl: 'https://example.com/q/tok_abc',
    generatedAt: new Date('2026-06-12T00:00:00Z'),
  })

  it('escapes HTML and renders the tender sections', () => {
    expect(html).toContain('Pilot Painters &lt;Pty&gt; Ltd')
    expect(html).not.toContain('<Pty>')
    expect(html).toContain('Painting tender')
    expect(html).toContain('Scope of works')
    expect(html).toContain('Materials')
    expect(html).toContain('Equipment &amp; access')
    expect(html).toContain('Separate prices')
    expect(html).toContain('Assumptions')
    expect(html).toContain('Exclusions')
  })

  it('shows the AU-formatted totals and crew facts', () => {
    expect(html).toContain('Tender total inc GST')
    expect(html).toContain(bom.totalIncGst.toLocaleString('en-AU', { style: 'currency', currency: 'AUD' }))
    expect(html).toContain(`${bom.labour.crewSize} painters`)
    expect(html).toContain('June 2026')
  })
})
