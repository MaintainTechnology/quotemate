import { describe, it, expect } from 'vitest'
import {
  selectBuildingEligibility,
  findBuilding,
  updateBuildingStatus,
} from './building-cache'
import type { DetectedBuilding } from './types'

function building(over: Partial<DetectedBuilding> = {}): DetectedBuilding {
  return {
    building_id: 'b0',
    role: 'primary',
    label: 'Main building',
    centroid: { lat: -33.8, lng: 151.2 },
    footprint: null,
    area_m2: 180,
    roof_shape: 'hip',
    storeys: 1,
    solar_status: 'pending',
    ...over,
  }
}

describe('selectBuildingEligibility', () => {
  it('allows a switch on an unreleased estimate for a known building', () => {
    expect(
      selectBuildingEligibility({ confirmedAt: null, buildingExists: true }),
    ).toEqual({ ok: true })
  })

  it('404s an unknown building', () => {
    const r = selectBuildingEligibility({ confirmedAt: null, buildingExists: false })
    expect(r).toMatchObject({ ok: false, status: 404 })
  })

  it('409-locks a released (confirmed) estimate', () => {
    const r = selectBuildingEligibility({
      confirmedAt: '2026-06-16T00:00:00Z',
      buildingExists: true,
    })
    expect(r).toMatchObject({ ok: false, status: 409 })
  })
})

describe('findBuilding', () => {
  const list = [building({ building_id: 'house' }), building({ building_id: 'shed', role: 'secondary' })]
  it('finds by id', () => {
    expect(findBuilding(list, 'shed')?.role).toBe('secondary')
  })
  it('returns null for a miss', () => {
    expect(findBuilding(list, 'nope')).toBeNull()
  })
})

describe('updateBuildingStatus', () => {
  const list = [building({ building_id: 'house' }), building({ building_id: 'shed', role: 'secondary' })]

  it('updates only the targeted building, immutably', () => {
    const next = updateBuildingStatus(list, 'shed', 'no_coverage')
    expect(next.find((b) => b.building_id === 'shed')?.solar_status).toBe('no_coverage')
    expect(next.find((b) => b.building_id === 'house')?.solar_status).toBe('pending')
    expect(list.find((b) => b.building_id === 'shed')?.solar_status).toBe('pending') // original untouched
  })

  it('is a no-op for an unknown id', () => {
    const next = updateBuildingStatus(list, 'nope', 'ready')
    expect(next).toEqual(list)
  })
})
