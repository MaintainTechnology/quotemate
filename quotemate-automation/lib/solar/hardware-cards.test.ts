import { describe, expect, it } from 'vitest'
import { buildSolarHardwareCards } from './hardware-cards'
import type { SolarEstimateContext } from './types'

type Components = NonNullable<SolarEstimateContext['pylon_components']>

const full: Components[number] = {
  kind: 'module',
  sku: 'sku-1',
  name: 'Tindo Solar Karra 72 Cell Series 380W',
  brand: 'Tindo Solar',
  series: 'Karra 72 Cell Series',
  model_number: 'Karra-380',
  datasheet_url: 'https://static.getpylon.com/ds.pdf',
  price_excl_tax_cents: 15000,
  cost_excl_tax_cents: 12000,
}

describe('buildSolarHardwareCards', () => {
  it('builds customer-facing cards and NEVER carries prices', () => {
    const cards = buildSolarHardwareCards({ pylon_components: [full] })
    expect(cards).toHaveLength(1)
    expect(cards[0].kindLabel).toBe('Solar panels')
    expect(cards[0].name).toBe('Tindo Solar Karra 72 Cell Series 380W')
    expect(cards[0].detail).toBe('Tindo Solar · Karra 72 Cell Series · Karra-380')
    expect(cards[0].datasheetUrl).toContain('ds.pdf')
    // The internal price fields must not leak into the card shape.
    expect(JSON.stringify(cards[0])).not.toContain('15000')
    expect(JSON.stringify(cards[0])).not.toContain('cents')
  })

  it('falls back to brand+model when name is missing; skips empty rows', () => {
    const cards = buildSolarHardwareCards({
      pylon_components: [
        { ...full, kind: 'inverter', name: null },
        { ...full, kind: 'battery', name: null, brand: null, series: null, model_number: null },
      ],
    })
    expect(cards).toHaveLength(1)
    expect(cards[0].kindLabel).toBe('Inverter')
    expect(cards[0].name).toBe('Tindo Solar Karra 72 Cell Series Karra-380')
  })

  it('empty/absent supplement → no cards', () => {
    expect(buildSolarHardwareCards({ pylon_components: null })).toEqual([])
    expect(buildSolarHardwareCards({})).toEqual([])
  })

  // ── OpenSolar catalogue fallback (enrichment build 2026-06-13) ──────
  const osModule = {
    kind: 'module' as const,
    manufacturer: 'LG Energy',
    code: 'LG330N1C-A5',
    kw_stc: 0.33,
    product_warranty_years: 25,
    technology: 'Mono-c-Si',
  }

  it('OpenSolar catalogue fills kinds Pylon did not cover', () => {
    const cards = buildSolarHardwareCards({
      pylon_components: [full], // covers 'module'
      opensolar: {
        checked_at: 'now',
        hardware: [osModule, { ...osModule, kind: 'inverter', code: 'Primo 5.0-1', kw_stc: null }],
        price_check: null,
      },
    })
    // Pylon module wins; OpenSolar inverter fills the gap.
    expect(cards).toHaveLength(2)
    expect(cards[0].name).toContain('Tindo')
    expect(cards[1].kindLabel).toBe('Inverter')
    expect(cards[1].name).toBe('LG Energy Primo 5.0-1')
  })

  it('OpenSolar-only context renders wattage/technology/warranty detail', () => {
    const cards = buildSolarHardwareCards({
      opensolar: { checked_at: 'now', hardware: [osModule], price_check: null },
    })
    expect(cards).toHaveLength(1)
    expect(cards[0].kindLabel).toBe('Solar panels')
    expect(cards[0].name).toBe('LG Energy LG330N1C-A5')
    expect(cards[0].detail).toBe('330 W · Mono-c-Si · 25-yr warranty')
    expect(cards[0].datasheetUrl).toBeNull()
  })
})
