import { describe, expect, it } from 'vitest'
import {
  buildOpenSolarQuoteTable,
  buildOpenSolarQuoteUrl,
  deriveOpenSolarProposalStatus,
  extractOpenSolarProposalSlice,
  formatAud,
  generateOpenSolarToken,
  listOpenSolarSystems,
  mapOpenSolarProposalRow,
  normalizeOpenSolarDesign,
  normalizeOpenSolarProject,
  openSolarPricingMismatchFlag,
  openSolarStcMismatchFlag,
  pickOpenSolarSystem,
  validateOpenSolarProposal,
  type OpenSolarProposalRawRow,
} from './proposal'
import {
  OPENSOLAR_PROJECT_FIXTURE,
  OPENSOLAR_PROPOSAL_DATA_FIXTURE,
  OPENSOLAR_SYSTEM_DETAILS_FIXTURE,
} from './__fixtures__/design'

const PROJECT_ID = '3763174'
const SYSTEM_UUID = 'E583FD88-EB6C-4311-91A9-AC719041EAA8'

const slice = extractOpenSolarProposalSlice(
  OPENSOLAR_PROPOSAL_DATA_FIXTURE,
  PROJECT_ID,
  SYSTEM_UUID,
)
const system = pickOpenSolarSystem(OPENSOLAR_SYSTEM_DETAILS_FIXTURE, SYSTEM_UUID)!
const design = normalizeOpenSolarDesign({ projectId: PROJECT_ID, system, proposalSlice: slice })

describe('normalizeOpenSolarProject', () => {
  const { customer, site } = normalizeOpenSolarProject(OPENSOLAR_PROJECT_FIXTURE)

  it('extracts the customer from contacts_data', () => {
    expect(customer.name).toBe('Sam Customer')
    expect(customer.phone).toBe('+61400000000')
    expect(customer.email).toBe('sam@example.com')
  })

  it('flattens the site address + location', () => {
    expect(site.address_text).toBe('6 Hopetoun Ave, Vaucluse, NSW, 2030')
    expect(site.state).toBe('NSW')
    expect(site.zip).toBe('2030')
    expect(site.location).toEqual([151.277, -33.857])
  })

  it('tolerates a contact-less project', () => {
    const bare = normalizeOpenSolarProject({ id: 1, address: 'X St' })
    expect(bare.customer.name).toBeNull()
    expect(bare.site.address_text).toBe('X St')
  })
})

describe('system picking', () => {
  it('null uuid picks the first system', () => {
    const first = pickOpenSolarSystem(OPENSOLAR_SYSTEM_DETAILS_FIXTURE, null)
    expect(first?.uuid).toBe(SYSTEM_UUID)
  })

  it('uuid picks the matching system; unknown uuid → null', () => {
    expect(pickOpenSolarSystem(OPENSOLAR_SYSTEM_DETAILS_FIXTURE, 'SECOND-SYSTEM-UUID')?.id).toBe(8281)
    expect(pickOpenSolarSystem(OPENSOLAR_SYSTEM_DETAILS_FIXTURE, 'nope')).toBeNull()
    expect(pickOpenSolarSystem({}, null)).toBeNull()
  })

  it('listOpenSolarSystems builds the picker rows', () => {
    const rows = listOpenSolarSystems(OPENSOLAR_SYSTEM_DETAILS_FIXTURE)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toEqual({
      uuid: SYSTEM_UUID,
      name: 'System 1 (6.21 kW)',
      kw_stc: 6.21,
      module_quantity: 18,
    })
  })
})

