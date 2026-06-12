import { describe, expect, it, vi } from 'vitest'
import {
  enrichPylonHardware,
  hardwareFloorFlags,
  hasPylonSkus,
  parsePylonSkuSettings,
  runPylonHardwareSupplement,
  type PylonHardwareComponent,
} from './pylon-hardware'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

/** Routes datasheet + price lookups for any SKU. */
function buildFetchImpl(priceCentsBySku: Record<string, number | null> = {}) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = decodeURIComponent(String(input))
    if (url.includes('/v1/component_prices')) {
      const sku = /filter\[component\.id\]=([^&]+)/.exec(url)?.[1] ?? ''
      const cents = priceCentsBySku[sku]
      return jsonResponse({
        data:
          cents != null
            ? [{ id: 'p1', attributes: { price_excl_tax: cents, cost_excl_tax: null, is_latest: true } }]
            : [],
      })
    }
    // Datasheet endpoints.
    const sku = url.split('/').pop()!.split('?')[0]
    return jsonResponse({
      data: {
        id: sku,
        attributes: {
          name: `Component ${sku}`,
          identity: { brand: 'Brand', series: 'Series', model_number: `M-${sku}` },
          files: { datasheet_url: `https://static.getpylon.com/ds/${sku}.pdf` },
        },
      },
    })
  })
}

describe('parsePylonSkuSettings', () => {
  it('parses a valid settings object, trimming + nulling empties', () => {
    const s = parsePylonSkuSettings({ module_sku: ' abc ', inverter_sku: '', battery_sku: null })
    expect(s.module_sku).toBe('abc')
    expect(s.inverter_sku).toBeNull()
    expect(s.battery_sku).toBeNull()
  })
  it('tolerates garbage', () => {
    expect(parsePylonSkuSettings(null)).toEqual({})
    expect(parsePylonSkuSettings('nope')).toEqual({})
    expect(parsePylonSkuSettings([1, 2])).toEqual({})
    expect(parsePylonSkuSettings({ module_sku: 42 }).module_sku).toBeNull()
  })
  it('hasPylonSkus needs at least one SKU', () => {
    expect(hasPylonSkus({})).toBe(false)
    expect(hasPylonSkus({ module_sku: 'x' })).toBe(true)
  })
})

describe('enrichPylonHardware', () => {
  it('fetches datasheet + price per nominated SKU', async () => {
    const fetchImpl = buildFetchImpl({ 'sku-mod': 15000, 'sku-inv': 180000 })
    const components = await enrichPylonHardware(
      { module_sku: 'sku-mod', inverter_sku: 'sku-inv', battery_sku: null },
      { apiKey: 'k', fetchImpl },
    )
    expect(components).toHaveLength(2)
    const panel = components.find((c) => c.kind === 'module')!
    expect(panel.name).toBe('Component sku-mod')
    expect(panel.brand).toBe('Brand')
    expect(panel.datasheet_url).toContain('sku-mod.pdf')
    expect(panel.price_excl_tax_cents).toBe(15000)
  })

  it('drops components whose datasheet 404s, keeps the rest', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/v1/solar_modules/')) return new Response('{}', { status: 404 })
      if (url.includes('/v1/component_prices')) return jsonResponse({ data: [] })
      return jsonResponse({
        data: { id: 'sku-inv', attributes: { name: 'Inverter X', identity: {}, files: {} } },
      })
    })
    const components = await enrichPylonHardware(
      { module_sku: 'bad-sku', inverter_sku: 'sku-inv' },
      { apiKey: 'k', fetchImpl },
    )
    expect(components).toHaveLength(1)
    expect(components[0].kind).toBe('inverter')
  })

  it('empty settings → no calls, empty result', async () => {
    const fetchImpl = vi.fn()
    expect(await enrichPylonHardware({}, { apiKey: 'k', fetchImpl })).toEqual([])
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})

describe('hardwareFloorFlags', () => {
  const components: PylonHardwareComponent[] = [
    {
      kind: 'module', sku: 'm', name: 'Panel', brand: null, series: null, model_number: null,
      datasheet_url: null, price_excl_tax_cents: 20000, cost_excl_tax_cents: null, // $200/panel
    },
    {
      kind: 'inverter', sku: 'i', name: 'Inv', brand: null, series: null, model_number: null,
      datasheet_url: null, price_excl_tax_cents: 200000, cost_excl_tax_cents: null, // $2,000
    },
  ]
  const sizingTiers = [
    { tier: 'good' as const, panels_count: 15 },
    { tier: 'better' as const, panels_count: 24 },
  ]

  it('clean when every tier prices above its hardware floor', () => {
    // good floor: 15×$200 + $2,000 = $5,000 · better: 24×$200+$2,000 = $6,800
    const flags = hardwareFloorFlags({
      components,
      priceTiers: [
        { tier: 'good', net_ex_gst: 6000 },
        { tier: 'better', net_ex_gst: 9000 },
      ],
      sizingTiers,
    })
    expect(flags).toEqual([])
  })

  it('flags a tier quoted below the tradie\u2019s own hardware cost', () => {
    const flags = hardwareFloorFlags({
      components,
      priceTiers: [
        { tier: 'good', net_ex_gst: 4500 }, // below the $5,000 floor
        { tier: 'better', net_ex_gst: 9000 },
      ],
      sizingTiers,
    })
    expect(flags).toHaveLength(1)
    expect(flags[0]).toContain('hardware_cost_exceeds_price:good')
    expect(flags[0]).toContain('$5,000')
  })

  it('no panel price → cannot check → no flags', () => {
    const flags = hardwareFloorFlags({
      components: [{ ...components[0], price_excl_tax_cents: null }],
      priceTiers: [{ tier: 'good', net_ex_gst: 1 }],
      sizingTiers,
    })
    expect(flags).toEqual([])
  })
})

describe('runPylonHardwareSupplement', () => {
  const env = { PYLON_ENABLED: 'true', PYLON_API_KEY: 'k' }

  it('null when disabled or no SKUs nominated', async () => {
    expect(
      await runPylonHardwareSupplement({ settings: { module_sku: 'x' }, env: {} }),
    ).toBeNull()
    expect(
      await runPylonHardwareSupplement(
        { settings: null, env },
        { fetchImpl: vi.fn() },
      ),
    ).toBeNull()
  })

  it('returns components when enabled with SKUs', async () => {
    const res = await runPylonHardwareSupplement(
      { settings: { module_sku: 'sku-mod' }, env },
      { fetchImpl: buildFetchImpl({ 'sku-mod': 15000 }) },
    )
    expect(res).toHaveLength(1)
    expect(res![0].kind).toBe('module')
  })
})
