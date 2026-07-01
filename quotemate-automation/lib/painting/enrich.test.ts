import { describe, it, expect } from 'vitest'
import { applyEnrichment } from './enrich'
import { measurePaintableArea } from './area'
import type { PropertyFacts, PaintUserInputs } from './types'

const BASE: PropertyFacts = {
  floor_area_m2: null,
  floor_area_source: null,
  footprint_m2: 150,
  storeys: null,
  bedrooms: null,
  bathrooms: null,
  year_built: null,
  property_type: null,
  land_size_m2: null,
  has_floor_plan: false,
  source: 'solar',
  capture_note: 'Footprint from Google Solar.',
}

describe('applyEnrichment', () => {
  it('fills storeys/eave/type from Geoscape without overwriting the Solar footprint', () => {
    const { facts } = applyEnrichment(BASE, {
      geoscape: {
        patch: { storeys: 2, eave_height_m: 8.94, property_type: 'Residential', footprint_m2: 213.9 },
        notes: ['Storeys (2) from Geoscape.'],
      },
    })
    expect(facts.storeys).toBe(2)
    expect(facts.eave_height_m).toBe(8.94)
    expect(facts.property_type).toBe('Residential')
    expect(facts.footprint_m2).toBe(150) // Solar footprint preserved
    expect(facts.capture_note).toContain('Storeys (2) from Geoscape')
  })

  it('lets PropRadar override zoning type and set a listing floor area', () => {
    const { facts } = applyEnrichment(BASE, {
      geoscape: { patch: { property_type: 'Residential' }, notes: [] },
      propradar: {
        patch: {
          bedrooms: 3, bathrooms: 2, car_spaces: 1, property_type: 'House',
          land_size_m2: 600, floor_area_m2: 180, floor_area_source: 'listing', year_built: 1990,
        },
        notes: ['Property attributes from a PropRadar live listing.'],
        found: true,
      },
    })
    expect(facts.property_type).toBe('House') // PropRadar overrides Geoscape zoning
    expect(facts.floor_area_m2).toBe(180)
    expect(facts.floor_area_source).toBe('listing')
    expect(facts.bedrooms).toBe(3)
    expect(facts.car_spaces).toBe(1)
    expect(facts.year_built).toBe(1990)
  })

  it('ignores a PropRadar patch when found is false', () => {
    const { facts } = applyEnrichment(BASE, { propradar: { patch: { bedrooms: 3 }, notes: [], found: false } })
    expect(facts.bedrooms).toBeNull()
  })

  it('does not override storeys already set on the base', () => {
    const { facts } = applyEnrichment({ ...BASE, storeys: 1 }, {
      geoscape: { patch: { storeys: 3 }, notes: [] },
    })
    expect(facts.storeys).toBe(1)
  })

  it('leaves facts unchanged when there are no sources', () => {
    const { facts, notes } = applyEnrichment(BASE, {})
    expect(facts).toEqual(BASE)
    expect(notes).toEqual([])
  })
})

describe('area engine — eave height', () => {
  const inputs: PaintUserInputs = {
    scopes: ['exterior'],
    coats: 2,
    condition: 'sound',
    ceiling_height: 'standard',
    colour_change: false,
    storeys: 1,
  }
  const factsNoEave: PropertyFacts = { ...BASE, footprint_m2: 200, storeys: 1 }

  it('increases exterior area and notes the source when eave height is present', () => {
    const noEave = measurePaintableArea(factsNoEave, inputs)!
    const withEave = measurePaintableArea({ ...factsNoEave, eave_height_m: 8.94 }, inputs)!
    const ext = (m: NonNullable<typeof noEave>) => m.surfaces.find((s) => s.scope === 'exterior')!.quantity
    expect(ext(withEave)).toBeGreaterThan(ext(noEave))
    expect(withEave.notes.some((n) => /eave height/i.test(n))).toBe(true)
  })
})
