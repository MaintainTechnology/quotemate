import { describe, expect, it } from 'vitest'
import { toPaintStructureOptions } from './structures'
import type { DetectedBuilding } from '@/lib/solar/types'

const building = (over: Partial<DetectedBuilding>): DetectedBuilding => ({
  building_id: 'b0',
  role: 'primary',
  label: 'Main building',
  centroid: { lat: -27.5, lng: 153.05 },
  footprint: { type: 'Polygon', coordinates: [[[153.05, -27.5]]] },
  area_m2: 142,
  roof_shape: null,
  storeys: 1,
  solar_status: 'pending',
  ...over,
})

describe('toPaintStructureOptions', () => {
  it('maps detected buildings to picker options, primary first', () => {
    const opts = toPaintStructureOptions([
      building({}),
      building({ building_id: 'b1', role: 'secondary', label: 'Secondary building 1', area_m2: 38, storeys: null }),
    ])
    expect(opts).toEqual([
      { building_id: 'b0', label: 'Main building', role: 'primary', area_m2: 142, storeys: 1 },
      { building_id: 'b1', label: 'Secondary building 1', role: 'secondary', area_m2: 38, storeys: null },
    ])
  })

  it('drops structures without a usable footprint area', () => {
    const opts = toPaintStructureOptions([
      building({}),
      building({ building_id: 'b1', role: 'secondary', area_m2: null }),
      building({ building_id: 'b2', role: 'secondary', area_m2: 0 }),
    ])
    expect(opts.map((o) => o.building_id)).toEqual(['b0'])
  })
})
