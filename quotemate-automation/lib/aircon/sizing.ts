// ════════════════════════════════════════════════════════════════════
// Air-conditioning — deterministic VOLUMETRIC sizing engine.
//
// Inputs → per-room conditioned-air volume (m³) → cooling/heating load
// (kW) → totals + a confidence band. Volumetric basis:
//   kW = volume_m3 × climate (kW/m³) × room-type × insulation
//        × storey × raked-stratification
// Ceiling height feeds the load through the volume itself (taller room
// = more air to condition), not a fudge multiplier. PURE — no I/O,
// fully unit-testable. Mirrors lib/painting/area.ts.
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

/**
 * kW per m³ of conditioned air by climate group. Derived from the v1
 * kW/m² factors at a 2.4 m reference ceiling (e.g. 0.15 / 2.4 = 0.0625).
 * Calibrate over time against real installs.
 */
const VOLUMETRIC_CLIMATE_FACTOR: Record<ClimateZone, number> = {
  cool: 0.0542,
  temperate: 0.0625,
  subtropical: 0.0708,
  tropical: 0.0833,
}

/** Per-room-type load adjustment (bedrooms cooler/less glazing). */
const ROOM_TYPE_FACTOR: Record<RoomType, number> = { bedroom: 0.7, living: 1.0 }

const CEILING_HEIGHT_M: Record<CeilingHeight, number> = {
  standard: 2.4,
  high: 2.7,
  raked: 2.7,
}

/**
 * Raked/cathedral spaces stratify (hot air pools in the apex), so the
 * same volume needs a little more capacity than a flat ceiling.
 */
const RAKED_STRATIFICATION_MULT = 1.05

const INSULATION_MULT: Record<Insulation, number> = {
  good: 0.9,
  average: 1.0,
  poor: 1.15,
  unknown: 1.05,
}

/**
 * Storeys/levels → load adjustment. Upper storeys cop direct roof heat
 * gain; multi-level homes also leak more through stairwells.
 * Index 1/2/3 (3 = "3 or more").
 */
const STOREY_MULT: Record<number, number> = { 1: 1.0, 2: 1.06, 3: 1.1 }

const FLOOR_AREA_RATIO = {
  min: 0.45,
  max: 2.4,
}

/**
 * Confidence → ± fraction of the band. Tightened from the v1 tiers
 * (12/25/40) after pilot feedback that ranges read too wide — the UI
 * now also shows the point estimate + full working, so the band only
 * has to cover honest sizing uncertainty, not presentation slack.
 */
