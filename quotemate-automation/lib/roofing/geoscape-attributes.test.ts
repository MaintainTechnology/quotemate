// Premium Geoscape building attributes — extraction + end-to-end flow into
// the measurement payload both consumer contexts (customer + tradie) render.
//
// The stubbed sub-resource shapes are verbatim from a live paid-key probe on
// 2026-07-01 (28 Greens Rd, Coorparoo QLD): roofMaterial "Metal", roofShape
// "Hipped", area 248.11, maximumRoofHeight 6.91, averageEaveHeight 5.55,
// elevation 19.61, solarPanel true, overhangingTree { overhangingTree: false }.

import { describe, expect, it, vi } from 'vitest'
import {
  GeoscapeProvider,
  buildGeoscapeAttributes,
  extractElevation,
  extractEaveHeight,
  extractMaxRoofHeight,
  extractOverhangingTree,
  extractRoofComplexity,
  extractRoofMaterial,
  extractSolarPanel,
} from './providers/geoscape'
import { measureAndPriceRoofs } from './measure'
import { buildingAttributeChips } from './attributes-display'
import type { RoofAddressInput, RoofUserInputs } from './types'

const ADDR: RoofAddressInput = { address: '28 Greens Rd, Coorparoo QLD 4151', postcode: '4151', state: 'QLD' }
const INPUTS: RoofUserInputs = { material: 'colorbond_corrugated', pitch: 'standard', intent: 'full_reroof' }

// ~10m × 10m MultiPolygon (4-deep) at Sydney lat → ~100 m², the real
// /footprint2d shape (MultiPolygon coordinates).
const SQUARE_MULTI: number[][][][] = [[[
  [151.2, -33.8],
  [151.2001081, -33.8],
  [151.2001081, -33.8000905],
  [151.2, -33.8000905],
  [151.2, -33.8],
]]]

/** A stub fetch that serves the full paid link-based flow: address →
 *  buildings list (all premium links) → every sub-resource by URL suffix,
 *  each returning the verbatim live shape. */
function stubFullFetch() {
  const J = (obj: unknown) => Promise.resolve(new Response(JSON.stringify(obj), { status: 200 }))
  return vi.fn().mockImplementation((url: RequestInfo | URL) => {
    const s = String(url)
    if (s.includes('/addresses?')) return J({ data: [{ addressId: 'GAQLD155218808' }], links: {} })
    if (s.includes('/buildings?addressId=')) {
      return J({
        countByCoverageType: { urban: 1 },
        data: [{
          buildingId: 'bld1',
          coverageType: 'Urban',
          relatedAddressIds: ['GAQLD155218808'],
          links: {
            footprint2d: '/v1/buildings/bld1/footprint2d',
            roofShape: '/v1/buildings/bld1/roofShape',
            estimatedLevels: '/v1/buildings/bld1/estimatedLevels',
            area: '/v1/buildings/bld1/area',
            roofMaterial: '/v1/buildings/bld1/roofMaterial',
            roofComplexity: '/v1/buildings/bld1/roofComplexity',
            maximumRoofHeight: '/v1/buildings/bld1/maximumRoofHeight',
            averageEaveHeight: '/v1/buildings/bld1/averageEaveHeight',
            elevation: '/v1/buildings/bld1/elevation',
            solarPanel: '/v1/buildings/bld1/solarPanel',
            overhangingTree: '/v1/buildings/bld1/overhangingTree',
          },
        }],
      })
    }
    if (s.endsWith('/footprint2d')) return J({ buildingId: 'bld1', footprint2d: { coordinates: SQUARE_MULTI, type: 'MultiPolygon' } })
    if (s.endsWith('/roofShape')) return J({ buildingId: 'bld1', roofShape: 'Hipped' })
    if (s.endsWith('/estimatedLevels')) return J({ buildingId: 'bld1', estimatedLevels: 1 })
    if (s.endsWith('/area')) return J({ area: 248.11, buildingId: 'bld1' })
    if (s.endsWith('/roofMaterial')) return J({ buildingId: 'bld1', roofMaterial: 'Metal' })
    if (s.endsWith('/roofComplexity')) return J({ roofComplexity: 'Moderate pitch or complexity' })
    if (s.endsWith('/maximumRoofHeight')) return J({ buildingId: 'bld1', maximumRoofHeight: 6.91 })
    if (s.endsWith('/averageEaveHeight')) return J({ averageEaveHeight: 5.55, buildingId: 'bld1' })
    if (s.endsWith('/elevation')) return J({ elevation: 19.61, buildingId: 'bld1' })
    if (s.endsWith('/solarPanel')) return J({ solarPanel: true, buildingId: 'bld1' })
    if (s.endsWith('/overhangingTree')) return J({ overhangingTree: { overhangingTree: false }, buildingId: 'bld1' })
    return Promise.resolve(new Response('miss', { status: 404 }))
  })
}

