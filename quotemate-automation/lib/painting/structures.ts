// ════════════════════════════════════════════════════════════════════
// Painting — structure picker options (pure mapping, no I/O).
//
// The /api/painting/structures route reuses the solar/roofing Geoscape
// discovery (lib/solar/buildings.ts detectPropertyBuildings — up to 6
// structures, primary-first, ~6 Geoscape credits) and this module maps
// the result into the lightweight rows the painting picker renders.
// Centroids/footprint polygons are dropped — the painting picker is a
// list, not a map.
// ════════════════════════════════════════════════════════════════════

import type { DetectedBuilding } from '@/lib/solar/types'

export type PaintStructureOption = {
  building_id: string
  label: string
  role: 'primary' | 'secondary'
  area_m2: number
  storeys: number | null
}

/** PURE — picker rows from detected buildings. Structures without a usable
 *  footprint area are dropped (nothing to measure paint from). */
export function toPaintStructureOptions(
  buildings: DetectedBuilding[],
): PaintStructureOption[] {
  const out: PaintStructureOption[] = []
  for (const b of buildings) {
    if (!b.building_id || !(typeof b.area_m2 === 'number' && b.area_m2 > 0)) continue
    // Synthetic ids — MultiPolygon sub-splits ('bldX#N') and index
    // fallbacks ('b0') — never appear in Geoscape's /buildings list, so the
    // targeted enricher could never fetch them; offering them would let the
    // money override land on the wrong building. Only real ids are pickable.
    if (b.building_id.includes('#') || /^b\d+$/.test(b.building_id)) continue
    out.push({
      building_id: b.building_id,
      label: b.label,
      role: b.role,
      area_m2: b.area_m2,
      storeys: b.storeys ?? null,
    })
  }
  return out
}
