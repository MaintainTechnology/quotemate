import { describe, expect, it } from 'vitest'
import { DEFAULT_SOLAR_CONFIG } from '@/lib/solar/config'
import { buildPylonModelled, designNetExGstAud } from './modelled'
import { normalizePylonDesign } from './proposal'
import { PYLON_DESIGN_FIXTURE } from './__fixtures__/design'

const design = normalizePylonDesign(PYLON_DESIGN_FIXTURE)

describe('designNetExGstAud', () => {
  it('sums the ex-tax subtotal+total line items', () => {
    // 1120500 + (−360500) = 760000 cents = $7,600.00
    expect(designNetExGstAud(design)).toBe(7600)
  })

  it('falls back to pricing.total stripped of GST when no line items', () => {
    const noLines = { ...design, line_items: [] }
    // 760000 cents inc tax → /1.1 → 690909.09… cents → $6,909.09
    expect(designNetExGstAud(noLines)).toBeCloseTo(6909.09, 1)
  })

  it('null when nothing usable', () => {
    const empty = normalizePylonDesign({ id: 'x' })
    expect(designNetExGstAud(empty)).toBeNull()
  })
})

describe('buildPylonModelled', () => {
  const modelled = buildPylonModelled({
    design,
    state: 'VIC',
    config: DEFAULT_SOLAR_CONFIG,
    theme: 'dark',
  })

  it('models production from the CEC state yield', () => {
    expect(modelled).not.toBeNull()
    // 6.49 kW × 1278 kWh/kW (VIC) = 8294.22 → 8294
    expect(modelled!.annual_kwh_ac).toBe(Math.round(6.49 * 1278))
    expect(modelled!.specific_yield_kwh_per_kw).toBe(1278)
  })

  it('accepts full state names as Pylon sends them ("Victoria")', () => {
    const m = buildPylonModelled({
      design,
      state: 'Victoria',
      config: DEFAULT_SOLAR_CONFIG,
      theme: 'dark',
    })
    expect(m!.specific_yield_kwh_per_kw).toBe(1278)
  })

  it('falls back to the conservative yield for unknown states', () => {
    const m = buildPylonModelled({
      design,
      state: null,
      config: DEFAULT_SOLAR_CONFIG,
      theme: 'dark',
    })
    expect(m!.specific_yield_kwh_per_kw).toBe(1380)
  })

  it('derives savings with the engine tariff math', () => {
    const ac = modelled!.annual_kwh_ac
    const self = Math.min(
      Math.round(ac * DEFAULT_SOLAR_CONFIG.self_consumption_pct),
      DEFAULT_SOLAR_CONFIG.typical_household_kwh_per_year ?? 6000,
    )
    const exported = ac - self
    const expected =
      self * DEFAULT_SOLAR_CONFIG.retail_rate_aud_per_kwh +
      exported * DEFAULT_SOLAR_CONFIG.feed_in.default_aud_per_kwh
    expect(modelled!.annual_savings_aud).toBeCloseTo(expected, 1)
  })

  it('builds the financial projection and all four charts', () => {
    expect(modelled!.financial).not.toBeNull()
    expect(modelled!.financial!.years).toHaveLength(25)
    expect(modelled!.charts.monthly_production?.svg).toContain('<svg')
    expect(modelled!.charts.utility_costs?.svg).toContain('<svg')
    expect(modelled!.charts.monthly_bill?.svg).toContain('<svg')
    expect(modelled!.charts.cumulative_savings?.svg).toContain('<svg')
  })

  it('builds the environmental impact from the cited AU grid factor', () => {
    expect(modelled!.environmental).not.toBeNull()
    expect(modelled!.environmental!.carbon_offset_factor_kg_per_mwh).toBe(680)
    expect(modelled!.environmental!.tonnes_co2_per_year).toBeGreaterThan(0)
  })

  it('surfaces the constants in the assumptions table', () => {
    const labels = modelled!.assumptions.map((a) => a.label)
    expect(labels).toContain('DC array power')
    expect(labels).toContain('Specific yield')
    expect(labels).toContain('Grid emission factor')
    expect(labels).toContain('Price escalation')
  })

  it('null when the design has no DC kW', () => {
    const noKw = normalizePylonDesign({ id: 'x' })
    expect(
      buildPylonModelled({ design: noKw, state: 'NSW', config: DEFAULT_SOLAR_CONFIG, theme: 'dark' }),
    ).toBeNull()
  })
})
