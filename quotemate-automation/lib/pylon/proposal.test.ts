import { describe, expect, it } from 'vitest'
import {
  buildPylonQuoteTable,
  buildPylonQuoteUrl,
  derivePylonProposalStatus,
  designProjectId,
  formatCentsAud,
  generatePylonToken,
  mapPylonProposalRow,
  normalizePylonDesign,
  normalizePylonProject,
  parseFormattedAudToCents,
  pricingMismatchFlag,
  stcMismatchFlag,
  validatePylonProposal,
  type PylonProposalRawRow,
} from './proposal'
import { PYLON_DESIGN_FIXTURE, PYLON_PROJECT_FIXTURE } from './__fixtures__/design'

describe('normalizePylonDesign', () => {
  const design = normalizePylonDesign(PYLON_DESIGN_FIXTURE)

  it('carries the identity + summary fields', () => {
    expect(design.pylon_design_id).toBe('RnlPy9NMNr')
    expect(design.title).toBe('13.5kWh Battery storage with 4.99kW Inverter')
    expect(design.summary.dc_output_kw).toBe(6.49)
    expect(design.summary.storage_kwh).toBe(13.5)
    expect(design.summary.latest_snapshot_url).toContain('static.getpylon.com')
    expect(design.summary.single_line_diagram_pdf_url).toContain('sld.pdf')
  })

  it('collects components across every *_types array with kinds', () => {
    expect(design.components).toHaveLength(3)
    const kinds = design.components.map((c) => c.kind)
    expect(kinds).toEqual(['module', 'inverter', 'battery'])
    const panel = design.components[0]
    expect(panel.sku).toBe('779db75d-436a-5631-ba68-5eea5e3d25e2')
    expect(panel.quantity).toBe(22)
    expect(panel.datasheet).toBeNull()
  })

  it('keeps line items verbatim in cents with tax semantics', () => {
    expect(design.line_items).toHaveLength(2)
    const stc = design.line_items[1]
    expect(stc.description).toBe('STCs')
    expect(stc.unit_amount_cents).toBe(-3500)
    expect(stc.quantity).toBe(103)
    expect(stc.total_amount_cents).toBe(-360500)
    expect(stc.tax_type).toBe('au:exempt_expenses')
  })

  it('carries locale.au STC data and the formatted proposal_quote', () => {
    expect(design.locale_au?.stc_quantity).toBe(103)
    expect(design.proposal_quote?.total_price_formatted).toBe('$7,600.00')
    expect(design.proposal_quote?.deposit_amount_formatted).toBe('$760.00')
    expect(design.proposal_quote?.locale_au?.eligible_for_stcs).toBe(true)
  })

  it('tolerates an empty payload (degraded import)', () => {
    const empty = normalizePylonDesign({ id: 'x' })
    expect(empty.pylon_design_id).toBe('x')
    expect(empty.components).toEqual([])
    expect(empty.line_items).toEqual([])
    expect(empty.locale_au).toBeNull()
    expect(empty.proposal_quote).toBeNull()
    expect(empty.pricing.total_cents).toBeNull()
  })
})

describe('designProjectId', () => {
  it('reads the project relationship id', () => {
    expect(designProjectId(PYLON_DESIGN_FIXTURE)).toBe('rukSigcyTR')
  })
  it('returns null when missing', () => {
    expect(designProjectId({})).toBeNull()
  })
})

describe('normalizePylonProject', () => {
  const { customer, site } = normalizePylonProject(PYLON_PROJECT_FIXTURE)

  it('extracts customer details', () => {
    expect(customer.name).toBe('Hubert J. Farnsworth')
    expect(customer.phone).toBe('+61400000000')
    expect(customer.email).toBe('hubert@example.com')
  })

  it('flattens the site address and carries site details', () => {
    expect(site.address_text).toBe('19 Parmesan Avenue, Glen Iris, Victoria, 3147')
    expect(site.address.zip).toBe('3147')
    expect(site.location).toEqual([145.0709934, -37.8510383])
    expect(site.roof_type).toBe('tile')
    expect(site.power_phases).toBe('one')
    expect(site.nmi).toBe('6001000000')
    expect(site.energy_retailer).toBe('AGL')
  })
})

