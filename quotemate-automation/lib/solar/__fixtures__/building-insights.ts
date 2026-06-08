// ════════════════════════════════════════════════════════════════════
// Solar test fixtures — three deterministic payloads the whole lib/solar
// suite reuses:
//   • COVERED_RAW_BODY    — a realistic buildingInsights:findClosest body
//                           with roofSegmentStats + solarPanelConfigs +
//                           maxArrayPanelsCount + panelCapacityWatts.
//   • COVERED_INSIGHT     — that body run through parseBuildingInsights
//                           (the reused solar-api parser), HIGH imagery.
//   • UNCOVERED_RAW_BODY  — a 404-shaped body (no solarPotential).
//   • MANUAL_INPUT        — a customer-declared manual-roof fallback.
//
// Numbers are hand-chosen so the downstream STC / production / payback
// assertions land on exact, hand-worked values (see each module's test).
// ════════════════════════════════════════════════════════════════════

import { parseBuildingInsights } from '../../roofing/solar-api'
import type { SolarRoofInsight } from '../../roofing/solar-api'
import type { SolarManualRoofInput } from '../types'

/** A north-facing two-plane hip roof, ~120 m² of roof, HIGH imagery. */
export const COVERED_RAW_BODY = {
  imageryQuality: 'HIGH',
  imageryDate: { year: 2024, month: 3, day: 12 },
  solarPotential: {
    maxArrayPanelsCount: 30,
    panelCapacityWatts: 400,
    panelHeightMeters: 1.879,
    panelWidthMeters: 1.045,
    roofSegmentStats: [
      {
        pitchDegrees: 20,
        azimuthDegrees: 0, // due north
        stats: { areaMeters2: 70 },
      },
      {
        pitchDegrees: 20,
        azimuthDegrees: 180, // due south
        stats: { areaMeters2: 50 },
      },
    ],
    solarPanelConfigs: [
      { panelsCount: 16, yearlyEnergyDcKwh: 9600 },
      { panelsCount: 24, yearlyEnergyDcKwh: 14400 },
      { panelsCount: 30, yearlyEnergyDcKwh: 18000 },
    ],
  },
} as const

/** Parsed via the reused solar-api parser — segments/area/imagery only. */
export const COVERED_INSIGHT: SolarRoofInsight = (() => {
  const parsed = parseBuildingInsights(COVERED_RAW_BODY)
  if (!parsed) throw new Error('COVERED_RAW_BODY failed to parse — fixture is broken')
  return parsed
})()

/** What findClosest returns for an address with no imagery — no potential. */
export const UNCOVERED_RAW_BODY = {
  error: { code: 404, message: 'Requested entity was not found.' },
} as const

/** The 2–3 declared answers a customer gives when the address is uncovered. */
export const MANUAL_INPUT: SolarManualRoofInput = {
  orientation: 'north',
  roof_size: 'medium',
  storeys: 1,
}
