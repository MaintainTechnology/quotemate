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
  LatLng,
  SolarBuildingSolarStatus,
  SolarEstimate,
} from './types'

/** Synthetic id for a roof the customer free-tapped that Geoscape never
 *  outlined. Shared with the select-building route's custom path so a
 *  free-picked roof carries the SAME id from creation through switching. */
export const CUSTOM_BUILDING_ID = 'custom'

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

/** PURE — a synthetic DetectedBuilding for a free-tapped roof. Mirrors the
 *  shape the select-building route synthesises so the picker treats a
 *  free-pick made at creation identically to one made on the quote page. */
export function customBuilding(centroid: LatLng): DetectedBuilding {
  return {
    building_id: CUSTOM_BUILDING_ID,
    role: 'secondary',
    label: 'Selected roof',
    centroid,
    footprint: null,
    area_m2: null,
    roof_shape: null,
    storeys: null,
    solar_status: 'pending',
  }
}

/**
 * PURE — decide which building the freshly-created estimate is FOR, and the
 * buildings list to persist alongside it.
 *
 * The bug this closes: when the customer free-tapped a roof Geoscape never
 * outlined, the engine estimated THAT point (estimate.context.location ===
 * target.centroid), but the creation route then re-detected buildings and,
 * failing to find the synthetic 'custom' id, snapped selection back to the
 * primary dwelling — so the quote page highlighted a DIFFERENT roof than the
 * one priced ("it jumped to the other house roof").
 *
 * Rule: an explicit customer pick (target) always wins. If the re-detected
 * list contains it, select it. Otherwise it is a free-pick (or an id that did
 * not survive re-detection) — synthesise a custom building at the picked
 * centroid, append it, and select that. With no pick, fall back to the primary
 * dwelling (today's behaviour). The selected building is marked 'ready'.
 */
export function resolveCreationSelection(args: {
  detected: DetectedBuilding[]
  target: { building_id: string; centroid: LatLng } | null
}): { buildings: DetectedBuilding[]; selectedBuildingId: string } | null {
  const { detected, target } = args

  if (target) {
    // A custom (free-pick) id always re-synthesises at the new centroid — it
    // must never match a stale 'custom' entry left in the detected list.
    const found =
      target.building_id === CUSTOM_BUILDING_ID
        ? undefined
        : detected.find((b) => b.building_id === target.building_id)
    if (found) {
      return {
        buildings: updateBuildingStatus(detected, found.building_id, 'ready'),
        selectedBuildingId: found.building_id,
      }
    }
    // Free-pick (or an unstable id) — keep selection on the priced roof by
    // appending a custom entry at the picked centroid. Drop any prior custom.
    const custom = customBuilding(target.centroid)
    const buildings = [
      ...detected.filter((b) => b.building_id !== CUSTOM_BUILDING_ID),
      { ...custom, solar_status: 'ready' as SolarBuildingSolarStatus },
    ]
    return { buildings, selectedBuildingId: CUSTOM_BUILDING_ID }
  }

  // No explicit pick — the engine estimated whatever findClosest snapped to at
  // the geocoded address, i.e. the primary dwelling. Select it.
  const primary =
    detected.find((b) => b.role === 'primary') ?? detected[0] ?? null
  if (!primary) return null
  return {
    buildings: updateBuildingStatus(detected, primary.building_id, 'ready'),
    selectedBuildingId: primary.building_id,
  }
}
