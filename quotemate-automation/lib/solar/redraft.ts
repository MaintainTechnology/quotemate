// ════════════════════════════════════════════════════════════════════
// Solar — re-draft helpers (the missing half of "adjust the numbers and
// re-draft"). A flagged estimate cannot be confirmed; the fix loop is:
// correct the underlying data (rate card, STC zone table, config), then
// RE-RUN the deterministic engine over the same address so the row is
// re-priced and the guardrails re-evaluated. These helpers reconstruct
// the original engine inputs from the persisted row + estimate jsonb so
// the re-draft route can re-run without asking the customer anything.
//
// PURE — no I/O, fully unit-testable. The route owns the engine call
// and the row update (same public_token — the customer link is stable).
// ════════════════════════════════════════════════════════════════════

import type {
  AuState,
  SolarAddressInput,
  SolarEstimate,
  SolarManualRoofInput,
  SolarPanelType,
  SolarPhase,
} from './types'

export type RedraftEligibility =
  | { ok: true }
  | { ok: false; status: number; error: string }

/**
 * PURE — a released (confirmed) estimate must not be silently re-priced
 * under the customer's feet; re-draft is for the pre-confirm review loop.
 */
export function redraftEligibility(input: {
  confirmedAt: string | null
}): RedraftEligibility {
  if (input.confirmedAt) {
    return {
      ok: false,
      status: 409,
      error:
        'This estimate has already been released to the customer — it cannot be re-drafted. Create a new estimate instead.',
    }
  }
  return { ok: true }
}

const AU_STATES: ReadonlySet<string> = new Set([
  'NSW', 'VIC', 'QLD', 'SA', 'WA', 'TAS', 'ACT', 'NT',
])

/** Manual size buckets (mirrors manual-fallback MANUAL_AREA_M2). */
const SIZE_BUCKETS: Array<{ size: SolarManualRoofInput['roof_size']; area: number }> = [
  { size: 'small', area: 45 },
  { size: 'medium', area: 90 },
  { size: 'large', area: 150 },
]

/** PURE — nearest declared-size bucket for a usable area. */
export function roofSizeFromArea(areaM2: number): SolarManualRoofInput['roof_size'] {
  let best = SIZE_BUCKETS[0]
  for (const b of SIZE_BUCKETS) {
    if (Math.abs(areaM2 - b.area) < Math.abs(areaM2 - best.area)) best = b
  }
  return best.size
}

export type ReconstructedSolarInputs = {
  input: SolarAddressInput
  manual?: SolarManualRoofInput
  panelType: SolarPanelType
  quarterlyBillAud: number | null
  /** Power-supply phase carried back from the prior estimate so a re-draft /
   *  building-switch keeps the same export ceiling. 'unknown' when absent. */
  phase: SolarPhase
  /** Preferred size carried back so re-estimates keep targeting it. Null when
   *  the prior estimate had none. */
  requestedSizeKw: number | null
}

/**
 * PURE — rebuild the engine inputs from a persisted row + estimate.
 * Google-path estimates need only the address (the engine re-fetches the
 * roof); manual-path estimates additionally get their declared answers
 * reconstructed from the synthesised roof facts. Null when the row lacks
 * the essentials (no address/state/postcode → nothing to re-run).
 */
export function reconstructSolarInputs(args: {
  row: { address: string | null; state: string | null; postcode: string | null }
  estimate: SolarEstimate
  /** Tradie-supplied overrides from the re-draft request (design 2026-06-16).
   *  A field present here wins over the persisted value; `desired_kw: null`
   *  explicitly clears a previous request (back to auto-sizing). */
  overrides?: { phase?: SolarPhase; desired_kw?: number | null }
}): ReconstructedSolarInputs | null {
  const { row, estimate } = args
  const address = row.address?.trim()
  const postcode = row.postcode?.trim() || estimate.context.postcode
  const state = (row.state?.trim() || estimate.context.state) as string
  if (!address || !postcode || !AU_STATES.has(state)) return null

  const input: SolarAddressInput = {
    address,
    postcode,
    state: state as AuState,
  }

  // Panel grade: every sizing tier shares the tenant's grade.
  const panelType: SolarPanelType =
    estimate.sizing.tiers[0]?.panel_type ?? 'standard_panels'

  const quarterlyBillAud =
    typeof estimate.context.quarterly_bill_aud === 'number' &&
    Number.isFinite(estimate.context.quarterly_bill_aud) &&
    estimate.context.quarterly_bill_aud > 0
      ? estimate.context.quarterly_bill_aud
      : null

  // Power-supply phase + preferred size carried back from the prior estimate
  // so re-draft AND the building-switch re-run with the same export ceiling
  // and tier anchor. Missing/invalid → conservative defaults (unknown / null).
  // A tradie-supplied override (dashboard re-draft, design 2026-06-16) wins
  // over the persisted value; an explicit `desired_kw: null` clears a previous
  // request (back to auto-sizing).
  const persistedPhase: SolarPhase =
    estimate.context.phase === 'single' ||
    estimate.context.phase === 'three' ||
    estimate.context.phase === 'unknown'
      ? estimate.context.phase
      : 'unknown'
  const phase: SolarPhase = args.overrides?.phase ?? persistedPhase

  const persistedSizeKw =
    typeof estimate.context.requested_size_kw === 'number' &&
    Number.isFinite(estimate.context.requested_size_kw) &&
    estimate.context.requested_size_kw > 0
      ? estimate.context.requested_size_kw
      : null
  const requestedSizeKw =
    args.overrides && 'desired_kw' in args.overrides
      ? args.overrides.desired_kw ?? null
      : persistedSizeKw

  let manual: SolarManualRoofInput | undefined
  if (estimate.coverage_source === 'manual') {
    const storeysRaw = estimate.roof.storeys ?? 1
    const storeys = (storeysRaw >= 3 ? 3 : storeysRaw === 2 ? 2 : 1) as 1 | 2 | 3
    manual = {
      orientation: estimate.roof.primary_orientation,
      roof_size: roofSizeFromArea(estimate.roof.usable_area_m2),
      storeys,
    }
  }

  return { input, manual, panelType, quarterlyBillAud, phase, requestedSizeKw }
}