describe('premium attribute extractors (live shapes)', () => {
  it('reads roofMaterial / roofComplexity', () => {
    expect(extractRoofMaterial({ buildingId: 'x', roofMaterial: 'Metal' })).toBe('Metal')
    expect(extractRoofComplexity({ roofComplexity: 'Moderate pitch or complexity' })).toBe('Moderate pitch or complexity')
    expect(extractRoofMaterial({})).toBeNull()
  })
  it('reads the height / elevation numbers', () => {
    expect(extractMaxRoofHeight({ maximumRoofHeight: 6.91 })).toBe(6.91)
    expect(extractEaveHeight({ averageEaveHeight: 5.55 })).toBe(5.55)
    expect(extractElevation({ elevation: 19.61 })).toBe(19.61)
    expect(extractMaxRoofHeight({})).toBeNull()
  })
  it('reads the solar flag', () => {
    expect(extractSolarPanel({ solarPanel: true })).toBe(true)
    expect(extractSolarPanel({ solarPanel: false })).toBe(false)
    expect(extractSolarPanel({})).toBeNull()
  })
  it('reads the nested overhangingTree shape (and a flat fallback)', () => {
    expect(extractOverhangingTree({ overhangingTree: { overhangingTree: false } })).toBe(false)
    expect(extractOverhangingTree({ overhangingTree: true })).toBe(true)
    expect(extractOverhangingTree({})).toBeNull()
  })
})

describe('buildGeoscapeAttributes', () => {
  it('assembles every field and derives roof rise (ridge − eave)', () => {
    const a = buildGeoscapeAttributes({
      roofMaterial: { roofMaterial: 'Metal' },
      roofComplexity: { roofComplexity: 'Moderate pitch or complexity' },
      maxRoofHeight: { maximumRoofHeight: 6.91 },
      eaveHeight: { averageEaveHeight: 5.55 },
      elevation: { elevation: 19.61 },
      solarPanel: { solarPanel: true },
      overhangingTree: { overhangingTree: { overhangingTree: false } },
    })
    expect(a).toEqual({
      roof_material: 'Metal',
      roof_complexity: 'Moderate pitch or complexity',
      max_roof_height_m: 6.91,
      eave_height_m: 5.55,
      ground_elevation_m: 19.61,
      roof_rise_m: 1.36,
      solar_panel: true,
      overhanging_tree: false,
    })
  })
  it('returns null when every sub-resource is missing (free tier / 403)', () => {
    expect(
      buildGeoscapeAttributes({
        roofMaterial: null, roofComplexity: null, maxRoofHeight: null,
        eaveHeight: null, elevation: null, solarPanel: null, overhangingTree: null,
      }),
    ).toBeNull()
  })
  it('omits roof rise when a height is missing but keeps the rest', () => {
    const a = buildGeoscapeAttributes({
      roofMaterial: { roofMaterial: 'Tile' }, roofComplexity: null,
      maxRoofHeight: { maximumRoofHeight: 6.9 }, eaveHeight: null,
      elevation: null, solarPanel: null, overhangingTree: null,
    })
    expect(a?.roof_material).toBe('Tile')
    expect(a?.roof_rise_m).toBeNull()
  })
})

describe('GeoscapeProvider.measure — premium attributes on the metrics', () => {
  it('populates building_attributes from all 7 sub-resources', async () => {
    const p = new GeoscapeProvider({ apiKey: 'fake', fetchImpl: stubFullFetch() })
    const r = await p.measure(ADDR)
    expect(r.ok).toBe(true)
    if (r.ok) {
      const a = r.metrics.building_attributes
      expect(a).toBeTruthy()
      expect(a?.roof_material).toBe('Metal')
      expect(a?.roof_complexity).toBe('Moderate pitch or complexity')
      expect(a?.max_roof_height_m).toBe(6.91)
      expect(a?.eave_height_m).toBe(5.55)
      expect(a?.roof_rise_m).toBe(1.36)
      expect(a?.ground_elevation_m).toBe(19.61)
      expect(a?.solar_panel).toBe(true)
      expect(a?.overhanging_tree).toBe(false)
    }
  })

  it('leaves building_attributes null when the premium sub-resources 403/404 (free tier)', async () => {
    // Serve address + buildings + the 4 base sub-resources; 404 the premium 7.
    const J = (obj: unknown) => Promise.resolve(new Response(JSON.stringify(obj), { status: 200 }))
    const fetchImpl = vi.fn().mockImplementation((url: RequestInfo | URL) => {
      const s = String(url)
      if (s.includes('/addresses?')) return J({ data: [{ addressId: 'a1' }] })
      if (s.includes('/buildings?addressId=')) {
        return J({ data: [{ buildingId: 'bld1', relatedAddressIds: ['a1'], links: { footprint2d: '/v1/buildings/bld1/footprint2d' } }] })
      }
      if (s.endsWith('/footprint2d')) return J({ footprint2d: { coordinates: SQUARE_MULTI } })
      if (s.endsWith('/roofShape')) return J({ roofShape: 'Hipped' })
      if (s.endsWith('/estimatedLevels')) return J({ estimatedLevels: 1 })
      if (s.endsWith('/area')) return J({ area: 200 })
      return Promise.resolve(new Response(JSON.stringify({ messages: ['To access premium data, upgrade to a paid plan'] }), { status: 403 }))
    })
    const p = new GeoscapeProvider({ apiKey: 'fake', fetchImpl })
    const r = await p.measure(ADDR)
    expect(r.ok).toBe(true)
    if (r.ok) {
      // Base measurement still succeeds; premium block is simply absent.
      expect(r.metrics.footprint_m2).toBe(200)
      expect(r.metrics.building_attributes ?? null).toBeNull()
    }
  })
})

