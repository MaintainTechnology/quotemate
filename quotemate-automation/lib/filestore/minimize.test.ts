import { describe, it, expect } from 'vitest'
import { buildQuoteKbText, buildInvoiceKbText } from './minimize'

const quote = {
  job_type: 'downlights',
  state: 'NSW',
  customer_suburb: 'Bondi',
  estimated_timeframe: '1 day',
  routing_decision: 'tradie_review',
  scope_of_works:
    'Install 6 LED downlights. Contact john.smith@example.com or 0412 345 678 to book a time.',
  // PII fields that must NEVER appear in the minimized output:
  customer: {
    name: 'John Smith',
    email: 'john.smith@example.com',
    phone: '0412 345 678',
    address: '12 Smith Street, Bondi NSW 2026',
  },
  good: {
    label: 'Essentials',
    subtotal_ex_gst: 1000,
    line_items: [
      { description: '6x LED downlight', quantity: 6, unit: 'ea', unit_price_ex_gst: 100, total_ex_gst: 600 },
    ],
  },
  better: { label: 'Recommended', subtotal_ex_gst: 1500, line_items: [] },
  best: null,
}

describe('buildQuoteKbText', () => {
  it('includes structured job + pricing + line items', () => {
    const { markdown } = buildQuoteKbText({ quote, trade: 'electrical' })
    expect(markdown).toContain('Trade: electrical')
    expect(markdown).toContain('downlights')
    expect(markdown).toContain('LED downlight')
    expect(markdown).toContain('$1100') // incGst(1000) = round(1000*1.1)
    expect(markdown).toContain('Good')
    expect(markdown).toContain('Better')
  })

  it('strips customer PII — name, street, phone, email', () => {
    const { markdown } = buildQuoteKbText({ quote, trade: 'electrical' })
    expect(markdown).not.toContain('John Smith')
    expect(markdown).not.toContain('12 Smith Street')
    expect(markdown).not.toContain('example.com')
    expect(markdown).not.toContain('0412')
    expect(markdown.toLowerCase()).toContain('[redacted') // backstop fired on scope text
  })

  it('hides prices when pricesHidden=true', () => {
    const { markdown } = buildQuoteKbText({ quote, trade: 'electrical', pricesHidden: true })
    expect(markdown).not.toContain('$1100')
    expect(markdown).not.toContain('$600')
    expect(markdown.toLowerCase()).toContain('withheld')
  })

  it('contentHash is stable for identical input and changes with content', () => {
    const a = buildQuoteKbText({ quote, trade: 'electrical' })
    const b = buildQuoteKbText({ quote, trade: 'electrical' })
    expect(a.contentHash).toBe(b.contentHash)
    expect(a.bytes.byteLength).toBeGreaterThan(0)
    const c = buildQuoteKbText({
      quote: { ...quote, good: { ...quote.good, subtotal_ex_gst: 2000 } },
      trade: 'electrical',
    })
    expect(c.contentHash).not.toBe(a.contentHash)
  })

  it('summarises token-trade estimates without tiers', () => {
    const { markdown } = buildQuoteKbText({
      quote: { estimate: { total_inc_gst: 8800, system_size_kw: 6.6, line_items: [{ description: '12x 550W panel', total_ex_gst: 4000 }] } },
      trade: 'solar',
    })
    expect(markdown).toContain('Trade: solar')
    expect(markdown).toContain('total inc gst')
    expect(markdown).toContain('550W panel')
  })
})

describe('buildQuoteKbText — name redaction', () => {
  it('redacts a structured customer name that appears in free-text scope', () => {
    const { markdown } = buildQuoteKbText({
      quote: {
        customer: { name: 'John Smith' },
        scope_of_works: 'Spoke with John Smith on site; install 6 downlights for Smith.',
        good: { label: 'E', subtotal_ex_gst: 1000, line_items: [] },
      },
      trade: 'electrical',
    })
    expect(markdown).not.toContain('John Smith')
    expect(markdown).not.toMatch(/\bSmith\b/)
    expect(markdown).toContain('downlights')
  })

  it('redacts the invoice customer name from the extracted scope', () => {
    const { markdown } = buildInvoiceKbText({
      extraction: {
        scope_description: 'Job for Jane Doe — replaced hot water unit',
        total_inc_gst: 2200,
        customer_name: 'Jane Doe',
      } as never,
    })
    expect(markdown).not.toContain('Jane Doe')
    expect(markdown).toContain('hot water')
  })
})