describe('guardrails', () => {
  const design = normalizePylonDesign(PYLON_DESIGN_FIXTURE)

  it('stcMismatchFlag: clean when within 1 certificate', () => {
    expect(stcMismatchFlag(design, 103)).toBeNull()
    expect(stcMismatchFlag(design, 104)).toBeNull()
  })

  it('stcMismatchFlag: flags a >1 certificate divergence', () => {
    const flag = stcMismatchFlag(design, 90)
    expect(flag).toContain('stc_mismatch_pylon')
    expect(flag).toContain('design=103')
  })

  it('stcMismatchFlag: silent when either side is unknown', () => {
    expect(stcMismatchFlag(design, null)).toBeNull()
    const noStc = normalizePylonDesign({ id: 'x' })
    expect(stcMismatchFlag(noStc, 100)).toBeNull()
  })

  it('pricingMismatchFlag: the fixture re-adds cleanly', () => {
    // subtotal 1120500 + tax 0 + STC line −360500 = 760000 = pricing.total
    expect(pricingMismatchFlag(design)).toBeNull()
  })

  it('pricingMismatchFlag: flags a broken total', () => {
    const broken = { ...design, pricing: { ...design.pricing, total_cents: 999999 } }
    const flag = pricingMismatchFlag(broken)
    expect(flag).toContain('pricing_mismatch_pylon')
  })

  it('pricingMismatchFlag: silent when inputs are missing', () => {
    const empty = normalizePylonDesign({ id: 'x' })
    expect(pricingMismatchFlag(empty)).toBeNull()
  })

  it('validatePylonProposal collects both flags', () => {
    const broken = { ...design, pricing: { ...design.pricing, total_cents: 1 } }
    const flags = validatePylonProposal(broken, 1)
    expect(flags).toHaveLength(2)
  })
})

describe('formatCentsAud', () => {
  it('formats positive cents', () => {
    expect(formatCentsAud(760000)).toBe('$7,600.00')
    expect(formatCentsAud(99)).toBe('$0.99')
  })
  it('formats negatives with a true minus sign', () => {
    expect(formatCentsAud(-360500)).toBe('\u2212$3,605.00')
  })
})

describe('buildPylonQuoteTable', () => {
  const design = normalizePylonDesign(PYLON_DESIGN_FIXTURE)
  const table = buildPylonQuoteTable(design)

  it('renders visible lines with inc-tax amounts', () => {
    expect(table.rows).toHaveLength(2)
    expect(table.rows[0].amount_formatted).toBe('$11,205.00')
    expect(table.rows[1].amount_formatted).toBe('\u2212$3,605.00')
    expect(table.rows[1].is_rebate).toBe(true)
  })

  it('uses the proposal_quote formatted summary figures verbatim', () => {
    expect(table.total_formatted).toBe('$7,600.00')
    expect(table.deposit_formatted).toBe('$760.00')
    expect(table.amount_payable_formatted).toBe('$1,840.00')
  })

  it('omits hidden lines and blanks price-hidden amounts', () => {
    const tweaked = normalizePylonDesign({
      ...PYLON_DESIGN_FIXTURE,
      line_items: [
        { description: 'Hidden line', is_line_hidden: true, included_in_summary_line: 'subtotal', total_amount: 100, tax_type: 'none' },
        { description: 'Bundled install', is_amount_hidden: true, included_in_summary_line: 'subtotal', total_amount: 5000, tax_type: 'none' },
      ],
    })
    const t = buildPylonQuoteTable(tweaked)
    expect(t.rows).toHaveLength(1)
    expect(t.rows[0].description).toBe('Bundled install')
    expect(t.rows[0].amount_formatted).toBeNull()
  })

  it('falls back to pricing.total when proposal_quote is absent', () => {
    const noPq = normalizePylonDesign({
      ...PYLON_DESIGN_FIXTURE,
      proposal_quote: undefined,
    })
    const t = buildPylonQuoteTable(noPq)
    expect(t.total_formatted).toBe('$7,600.00')
    expect(t.deposit_formatted).toBeNull()
  })
})

describe('derivePylonProposalStatus', () => {
  it('flagged beats everything', () => {
    expect(
      derivePylonProposalStatus({ flags: ['x'], confirmed_at: 'now', paid_at: 'now' }),
    ).toBe('flagged')
  })
  it('paid > confirmed > awaiting', () => {
    expect(derivePylonProposalStatus({ flags: [], confirmed_at: 'now', paid_at: 'now' })).toBe('paid')
    expect(derivePylonProposalStatus({ flags: [], confirmed_at: 'now' })).toBe('confirmed')
    expect(derivePylonProposalStatus({ flags: [] })).toBe('awaiting_confirmation')
  })
})

