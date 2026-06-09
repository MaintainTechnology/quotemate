// ════════════════════════════════════════════════════════════════════
// Air-conditioning — deterministic sizing engine.
//
// Inputs → per-room cooling/heating load (kW) → totals + a confidence
// band. Floor-area basis: kW = area × climate_factor × room_type ×
// ceiling × insulation. Volume is computed only as an explainer. PURE —
// no I/O, fully unit-testable. Mirrors lib/painting/area.ts.
// ════════════════════════════════════════════════════════════════════

import type {
  AcConfidence,
  AcPropertyInputs,
  AcSizing,
  CeilingHeight,
  ClimateZone,
  Insulation,
  RoomLoad,
  RoomType,
} from './types'

/** AU typical room floor areas (m²) — used only when no floor area given. */
const TYPICAL_ROOM_M2: Record<RoomType, number> = { bedroom: 12, living: 25 }

/** kW per m² (living-area basis) by climate group. Calibrate over time. */
const CLIMATE_FACTOR: Record<ClimateZone, number> = {
  cool: 0.13,
  temperate: 0.15,
  subtropical: 0.17,
  tropical: 0.2,
}

/** Per-room-type load adjustment (bedrooms cooler/less glazing). */
const ROOM_TYPE_FACTOR: Record<RoomType, number> = { bedroom: 0.7, living: 1.0 }

const CEILING_HEIGHT_M: Record<CeilingHeight, number> = {
  standard: 2.4,
  high: 2.7,
  raked: 2.7,
}

const CEILING_MULT: Record<CeilingHeight, number> = {
  standard: 1.0,
  high: 1.1,
  raked: 1.15,
}

const INSULATION_MULT: Record<Insulation, number> = {
  good: 0.9,
  average: 1.0,
  poor: 1.15,
  unknown: 1.05,
}

/** Confidence → ± fraction of the band (matches painting's tiers). */
export const CONFIDENCE_BAND: Record<AcConfidence, number> = {
  high: 0.12,
  medium: 0.25,
  low: 0.4,
}

/** Zones don't all peak at once — ducted central unit is sized below sum. */
const DIVERSITY_FACTOR = 0.8

/** Common AU single-head split sizes (kW). */
const AC_UNIT_SIZES = [2.5, 3.5, 5.0, 7.0, 8.0]

/** PURE — round to N decimal places. */
export function roundTo(n: number, dp: number): number {
  if (!Number.isFinite(n)) return 0
  const f = Math.pow(10, dp)
  return Math.round(n * f) / f
}

/** PURE — smallest standard split size ≥ kw, capped at the largest. */
export function roundUpToUnit(kw: number): number {
  for (const u of AC_UNIT_SIZES) if (kw <= u) return u
  return AC_UNIT_SIZES[AC_UNIT_SIZES.length - 1]
}

/** PURE — round up to the nearest 0.5 kW (ducted central unit sizing). */
export function roundUpHalf(kw: number): number {
  return Math.ceil(kw * 2) / 2
}

export function sizeAircon(zone: ClimateZone, inputs: AcPropertyInputs): AcSizing {
  const ceilingHeightM = CEILING_HEIGHT_M[inputs.ceiling_height]
  const ceilingMult = CEILING_MULT[inputs.ceiling_height]
  const insulationMult = INSULATION_MULT[inputs.insulation]
  const climateFactor = CLIMATE_FACTOR[zone]

  const bedrooms = Math.max(0, Math.floor(inputs.bedrooms))
  const living = Math.max(0, Math.floor(inputs.living_spaces))

  const roomSpecs: RoomType[] = [
    ...Array.from({ length: bedrooms }, () => 'bedroom' as RoomType),
    ...Array.from({ length: living }, () => 'living' as RoomType),
  ]

  const typicalTotal = roomSpecs.reduce((acc, t) => acc + TYPICAL_ROOM_M2[t], 0)

  const hasFloorArea =
    typeof inputs.floor_area_m2 === 'number' &&
    Number.isFinite(inputs.floor_area_m2) &&
    (inputs.floor_area_m2 as number) > 0

  const notes: string[] = []
  let confidence: AcConfidence
  let totalFloorArea: number

  if (hasFloorArea) {
    totalFloorArea = roundTo(inputs.floor_area_m2 as number, 1)
    confidence = 'high'
    notes.push(
      `Floor area entered by hand (${totalFloorArea} m²) — apportioned across rooms by typical size.`,
    )
  } else {
    totalFloorArea = roundTo(typicalTotal, 1)
    confidence = bedrooms > 0 && living > 0 ? 'medium' : 'low'
    notes.push(
      `No floor area supplied — estimated from room counts using AU typical room sizes (${totalFloorArea} m²).`,
    )
  }

  const scale = hasFloorArea && typicalTotal > 0 ? totalFloorArea / typicalTotal : 1
  const band = CONFIDENCE_BAND[confidence]

  const rooms: RoomLoad[] = roomSpecs.map((t) => {
    const area = roundTo(TYPICAL_ROOM_M2[t] * scale, 1)
    const kw = roundTo(
      area * climateFactor * ROOM_TYPE_FACTOR[t] * ceilingMult * insulationMult,
      2,
    )
    return { room_type: t, area_m2: area, kw }
  })

  const connectedKw = roundTo(
    rooms.reduce((acc, r) => acc + r.kw, 0),
    2,
  )
  const ductedKw = roundTo(connectedKw * DIVERSITY_FACTOR, 2)
  const totalVolume = roundTo(totalFloorArea * ceilingHeightM, 1)

  notes.push(
    `Each room kW = area × ${climateFactor} (climate) × room-type × ${ceilingMult} (ceiling) × ${insulationMult} (insulation).`,
  )
  notes.push(
    `Ducted size = connected ${connectedKw} kW × ${DIVERSITY_FACTOR} diversity = ${ductedKw} kW.`,
  )

  return {
    rooms,
    conditioned_zones: roomSpecs.length,
    total_floor_area_m2: totalFloorArea,
    total_volume_m3: totalVolume,
    ceiling_height_m: ceilingHeightM,
    connected_kw: connectedKw,
    connected_kw_low: roundTo(connectedKw * (1 - band), 2),
    connected_kw_high: roundTo(connectedKw * (1 + band), 2),
    ducted_kw: ductedKw,
    confidence,
    notes,
  }
}

export const __test_only__ = {
  TYPICAL_ROOM_M2,
  CLIMATE_FACTOR,
  ROOM_TYPE_FACTOR,
  CEILING_MULT,
  INSULATION_MULT,
  DIVERSITY_FACTOR,
  AC_UNIT_SIZES,
}
