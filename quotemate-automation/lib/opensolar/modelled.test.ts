import { describe, expect, it } from 'vitest'
import { DEFAULT_SOLAR_CONFIG } from '@/lib/solar/config'
import { buildOpenSolarModelled, openSolarNetExGstAud } from './modelled'
import {
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
const fullDesign = normalizeOpenSolarDesign({ projectId: PROJECT_ID, system, proposalSlice: slice })
const reducedDesign = { ...normalizeOpenSolarDesign({ projectId: PROJECT_ID, system }), proposal: null }

describe('openSolarNetExGstAud', () => {
  it('prefers the design own ex-tax price', () => {
    expect(openSolarNetExGstAud(fullDesign)).toBe(8172.73)
  })

  it('falls back to stripping 10% GST from the inc-tax total', () => {
    const noEx = { ...fullDesign, price_excluding_tax_aud: null }
    expect(openSolarNetExGstAud(noEx)).toBeCloseTo(8990 / 1.1, 1)
  })

  it('null when nothing usable', () => {
    expect(
      openSolarNetExGstAud({
        ...fullDesign,
        price_excluding_tax_aud: null,
        price_including_tax_aud: null,
      }),
    ).toBeNull()
  })
})

describe('buildOpenSolarModelled — Raw Data plan (design figures verbatim)', () => {
  const m = buildOpenSolarModelled({
    design: fullDesign,
    state: 'NSW',
    config: DEFAULT_SOLAR_CONFIG,
    theme: 'dark',
  })!

  it('uses the designed annual output, not the CEC model', () => {
    expect(m.annual_kwh_ac).toBe(8547)
    expect(m.annual_is_design).toBe(true)
  })

  it('uses the design own bill calculations', () => {
    expect(m.utility).not.toBeNull()
    expect(m.utility!.is_design).toBe(true)
    expect(m.utility!.annual_bill_before_aud).toBe(2450)
    expect(m.utility!.annual_bill_with_solar_aud).toBe(441)
  })

  it('headline financial stats are design-sourced verbatim', () => {
    const byLabel = Object.fromEntries(m.financial_stats.map((s) => [s.label, s]))
    expect(byLabel['Net present value'].source).toBe('design')
    expect(byLabel['Net present value'].value).toBe('$14,820')
    expect(byLabel['Payback'].source).toBe('design')
    expect(byLabel['Payback'].value).toBe('4.6 yrs')
    expect(byLabel['IRR'].source).toBe('design')
  })

  it('monthly production chart uses the real series', () => {
    expect(m.charts.monthly_production?.caption).toContain('designed system')
  })

  it('assumed values carry per-group tilt/azimuth + design provenance', () => {
    const labels = m.assumptions.map((a) => a.label)
    expect(labels).toContain('Roof group 1')
    expect(labels).toContain('Roof group 2')
    const annual = m.assumptions.find((a) => a.label === 'Annual production')
    expect(annual?.value).toContain('OpenSolar design')
    const stc = m.assumptions.find((a) => a.label === 'STC quantity')
    expect(stc?.value).toContain('39')
  })
})

describe('buildOpenSolarModelled — API Access plan (modelled fallbacks)', () => {
  const reducedNoOutput = { ...reducedDesign, output_annual_kwh: null }
  const m = buildOpenSolarModelled({
    design: reducedNoOutput,
    state: 'NSW',
    config: DEFAULT_SOLAR_CONFIG,
    theme: 'dark',
  })!

  it('models production from the CEC NSW yield when no design output', () => {
    expect(m.annual_is_design).toBe(false)
    expect(m.annual_kwh_ac).toBe(Math.round(6.21 * 1382))
  })

  it('financial stats fall back to the modelled projection', () => {
    expect(m.financial_stats.length).toBeGreaterThan(0)
    expect(m.financial_stats.every((s) => s.source === 'modelled')).toBe(true)
  })

  it('bills are engine-modelled and labelled as such', () => {
    expect(m.utility).not.toBeNull()
    expect(m.utility!.is_design).toBe(false)
    // Modelled-path assumptions are surfaced for the assumed-values table.
    const labels = m.assumptions.map((a) => a.label)
    expect(labels).toContain('Self-consumption')
    expect(labels).toContain('Retail rate')
  })

  it('builds all four charts', () => {
    expect(m.charts.monthly_production?.svg).toContain('<svg')
    expect(m.charts.utility_costs?.svg).toContain('<svg')
    expect(m.charts.monthly_bill?.svg).toContain('<svg')
    expect(m.charts.cumulative_savings?.svg).toContain('<svg')
  })

  it('environmental impact uses the cited AU grid factor', () => {
    expect(m.environmental).not.toBeNull()
    expect(m.environmental!.carbon_offset_factor_kg_per_mwh).toBe(680)
  })
})

describe('buildOpenSolarModelled — nothing to show', () => {
  it('null when the design has neither output nor kW', () => {
    const empty = normalizeOpenSolarDesign({ projectId: 'x', system: { uuid: 'u' } })
    expect(
      buildOpenSolarModelled({
        design: empty,
        state: 'NSW',
        config: DEFAULT_SOLAR_CONFIG,
        theme: 'dark',
      }),
    ).toBeNull()
  })
})