describe('generatePylonToken', () => {
  it('emits url-safe 16-byte tokens', () => {
    const t = generatePylonToken()
    expect(t).toMatch(/^[A-Za-z0-9_-]{20,24}$/)
    expect(generatePylonToken()).not.toBe(t)
  })
})

describe('mapPylonProposalRow', () => {
  const design = normalizePylonDesign(PYLON_DESIGN_FIXTURE)
  const base: PylonProposalRawRow = {
    public_token: 'tok123',
    pylon_design_id: 'RnlPy9NMNr',
    title: null,
    address_text: '19 Parmesan Avenue, Glen Iris, Victoria, 3147',
    customer: { name: 'Hubert J. Farnsworth', phone: null, email: null },
    design,
    assets: {},
    flags: [],
    status: 'awaiting_confirmation',
    confirmed_at: null,
    paid_at: null,
    created_at: '2026-06-12T00:00:00Z',
  }

  it('builds the dashboard card view model', () => {
    const vm = mapPylonProposalRow({ row: base, appUrl: 'https://app.example.com/' })
    expect(vm.token).toBe('tok123')
    expect(vm.title).toBe('13.5kWh Battery storage with 4.99kW Inverter')
    expect(vm.customerName).toBe('Hubert J. Farnsworth')
    expect(vm.systemKw).toBe(6.49)
    expect(vm.storageKwh).toBe(13.5)
    expect(vm.totalFormatted).toBe('$7,600.00')
    expect(vm.status).toBe('awaiting_confirmation')
    expect(vm.canConfirm).toBe(true)
    expect(vm.canReimport).toBe(true)
    expect(vm.quoteUrl).toBe('https://app.example.com/q/pylon/tok123')
    expect(vm.pylonWebProposalUrl).toContain('app.getpylon.com/proposals')
  })

  it('flagged rows cannot confirm but can re-import', () => {
    const vm = mapPylonProposalRow({
      row: { ...base, flags: ['stc_mismatch_pylon:design=103,calculated=90'] },
      appUrl: 'https://app.example.com',
    })
    expect(vm.status).toBe('flagged')
    expect(vm.canConfirm).toBe(false)
    expect(vm.canReimport).toBe(true)
  })

  it('confirmed rows can neither confirm nor re-import', () => {
    const vm = mapPylonProposalRow({
      row: { ...base, confirmed_at: '2026-06-12T01:00:00Z' },
      appUrl: 'https://app.example.com',
    })
    expect(vm.status).toBe('confirmed')
    expect(vm.canConfirm).toBe(false)
    expect(vm.canReimport).toBe(false)
  })

  it('survives a null design (degraded row)', () => {
    const vm = mapPylonProposalRow({
      row: { ...base, design: null, title: 'Imported design' },
      appUrl: 'https://app.example.com',
    })
    expect(vm.title).toBe('Imported design')
    expect(vm.systemKw).toBeNull()
    expect(vm.totalFormatted).toBeNull()
  })
})

describe('buildPylonQuoteUrl', () => {
  it('trims trailing slashes', () => {
    expect(buildPylonQuoteUrl('https://x.com///', 'abc')).toBe('https://x.com/q/pylon/abc')
  })
})

describe('parseFormattedAudToCents', () => {
  it('parses Pylon display strings to cents', () => {
    expect(parseFormattedAudToCents('$760.00')).toBe(76000)
    expect(parseFormattedAudToCents('$7,600.00')).toBe(760000)
    expect(parseFormattedAudToCents('$1,840')).toBe(184000)
  })
  it('handles negatives (both hyphen and true minus)', () => {
    expect(parseFormattedAudToCents('-$360.50')).toBe(-36050)
    expect(parseFormattedAudToCents('\u2212$360.50')).toBe(-36050)
  })
  it('null on garbage / empty', () => {
    expect(parseFormattedAudToCents(null)).toBeNull()
    expect(parseFormattedAudToCents('')).toBeNull()
    expect(parseFormattedAudToCents('free')).toBeNull()
  })
})