export const CONFIDENCE_BAND: Record<AcConfidence, number> = {
  high: 0.1,
  medium: 0.18,
  low: 0.3,
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

/** PURE — clamp the storeys input to the modelled 1..3 range. */
export function clampStoreys(storeys: number | undefined): number {
  if (typeof storeys !== 'number' || !Number.isFinite(storeys)) return 1
  return Math.min(3, Math.max(1, Math.floor(storeys)))
}

/**
 * Optional satellite evidence: a floor area derived from the Google
 * Solar roof footprint (footprint × storeys × wall correction). Used
 * only when the tradie has not entered a floor area by hand.
 */
export type AcAreaEvidence = {
  solar_floor_area_m2: number
  capture_note: string
}

export function sizeAircon(
  zone: ClimateZone,
  inputs: AcPropertyInputs,
  evidence?: AcAreaEvidence | null,
): AcSizing {
  const ceilingHeightM = CEILING_HEIGHT_M[inputs.ceiling_height]
  const rakedMult = inputs.ceiling_height === 'raked' ? RAKED_STRATIFICATION_MULT : 1.0
  const insulationMult = INSULATION_MULT[inputs.insulation]
  const volumetricFactor = VOLUMETRIC_CLIMATE_FACTOR[zone]
  const storeys = clampStoreys(inputs.storeys)
  const storeyMult = STOREY_MULT[storeys] ?? 1.0

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
  const warnings: string[] = []
  let confidence: AcConfidence
  let totalFloorArea: number
  let floorAreaSource: AcSizing['floor_area_source']

  const enteredFloorArea = hasFloorArea ? (inputs.floor_area_m2 as number) : null
  const plausible = (area: number) =>
    typicalTotal === 0 ||
    (area >= typicalTotal * FLOOR_AREA_RATIO.min && area <= typicalTotal * FLOOR_AREA_RATIO.max)

  const solarArea =
    evidence &&
    Number.isFinite(evidence.solar_floor_area_m2) &&
    evidence.solar_floor_area_m2 > 0
      ? evidence.solar_floor_area_m2
      : null

  if (enteredFloorArea !== null && plausible(enteredFloorArea)) {
    totalFloorArea = roundTo(enteredFloorArea, 1)
    confidence = 'high'
    floorAreaSource = 'entered'
    notes.push(
      `Floor area entered by hand (${totalFloorArea} m2) - apportioned across rooms by typical size.`,
    )
  } else if (enteredFloorArea === null && solarArea !== null && plausible(solarArea)) {
    totalFloorArea = roundTo(solarArea, 1)
    confidence = 'medium'
    floorAreaSource = 'solar_footprint'
    notes.push(
      `Floor area estimated from the Google Solar roof footprint: ${evidence!.capture_note}`,
    )
    notes.push(
      `Satellite-derived area (${totalFloorArea} m2) replaces the typical-room-mix guess - confirm on site.`,
    )
  } else {
    totalFloorArea = roundTo(typicalTotal, 1)
    floorAreaSource = 'typical_room_mix'
    if (enteredFloorArea !== null) {
      confidence = 'low'
      warnings.push(
        `Entered floor area (${roundTo(enteredFloorArea, 1)} m2) does not match ${roomSpecs.length} conditioned zones; using ${totalFloorArea} m2 from the room mix until confirmed.`,
      )
      notes.push(
        `Floor area sanity check: ${roundTo(enteredFloorArea, 1)} m2 was outside the plausible band for ${roomSpecs.length} conditioned zones (typical ${totalFloorArea} m2).`,
      )
    } else {
      if (solarArea !== null) {
        warnings.push(
          `Satellite floor area (${roundTo(solarArea, 1)} m2) did not match ${roomSpecs.length} conditioned zones - using the typical room mix instead.`,
        )
      }
      confidence = bedrooms > 0 && living > 0 ? 'medium' : 'low'
      notes.push(
        `No floor area supplied - estimated from room counts using AU typical room sizes (${totalFloorArea} m2).`,
      )
    }
  }

  const scale =
    floorAreaSource !== 'typical_room_mix' && typicalTotal > 0
      ? totalFloorArea / typicalTotal
      : 1
  const band = CONFIDENCE_BAND[confidence]

  const rooms: RoomLoad[] = roomSpecs.map((t) => {
    const area = roundTo(TYPICAL_ROOM_M2[t] * scale, 1)
    const volume = roundTo(area * ceilingHeightM, 1)
    const kw = roundTo(
      volume *
        volumetricFactor *
        ROOM_TYPE_FACTOR[t] *
        insulationMult *
        storeyMult *
        rakedMult,
      2,
    )
    return { room_type: t, area_m2: area, volume_m3: volume, kw }
  })

  const connectedKw = roundTo(
    rooms.reduce((acc, r) => acc + r.kw, 0),
    2,
  )
  const ductedKw = roundTo(connectedKw * DIVERSITY_FACTOR, 2)
  const totalVolume = roundTo(
    rooms.reduce((acc, r) => acc + r.volume_m3, 0),
    1,
  )

  notes.push(
    `Each room kW = volume (m3) × ${volumetricFactor} (climate kW/m3) × room-type × ${insulationMult} (insulation) × ${storeyMult} (${storeys} storey${storeys === 1 ? '' : 's'})${rakedMult !== 1 ? ` × ${rakedMult} (raked stratification)` : ''}.`,
  )
  notes.push(
    `Ducted size = connected ${connectedKw} kW × ${DIVERSITY_FACTOR} diversity = ${ductedKw} kW.`,
  )

  return {
    rooms,
    conditioned_zones: roomSpecs.length,
    total_floor_area_m2: totalFloorArea,
    floor_area_source: floorAreaSource,
    total_volume_m3: totalVolume,
    ceiling_height_m: ceilingHeightM,
    storeys,
    volumetric_factor_kw_m3: volumetricFactor,
    connected_kw: connectedKw,
    connected_kw_low: roundTo(connectedKw * (1 - band), 2),
    connected_kw_high: roundTo(connectedKw * (1 + band), 2),
    ducted_kw: ductedKw,
    confidence,
    notes,
    warnings,
  }
}

export const __test_only__ = {
  TYPICAL_ROOM_M2,
  VOLUMETRIC_CLIMATE_FACTOR,
  ROOM_TYPE_FACTOR,
  RAKED_STRATIFICATION_MULT,
  INSULATION_MULT,
  STOREY_MULT,
  FLOOR_AREA_RATIO,
  DIVERSITY_FACTOR,
  AC_UNIT_SIZES,
}