describe('normalizeOpenSolarDesign', () => {
  it('carries the system facts verbatim', () => {
    expect(design.kw_stc).toBe(6.21)
    expect(design.module_quantity).toBe(18)
    expect(design.output_annual_kwh).toBe(8547)
    expect(design.consumption_offset_pct).toBe(82)
    expect(design.price_including_tax_aud).toBe(8990)
    expect(design.price_excluding_tax_aud).toBe(8172.73)
    expect(design.co2_tons_lifetime).toBe(65.96)
  })

  it('collects components across all four kinds', () => {
    const kinds = design.components.map((c) => c.kind)
    expect(kinds).toEqual(['module', 'inverter', 'other'])
    expect(design.components[0]).toEqual({
      kind: 'module',
      manufacturer: 'LG Electronics Inc.',
      code: 'LG345N1C-V5',
      quantity: 18,
    })
  })

  it('keeps module groups (tilt/azimuth/layout) for the assumed values', () => {
    expect(design.module_groups).toHaveLength(2)
    expect(design.module_groups[0]).toEqual({
      module_quantity: 12,
      azimuth_deg: 7,
      slope_deg: 20,
      layout: 'portrait',
    })
  })

  it('geometry is consistent when group quantities sum to the total', () => {
    expect(design.geometry_consistent).toBe(true) // 12 + 6 = 18
  })

  it('geometry mismatch is detected (never draw a wrong layout)', () => {
    const broken = normalizeOpenSolarDesign({
      projectId: PROJECT_ID,
      system: {
        ...system,
        module_groups: [{ module_quantity: 5, azimuth: 0, slope: 20, layout: 'portrait' }],
      },
    })
    expect(broken.geometry_consistent).toBe(false)
  })

  it('extracts the STC quantity from the incentive title', () => {
    expect(design.stc_quantity).toBe(39)
  })

  it('promotes OpenSolar calculation errors into import warnings', () => {
    const withErrors = normalizeOpenSolarDesign({
      projectId: PROJECT_ID,
      system,
      proposalSlice: { ...slice!, calculation_error_messages: ['Shading mesh failed'] },
    })
    expect(withErrors.import_warnings.some((w) => w.startsWith('calc_errors_opensolar'))).toBe(true)
  })
})

describe('extractOpenSolarProposalSlice', () => {
  it('parses display-formatted financial metrics', () => {
    expect(slice).not.toBeNull()
    expect(slice!.payback_year).toBe(4.6)
    expect(slice!.npv_aud).toBe(14820)
    expect(slice!.irr_pct).toBe(21.4)
    expect(slice!.roi_pct).toBe(212)
  })

  it('parses the real monthly output series', () => {
    expect(slice!.output_monthly_kwh).toHaveLength(12)
    expect(slice!.output_monthly_kwh![0]).toBe(860)
  })

  it('extracts bills, line items, payment option and deposit', () => {
    expect(slice!.bill_before_annual_aud).toBe(2450)
    expect(slice!.bill_after_annual_aud).toBe(441)
    expect(slice!.line_items).toHaveLength(4)
    expect(slice!.payment_option_label).toBe('Cash purchase')
    expect(slice!.deposit_aud).toBe(890)
    expect(slice!.tax_name).toBe('GST')
  })

  it('unknown project id → null (plan-gated callers tolerate this)', () => {
    expect(extractOpenSolarProposalSlice(OPENSOLAR_PROPOSAL_DATA_FIXTURE, '999', null)).toBeNull()
    expect(extractOpenSolarProposalSlice(null, PROJECT_ID, null)).toBeNull()
  })
})

describe('guardrails (flag, never fix)', () => {
  it('STC within ±1 certificate passes', () => {
    expect(openSolarStcMismatchFlag(design, 39)).toBeNull()
    expect(openSolarStcMismatchFlag(design, 40)).toBeNull()
  })

  it('STC mismatch beyond ±1 flags', () => {
    const flag = openSolarStcMismatchFlag(design, 45)
    expect(flag).toMatch(/^stc_mismatch_opensolar:design=39,calculated=45$/)
  })

  it('either side missing → cannot check → no flag', () => {
    expect(openSolarStcMismatchFlag(design, null)).toBeNull()
    expect(openSolarStcMismatchFlag({ ...design, stc_quantity: null }, 45)).toBeNull()
  })

  it('totals re-add passes when line items sum to the price', () => {
    // 4200 + 2100 + 4840 − 2150 = 8990 = price_including_tax
    expect(openSolarPricingMismatchFlag(design)).toBeNull()
  })

  it('totals divergence beyond $1 flags', () => {
    const broken = {
      ...design,
      proposal: {
        ...design.proposal!,
        line_items: design.proposal!.line_items.map((li, i) =>
          i === 0 ? { ...li, amount_aud: 5000 } : li,
        ),
      },
    }
    expect(openSolarPricingMismatchFlag(broken)).toMatch(/^pricing_mismatch_opensolar:/)
  })

  it('no line items (API Access plan) → cannot check → no flag', () => {
    expect(openSolarPricingMismatchFlag({ ...design, proposal: null })).toBeNull()
  })

  it('validateOpenSolarProposal aggregates both checks', () => {
    expect(validateOpenSolarProposal(design, 39)).toEqual([])
    expect(validateOpenSolarProposal(design, 50)).toHaveLength(1)
  })
})

describe('formatAud', () => {
  it('formats dollars with AU separators and a true minus on rebates', () => {
    expect(formatAud(8990)).toBe('$8,990.00')
    expect(formatAud(890.5)).toBe('$890.50')
    expect(formatAud(-2150)).toBe('\u2212$2,150.00')
  })
})

