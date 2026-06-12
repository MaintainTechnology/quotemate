import { describe, expect, it } from 'vitest'
import type { OpenSolarCatalogueRow, OpenSolarPricingScheme } from '@/lib/opensolar/client'
import {
  buildOpenSolarHardware,
  buildOpenSolarPriceCheck,
  computeOpenSolarSchemePrice,
  openSolarEnrichmentEnabled,
  selectOpenSolarPricingScheme,
} from './opensolar-supplement'
import type { SolarPriceTier, SolarSystemTier } from './types'

function scheme(overrides: Partial<OpenSolarPricingScheme> = {}): OpenSolarPricingScheme {
  return {
    id: '1',
    title: 'Residential PPW',
    pricing_formula: 'Price Per Watt',
    configuration: { price_per_watt: 1.1, tax_percentage_included: 10 },
    priority: 1,
    auto_apply_enabled: true,
    auto_apply_only_specified_states: null,
    auto_apply_only_specified_zips: null,
    ...overrides,
  }
}

describe('openSolarEnrichmentEnabled', () => {
  const creds = { OPENSOLAR_ENABLED: 'true', OPENSOLAR_ORG_ID: '1', OPENSOLAR_API_TOKEN: 't' }
  it('requires its own flag AND the client credentials', () => {
    expect(openSolarEnrichmentEnabled({ ...creds, OPENSOLAR_ENRICHMENT_ENABLED: 'true' })).toBe(true)
    expect(openSolarEnrichmentEnabled({ ...creds })).toBe(false)
    expect(
      openSolarEnrichmentEnabled({ OPENSOLAR_ENRICHMENT_ENABLED: 'true', OPENSOLAR_ENABLED: 'true' }),
    ).toBe(false)
  })
})

describe('selectOpenSolarPricingScheme', () => {
  it('prefers the lowest-priority auto-apply scheme', () => {
    const picked = selectOpenSolarPricingScheme(
      [scheme({ id: 'b', priority: 2 }), scheme({ id: 'a', priority: 1 })],
      { state: 'NSW', postcode: '2030' },
    )
    expect(picked?.id).toBe('a')
  })

  it('honours state/zip restrictions', () => {
    const restricted = scheme({ id: 'vic', auto_apply_only_specified_states: ['VIC'] })
    expect(selectOpenSolarPricingScheme([restricted], { state: 'NSW', postcode: '2030' })).toBeNull()
    expect(
      selectOpenSolarPricingScheme([restricted], { state: 'VIC', postcode: '3000' })?.id,
    ).toBe('vic')
    const zip = scheme({ id: 'z', auto_apply_only_specified_zips: ['2030'] })
    expect(selectOpenSolarPricingScheme([zip], { state: 'NSW', postcode: '2031' })).toBeNull()
  })

  it('falls back to a sole manual scheme; multiple manual → none', () => {
    const manual = scheme({ auto_apply_enabled: false })
    expect(selectOpenSolarPricingScheme([manual], { state: null, postcode: null })).toBe(manual)
    expect(
      selectOpenSolarPricingScheme([manual, scheme({ id: '2', auto_apply_enabled: false })], {
        state: null,
        postcode: null,
      }),
    ).toBeNull()
    expect(selectOpenSolarPricingScheme([], { state: null, postcode: null })).toBeNull()
  })
})