describe('buildQuoteKbText — token-trade shapes (R7/R9)', () => {
  it('solar: reads price.tiers + sizing (nested, snake_case)', () => {
    const { markdown } = buildQuoteKbText({
      quote: {
        estimate: {
          price: { tiers: [{ tier: 'best', net_inc_gst: 9990 }, { tier: 'better', net_inc_gst: 8422 }] },
          sizing: { system_size_kw: 6.6 },
          production: { annual_output_kwh: 9500 },
        },
      },
      trade: 'solar',
    })
    expect(markdown).toContain('Trade: solar')
    expect(markdown).toContain('9990')
    expect(markdown).toContain('best')
    expect(markdown).toContain('system size kw')
    expect(markdown).not.toContain('no structured pricing fields')
  })

  it('roofing: reads combined.tiers[].inc_gst + structures', () => {
    const { markdown } = buildQuoteKbText({
      quote: {
        estimate: {
          combined: { tiers: [{ tier: 'standard', inc_gst: 14300 }] },
          structures: [{}, {}],
        },
        routing_decision: 'tradie_review',
      },
      trade: 'roofing',
    })
    expect(markdown).toContain('Trade: roofing')
    expect(markdown).toContain('14300')
    expect(markdown).toContain('structures: 2')
    expect(markdown).not.toContain('no structured pricing fields')
  })

  it('commercial-painting: reads camelCase totalIncGst + lines[]', () => {
    const { markdown } = buildQuoteKbText({
      quote: {
        estimate: {
          totalIncGst: 26400,
          subtotalExGst: 24000,
          lines: [{ description: 'Two-coat low-sheen, Level 1', totalExGst: 12000 }],
        },
      },
      trade: 'commercial-painting',
    })
    expect(markdown).toContain('Trade: painting')
    expect(markdown).toContain('26400')
    expect(markdown).toContain('Two-coat low-sheen')
    expect(markdown).not.toContain('no structured pricing fields')
  })

  it('hides prices when routing is inspection-routed even without pricesHidden (R13 backstop)', () => {
    const { markdown } = buildQuoteKbText({
      quote: {
        good: { label: 'Essentials', subtotal_ex_gst: 1000, line_items: [] },
        routing_decision: 'inspection_required',
      },
      trade: 'electrical',
      // pricesHidden NOT passed — the routing alone must trigger the hide.
    })
    expect(markdown).not.toContain('$1100')
    expect(markdown.toLowerCase()).toContain('withheld')
  })

  it('token trades honour pricesHidden', () => {
    const { markdown } = buildQuoteKbText({
      quote: { estimate: { price: { tiers: [{ tier: 'best', net_inc_gst: 9990 }] } } },
      trade: 'solar',
      pricesHidden: true,
    })
    expect(markdown).not.toContain('9990')
    expect(markdown.toLowerCase()).toContain('withheld')
  })
})

describe('buildInvoiceKbText', () => {
  it('keeps supplier scope/total/suburb, drops customer name', () => {
    const { markdown } = buildInvoiceKbText({
      extraction: {
        scope_description: 'Replaced 6 LED downlights',
        total_inc_gst: 1320,
        job_type_guess: 'downlights',
        quantity: 6,
        customer_name: 'Jane Doe',
        customer_suburb: 'Manly',
        invoice_date: '2026-01-02',
      } as never,
    })
    expect(markdown).toContain('downlights')
    expect(markdown).toContain('$1320')
    expect(markdown).toContain('Manly')
    expect(markdown).toContain('2026-01-02')
    expect(markdown).not.toContain('Jane Doe')
  })
})