describe('sub-resource fan-out survives Geoscape 429 rate-limiting', () => {
  it('retries 429s so every attribute still loads (no silent nulls)', async () => {
    const hits: Record<string, number> = {}
    const J = (obj: unknown) => new Response(JSON.stringify(obj), { status: 200 })
    const fetchImpl = vi.fn().mockImplementation((url: RequestInfo | URL) => {
      const s = String(url)
      if (s.includes('/addresses?')) return Promise.resolve(J({ data: [{ addressId: 'a1' }] }))
      if (s.includes('/buildings?addressId=')) {
        return Promise.resolve(J({ data: [{ buildingId: 'bld1', relatedAddressIds: ['a1'], links: {} }] }))
      }
      // First hit of each sub-resource → 429; the retry (2nd hit) → 200.
      const key = s.split('/').pop() ?? s
      hits[key] = (hits[key] ?? 0) + 1
      if (hits[key] === 1) return Promise.resolve(new Response('rate limited', { status: 429 }))
      if (key === 'footprint2d') return Promise.resolve(J({ footprint2d: { coordinates: SQUARE_MULTI } }))
      if (key === 'roofShape') return Promise.resolve(J({ roofShape: 'Hipped' }))
      if (key === 'estimatedLevels') return Promise.resolve(J({ estimatedLevels: 1 }))
      if (key === 'area') return Promise.resolve(J({ area: 200 }))
      if (key === 'roofMaterial') return Promise.resolve(J({ roofMaterial: 'Metal' }))
      if (key === 'roofComplexity') return Promise.resolve(J({ roofComplexity: 'Simple' }))
      if (key === 'maximumRoofHeight') return Promise.resolve(J({ maximumRoofHeight: 6.9 }))
      if (key === 'averageEaveHeight') return Promise.resolve(J({ averageEaveHeight: 5.5 }))
      if (key === 'elevation') return Promise.resolve(J({ elevation: 19.6 }))
      if (key === 'solarPanel') return Promise.resolve(J({ solarPanel: true }))
      if (key === 'overhangingTree') return Promise.resolve(J({ overhangingTree: { overhangingTree: false } }))
      return Promise.resolve(new Response('miss', { status: 404 }))
    })
    const p = new GeoscapeProvider({ apiKey: 'fake', fetchImpl })
    const r = await p.measure(ADDR)
    expect(r.ok).toBe(true)
    if (r.ok) {
      const a = r.metrics.building_attributes
      expect(a?.roof_material).toBe('Metal') // survived a 429
      expect(a?.eave_height_m).toBe(5.5) // survived a 429
      expect(a?.solar_panel).toBe(true) // survived a 429
      expect(hits['roofMaterial']).toBe(2) // one 429 + one success
    }
  }, 15000)
})

describe('end-to-end — enriched payload reaches BOTH consumer contexts', () => {
  it('survives measureAndPriceRoofs into the priced structure both views render', async () => {
    const provider = new GeoscapeProvider({ apiKey: 'fake', fetchImpl: stubFullFetch() })
    const result = await measureAndPriceRoofs(ADDR, INPUTS, { provider })
    expect(result.ok).toBe(true)
    if (result.ok) {
      // The object customer (/q/roof) and tradie (dashboard) both consume is
      // quote.structures[i].metrics — assert the premium block is intact here.
      const metrics = result.quote.structures[0].metrics
      expect(metrics.building_attributes?.roof_material).toBe('Metal')
      expect(metrics.building_attributes?.solar_panel).toBe(true)
      expect(metrics.building_attributes?.roof_rise_m).toBe(1.36)

      // And the shared display helper both views use surfaces every field.
      const chips = buildingAttributeChips(metrics)
      const labels = chips.map(([label]) => label)
      expect(labels).toEqual(
        expect.arrayContaining([
          'Material', 'Complexity', 'Ridge height', 'Eave height',
          'Roof rise', 'Ground elevation', 'Existing solar', 'Tree overhang',
        ]),
      )
      expect(chips.find(([l]) => l === 'Material')?.[1]).toBe('Metal')
      expect(chips.find(([l]) => l === 'Existing solar')?.[1]).toBe('Yes')
    }
  })
})