describe('computeOpenSolarSchemePrice', () => {
  const system = { kw_dc: 6.6, panels_count: 15 }

  it('Price Per Watt: $/W × system watts', () => {
    expect(computeOpenSolarSchemePrice(scheme(), system)).toBeCloseTo(1.1 * 6600, 2)
  })

  it('Fixed Price: the configured figure', () => {
    const s = scheme({ pricing_formula: 'Fixed Price', configuration: { fixed_price: 8990 } })
    expect(computeOpenSolarSchemePrice(s, system)).toBe(8990)
  })

  it('Price Per Module/Inverter/Battery: per-equipment maths', () => {
    const s = scheme({
      pricing_formula: 'Price Per Module/Inverter/Battery',
      configuration: { price_per_module: 500, price_per_inverter: 1000, price_per_battery: 2000 },
    })
    expect(computeOpenSolarSchemePrice(s, system)).toBe(500 * 15 + 1000)
  })

  it('cost-dependent or unknown formulas → null (no check, never a guess)', () => {
    expect(
      computeOpenSolarSchemePrice(
        scheme({ pricing_formula: 'Markup Percentage', configuration: { markup: 30 } }),
        system,
      ),
    ).toBeNull()
    expect(
      computeOpenSolarSchemePrice(
        scheme({ pricing_formula: 'Price Per Watt By Size', configuration: {} }),
        system,
      ),
    ).toBeNull()
    expect(
      computeOpenSolarSchemePrice(scheme({ configuration: {} }), system),
    ).toBeNull()
  })
})

describe('buildOpenSolarPriceCheck', () => {
  const sizingTiers = [
    { tier: 'good', panels_count: 10, system_kw_dc: 4.4 },
    { tier: 'better', panels_count: 15, system_kw_dc: 6.6 },
  ] as unknown as SolarSystemTier[]

  function priceTier(tier: string, grossIncGst: number): SolarPriceTier {
    return {
      tier,
      system_kw_dc: tier === 'good' ? 4.4 : 6.6,
      gross_inc_gst: grossIncGst,
      net_inc_gst: grossIncGst - 2000,
    } as unknown as SolarPriceTier
  }

  it('no flags when the engine price sits within ±25% of the scheme', () => {
    // Scheme: $1.10/W → good $4,840 · better $7,260.
    const check = buildOpenSolarPriceCheck({
      scheme: scheme(),
      priceTiers: [priceTier('good', 5200), priceTier('better', 7900)],
      sizingTiers,
    })
    expect(check).not.toBeNull()
    expect(check!.tiers.every((t) => t.flag === null)).toBe(true)
    expect(check!.tiers[0].opensolar_price).toBeCloseTo(4840, 0)
    expect(check!.tiers[0].delta_pct).not.toBeNull()
  })

  it('flags a tier diverging beyond ±25%', () => {
    const check = buildOpenSolarPriceCheck({
      scheme: scheme(),
      priceTiers: [priceTier('good', 9900), priceTier('better', 7900)],
      sizingTiers,
    })
    const good = check!.tiers.find((t) => t.tier === 'good')!
    expect(good.flag).toMatch(/diverges \+\d+(\.\d+)?% from your OpenSolar pricing scheme/)
    expect(check!.tiers.find((t) => t.tier === 'better')!.flag).toBeNull()
  })

  it('null when no tier price could be computed (unsupported formula)', () => {
    const check = buildOpenSolarPriceCheck({
      scheme: scheme({ pricing_formula: 'Markup Percentage', configuration: {} }),
      priceTiers: [priceTier('good', 5200)],
      sizingTiers,
    })
    expect(check).toBeNull()
  })
})

describe('buildOpenSolarHardware', () => {
  const row = (over: Partial<OpenSolarCatalogueRow>): OpenSolarCatalogueRow => ({
    kind: 'module',
    manufacturer: 'LG Energy',
    code: 'LG330N1C-A5',
    kw_stc: 0.33,
    product_warranty_years: 25,
    technology: 'Mono-c-Si',
    is_default: false,
    ...over,
  })

  it('defaults sort first and each kind caps at three', () => {
    const rows = [
      row({ code: 'A' }),
      row({ code: 'B' }),
      row({ code: 'C', is_default: true }),
      row({ code: 'D' }),
      row({ kind: 'inverter', code: 'INV-1', kw_stc: null }),
    ]
    const hardware = buildOpenSolarHardware(rows)!
    const modules = hardware.filter((h) => h.kind === 'module')
    expect(modules).toHaveLength(3)
    expect(modules[0].code).toBe('C') // default first
    expect(hardware.some((h) => h.kind === 'inverter')).toBe(true)
  })

  it('null on an empty catalogue', () => {
    expect(buildOpenSolarHardware([])).toBeNull()
  })
})
