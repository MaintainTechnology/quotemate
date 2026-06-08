// ════════════════════════════════════════════════════════════════════
// Air-conditioning — climate zone resolver.
//
// SIMPLIFIED v1: a state + postcode-range heuristic grouped from the
// NCC's 8 climate zones into 4 cooling-load buckets. This is an
// approximation flagged for calibration in the design spec (§12) — the
// real NCC zone-by-postcode table is a future data import. PURE.
// ════════════════════════════════════════════════════════════════════

import type { AusState, ClimateZone } from './types'

export function climateZoneForPostcode(
  postcode: string,
  state: AusState,
): { zone: ClimateZone; note: string } {
  const pc = Number.parseInt(postcode, 10)
  const zone = resolveZone(pc, state)
  return {
    zone,
    note: `Climate zone "${zone}" inferred from ${state} ${postcode} (simplified v1 mapping — confirm on site).`,
  }
}

function resolveZone(pc: number, state: AusState): ClimateZone {
  switch (state) {
    case 'NT':
      return 'tropical'
    case 'TAS':
      return 'cool'
    case 'QLD':
      return pc >= 4700 ? 'tropical' : 'subtropical'
    case 'WA':
      if (pc >= 6700) return 'tropical'
      if (pc <= 6199) return 'temperate'
      return 'subtropical'
    case 'NSW':
      if (pc >= 2480 && pc <= 2489) return 'subtropical' // far north coast
      if (pc >= 2625 && pc <= 2627) return 'cool' // Snowy / alpine
      return 'temperate'
    case 'VIC':
    case 'SA':
    case 'ACT':
      return 'temperate'
    default:
      return 'temperate'
  }
}