describe('buildOpenSolarQuoteTable', () => {
  it('Raw Data plan: renders the design line items verbatim', () => {
    const table = buildOpenSolarQuoteTable(design)
    expect(table.rows).toHaveLength(4)
    expect(table.rows[0].description).toBe('18 × LG345N1C-V5 panels')
    expect(table.rows[3].is_rebate).toBe(true)
    expect(table.rows[3].amount_formatted).toBe('\u2212$2,150.00')
    expect(table.total_formatted).toBe('$8,990.00')
    expect(table.deposit_formatted).toBe('$890.00')
    expect(table.payment_option_label).toBe('Cash purchase')
    expect(table.tax_name).toBe('GST')
  })

  it('API Access plan: synthesizes the table from system facts', () => {
    const reduced = { ...design, proposal: null }
    const table = buildOpenSolarQuoteTable(reduced)
    // System line + customer-visible adder + paid-to-customer incentive.
    expect(table.rows).toHaveLength(3)
    expect(table.rows[0].description).toContain('System 1 (6.21 kW)')
    expect(table.rows[0].amount_formatted).toBe('$8,990.00')
    expect(table.rows[1].description).toBe('Switchboard upgrade')
    expect(table.rows[2].is_rebate).toBe(true)
    expect(table.rows[2].amount_formatted).toBe('\u2212$2,150.00')
    expect(table.deposit_formatted).toBeNull() // no deposit without proposal data
  })
})

describe('lifecycle + view model', () => {
  it('status precedence: flagged > paid > confirmed', () => {
    expect(deriveOpenSolarProposalStatus({ flags: ['x'], paid_at: 'now' })).toBe('flagged')
    expect(deriveOpenSolarProposalStatus({ flags: [], paid_at: 'now' })).toBe('paid')
    expect(deriveOpenSolarProposalStatus({ confirmed_at: 'now' })).toBe('confirmed')
    expect(deriveOpenSolarProposalStatus({})).toBe('awaiting_confirmation')
  })

  it('tokens are unguessable base64url', () => {
    const t = generateOpenSolarToken()
    expect(t).toMatch(/^[A-Za-z0-9_-]{20,}$/)
    expect(generateOpenSolarToken()).not.toBe(t)
  })

  it('quote url joins cleanly', () => {
    expect(buildOpenSolarQuoteUrl('https://x.app/', 'tok123')).toBe('https://x.app/q/opensolar/tok123')
  })

  it('maps a row into the dashboard view model', () => {
    const row: OpenSolarProposalRawRow = {
      public_token: 'tok123',
      opensolar_project_id: PROJECT_ID,
      opensolar_system_uuid: SYSTEM_UUID,
      title: null,
      address_text: '6 Hopetoun Ave, Vaucluse, NSW, 2030',
      customer: { name: 'Sam Customer', phone: null, email: null },
      design,
      assets: null,
      flags: [],
      status: 'awaiting_confirmation',
      confirmed_at: null,
      paid_at: null,
      created_at: '2026-06-12T00:00:00Z',
    }
    const vm = mapOpenSolarProposalRow({ row, appUrl: 'https://x.app' })
    expect(vm.title).toBe('System 1 (6.21 kW)')
    expect(vm.systemKw).toBe(6.21)
    expect(vm.totalFormatted).toBe('$8,990.00')
    expect(vm.status).toBe('awaiting_confirmation')
    expect(vm.canConfirm).toBe(true)
    expect(vm.canReimport).toBe(true)
    expect(vm.quoteUrl).toBe('https://x.app/q/opensolar/tok123')
    expect(vm.openSolarProjectUrl).toContain(PROJECT_ID)
  })

  it('flagged rows cannot confirm but can re-import', () => {
    const vm = mapOpenSolarProposalRow({
      row: {
        public_token: 't',
        opensolar_project_id: PROJECT_ID,
        opensolar_system_uuid: SYSTEM_UUID,
        title: null,
        address_text: null,
        customer: null,
        design,
        assets: null,
        flags: ['stc_mismatch_opensolar:design=39,calculated=50'],
        status: 'flagged',
        confirmed_at: null,
        paid_at: null,
        created_at: '2026-06-12T00:00:00Z',
      },
      appUrl: 'https://x.app',
    })
    expect(vm.status).toBe('flagged')
    expect(vm.canConfirm).toBe(false)
    expect(vm.canReimport).toBe(true)
  })
})
