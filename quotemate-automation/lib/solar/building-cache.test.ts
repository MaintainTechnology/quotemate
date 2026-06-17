import { describe, it, expect } from 'vitest'
import {
  selectBuildingEligibility,
  findBuilding,
  updateBuildingStatus,
  resolveCreationSelection,
  CUSTOM_BUILDING_ID,
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

describe('resolveCreationSelection', () => {
  const house = building({ building_id: 'house', role: 'primary' })
  const shed = building({ building_id: 'shed', role: 'secondary' })

  it('selects a picked DETECTED building and marks it ready', () => {
    const r = resolveCreationSelection({
      detected: [house, shed],
      target: { building_id: 'shed', centroid: shed.centroid },
    })
    expect(r?.selectedBuildingId).toBe('shed')
    expect(r?.buildings.find((b) => b.building_id === 'shed')?.solar_status).toBe('ready')
    // No custom entry appended — the pick exists in the detected list.
    expect(r?.buildings).toHaveLength(2)
  })

  it('keeps a FREE-PICK (custom) selected instead of snapping to the primary', () => {
    // The reported bug: a free-tapped roof must not jump to the main house.
    const picked = { lat: -33.81, lng: 151.21 }
    const r = resolveCreationSelection({
      detected: [house, shed],
      target: { building_id: CUSTOM_BUILDING_ID, centroid: picked },
    })
    expect(r?.selectedBuildingId).toBe(CUSTOM_BUILDING_ID)
    const custom = r?.buildings.find((b) => b.building_id === CUSTOM_BUILDING_ID)
    expect(custom?.centroid).toEqual(picked)
    expect(custom?.solar_status).toBe('ready')
    expect(r?.buildings).toHaveLength(3) // house + shed + custom
  })

  it('appends a custom entry when a picked id did not survive re-detection', () => {
    const picked = { lat: -33.82, lng: 151.22 }
    const r = resolveCreationSelection({
      detected: [house, shed],
      target: { building_id: 'stale-id', centroid: picked },
    })
    expect(r?.selectedBuildingId).toBe(CUSTOM_BUILDING_ID)
    expect(r?.buildings.find((b) => b.building_id === CUSTOM_BUILDING_ID)?.centroid).toEqual(picked)
  })

  it('replaces a prior custom entry rather than stacking duplicates', () => {
    const stale = building({ building_id: CUSTOM_BUILDING_ID, role: 'secondary' })
    const picked = { lat: -33.83, lng: 151.23 }
    const r = resolveCreationSelection({
      detected: [house, stale],
      target: { building_id: CUSTOM_BUILDING_ID, centroid: picked },
    })
    const customs = r?.buildings.filter((b) => b.building_id === CUSTOM_BUILDING_ID) ?? []
    expect(customs).toHaveLength(1)
    expect(customs[0].centroid).toEqual(picked)
  })

  it('falls back to the primary dwelling when there is no pick', () => {
    const r = resolveCreationSelection({ detected: [house, shed], target: null })
    expect(r?.selectedBuildingId).toBe('house')
    expect(r?.buildings.find((b) => b.building_id === 'house')?.solar_status).toBe('ready')
  })

  it('returns null when nothing was detected and there is no pick', () => {
    expect(resolveCreationSelection({ detected: [], target: null })).toBeNull()
  })
})
