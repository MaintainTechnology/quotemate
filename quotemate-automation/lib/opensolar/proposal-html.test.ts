import { describe, expect, it } from 'vitest'
import { DEFAULT_SOLAR_CONFIG } from '@/lib/solar/config'
import { buildOpenSolarModelled } from './modelled'
import { buildOpenSolarProposalHtml } from './proposal-html'
import {
  buildOpenSolarQuoteTable,
  extractOpenSolarProposalSlice,
  normalizeOpenSolarDesign,
  pickOpenSolarSystem,
} from './proposal'
import {
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
const modelled = buildOpenSolarModelled({
  design,
  state: 'NSW',
  config: DEFAULT_SOLAR_CONFIG,
  theme: 'light',
})

function render(overrides: Partial<Parameters<typeof buildOpenSolarProposalHtml>[0]> = {}) {
  return buildOpenSolarProposalHtml({
    businessName: 'Solar Safari Pty Ltd',
    title: 'System 1 (6.21 kW)',
    address: '6 Hopetoun Ave, Vaucluse, NSW, 2030',
    customerName: 'Sam Customer',
    design,
    table: buildOpenSolarQuoteTable(design),
    modelled,
    systemImageUrl: 'https://app/api/opensolar/q/tok/asset/system-image',
    shadeReportUrl: 'https://app/api/opensolar/q/tok/asset/shade-report',
    energyYieldUrl: 'https://app/api/opensolar/q/tok/asset/energy-yield',
    sitePlanUrl: null,
    quoteViewUrl: 'https://app/q/opensolar/tok',
    generatedAt: new Date('2026-06-12T00:00:00Z'),
    ...overrides,
  })
}

describe('buildOpenSolarProposalHtml', () => {
  const html = render()

  it('renders the section order of the reference proposal', () => {
    const order = [
      'Proposed panel layout',
      'System details',
      'Monthly production',
      'Utility costs',
      'Financial summary',
      'Environmental analysis',
      'Your quote',
      'Assumed values',
      'Engineering appendices',
    ]
    let last = -1
    for (const heading of order) {
      const idx = html.indexOf(heading)
      expect(idx, `section "${heading}" present`).toBeGreaterThan(-1)
      expect(idx, `section "${heading}" in order`).toBeGreaterThan(last)
      last = idx
    }
  })

  it('renders the verbatim line items and total', () => {
    expect(html).toContain('18 × LG345N1C-V5 panels')
    expect(html).toContain('$8,990.00')
    expect(html).toContain('\u2212$2,150.00')
    expect(html).toContain('displays them verbatim')
  })

  it('labels design-sourced production as OpenSolar, not modelled', () => {
    expect(html).toContain('Monthly production (OpenSolar design)')
  })

  it('lists only the cached appendices', () => {
    expect(html).toContain('Shade report (PDF)')
    expect(html).toContain('Energy yield report (PDF)')
    expect(html).not.toContain('PV site plan (PDF)')
  })

  it('omits the layout figure when no image is cached', () => {
    const bare = render({ systemImageUrl: null })
    expect(bare).not.toContain('Proposed panel layout')
  })

  it('omits the appendix section when nothing is cached', () => {
    const bare = render({ shadeReportUrl: null, energyYieldUrl: null, sitePlanUrl: null })
    expect(bare).not.toContain('Engineering appendices')
  })

  it('escapes HTML in third-party strings', () => {
    const evil = render({ businessName: 'Evil <script>alert(1)</script> Co' })
    expect(evil).not.toContain('<script>alert(1)</script>')
    expect(evil).toContain('&lt;script&gt;')
  })

  it('carries the AU framing (GST, OpenSolar studio provenance)', () => {
    expect(html).toContain('inc GST')
    expect(html).toContain('designed in OpenSolar studio')
  })
})
