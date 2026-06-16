// ════════════════════════════════════════════════════════════════════
// Solar — building-picker switch logic (multi-roof, approach A).
//
// PURE decision + state helpers behind "switch which building this
// estimate is for". The select-building route owns the I/O (load row,
// read/write solar_building_cache, run the engine, regenerate assets);
// these helpers decide WHETHER a switch is allowed and how the property
// row's buildings list transitions — fully unit-testable, no DB/network.
//
// Gating (spec): a switch is allowed only while the estimate is
// UNRELEASED (confirmed_at IS NULL). Once released, the roof is locked —
// the customer must not have a released quote re-pointed under their feet,
// and the tradie creates a NEW estimate to quote a different building
// (mirrors redraftEligibility).
// ════════════════════════════════════════════════════════════════════

import type {
  DetectedBuilding,
  SolarBuildingSolarStatus,
  SolarEstimate,
} from './types'

/** One persisted per-building lazy-compute cache row (migration 114). */
export type SolarBuildingCacheRow = {
  estimate_id: string
  building_id: string
  estimate: SolarEstimate
  computed_at: string
}

export type SelectBuildingEligibility =
  | { ok: true }
  | { ok: false; status: number; error: string }

/**
 * PURE — may this property's selected building be switched?
 *   • unknown building_id           → 404
 *   • already released (confirmed)  → 409 (locked; create a new estimate)
 *   • otherwise                     → ok
 *
 * Audience (customer vs tradie) is an AUTH concern enforced by the route;
 * the rule itself is identical for both — a released quote is immutable.
 */
export function selectBuildingEligibility(input: {
  confirmedAt: string | null
  buildingExists: boolean
}): SelectBuildingEligibility {
  if (!input.buildingExists) {
    return { ok: false, status: 404, error: 'No such building on this property.' }
  }
  if (input.confirmedAt) {
    return {
      ok: false,
      status: 409,
      error:
        'This estimate has already been released — create a new estimate to quote a different building.',
    }
  }
  return { ok: true }
}

/** PURE — locate a building by id in the property's detected list. */
export function findBuilding(
  buildings: DetectedBuilding[],
  buildingId: string,
): DetectedBuilding | null {
  return buildings.find((b) => b.building_id === buildingId) ?? null
}

/**
 * PURE — return a new buildings list with one building's lazy-compute
 * status updated (e.g. 'pending' → 'ready' after a successful compute, or
 * → 'no_coverage' when Google Solar has no imagery for that roof). Other
 * buildings are returned unchanged; an unknown id is a no-op.
 */
export function updateBuildingStatus(
  buildings: DetectedBuilding[],
  buildingId: string,
  status: SolarBuildingSolarStatus,
): DetectedBuilding[] {
  return buildings.map((b) =>
    b.building_id === buildingId ? { ...b, solar_status: status } : b,
  )
}
