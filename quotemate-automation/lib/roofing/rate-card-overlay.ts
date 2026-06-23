// ════════════════════════════════════════════════════════════════════
// Roofing — per-tenant rate-card overlay (read + merge + validate).
//
// Wave 1b — extended to cover the full RoofingRateCard:
//   • reroof_rate_per_m2 (per material)
//   • multi_storey_loading_pct
//   • asbestos_loading_pct
//   • upgrade_material
//   • gst_registered
//   • NEW — complexity_loading_pct (per the Jobber research learning;
//     industry norm 0–25% to absorb on-the-job overhead a tradie can
//     never name in advance: broken tiles during lift, sarking strips,
//     extra ridge bedding, etc.)
//
// Storage: pricing_book.overlays.roofing_rate_card (jsonb, per-tenant).
//
// MERGE SEMANTICS:
//   • Every override value REPLACES the corresponding default.
//   • A missing key (or undefined/null/blank) falls back to the default.
//   • Out-of-range values are dropped during validation (not silently
//     coerced) so the tradie sees an error rather than a quietly-clamped
//     number.
//
// PURE — no I/O. Used by the /api/tenant/roofing-rates PATCH validator
// AND by the /api/roofing/measure route's pre-pricing merge step.
// ════════════════════════════════════════════════════════════════════

import { z } from 'zod'
import { DEFAULT_ROOFING_RATE_CARD } from './pricing'
import type { RoofMaterial, RoofingRateCard } from './types'

/** Hard upper bound the spec mandates. Anything above this is rejected
 *  at validation time rather than silently clamped. */
export const MAX_RATE_PER_M2 = 500

/** Lower bound — must be strictly positive (a 0 rate would zero out
 *  every tier price and quietly produce a $0 quote). */
export const MIN_RATE_PER_M2 = 0

/** Loadings are expressed as fractions (0.20 = +20%). Hard cap at 100%
 *  to prevent runaway quotes (a tradie typing 150 expecting "%" would
 *  multiply the price by 2.5×). */
export const MAX_LOADING_PCT = 1.0
export const MIN_LOADING_PCT = 0

/** Solar detach & reinstate is a dollar allowance, not a fraction. Cap it
 *  so a typo can't add an absurd amount to a quote. */
export const MAX_SOLAR_ALLOWANCE = 20000

/** Materials the editor exposes. Phase 1 covers every key in the
 *  rate card except `unknown` (which is never user-selected). */
export const EDITABLE_MATERIALS: ReadonlyArray<RoofMaterial> = [
  'colorbond_corrugated',
  'colorbond_trimdek',
  'colorbond_spandek',
  'colorbond_kliplok',
  'concrete_tile',
  'terracotta_tile',
  'cement_sheet',
] as const

/** What the dashboard PATCH sends. Blank inputs ARE allowed (we
 *  interpret them as "no override → fall back to default"); we accept
 *  null and undefined for the same reason. */
const RatePerM2 = z
  .number()
  .positive('Rate must be greater than 0')
  .max(MAX_RATE_PER_M2, `Rate must be at most $${MAX_RATE_PER_M2}/m²`)

const LoadingPct = z
  .number()
  .min(MIN_LOADING_PCT, 'Loading must be 0% or more')
  .max(MAX_LOADING_PCT, `Loading must be at most ${MAX_LOADING_PCT * 100}%`)

export const RoofingRateOverlaySchema = z.object({
  reroof_rate_per_m2: z
    .object({
      colorbond_corrugated: RatePerM2.optional().nullable(),
      colorbond_trimdek: RatePerM2.optional().nullable(),
      colorbond_spandek: RatePerM2.optional().nullable(),
      colorbond_kliplok: RatePerM2.optional().nullable(),
      concrete_tile:     RatePerM2.optional().nullable(),
      terracotta_tile:   RatePerM2.optional().nullable(),
      cement_sheet:      RatePerM2.optional().nullable(),
    })
    .partial()
    .optional(),
  multi_storey_loading_pct: LoadingPct.optional().nullable(),
  asbestos_loading_pct: LoadingPct.optional().nullable(),
  complexity_loading_pct: LoadingPct.optional().nullable(),
  solar_detach_reinstate_base_ex_gst: z
    .number()
    .min(0)
    .max(MAX_SOLAR_ALLOWANCE)
    .optional()
    .nullable(),
  solar_detach_reinstate_per_array_ex_gst: z
    .number()
    .min(0)
    .max(MAX_SOLAR_ALLOWANCE)
    .optional()
    .nullable(),
  upgrade_material: z
    .enum([
      'colorbond_trimdek',
      'colorbond_kliplok',
      'concrete_tile',
      'terracotta_tile',
      'cement_sheet',
    ])
    .optional()
    .nullable(),
  gst_registered: z.boolean().optional().nullable(),
})

export type RoofingRateOverlay = z.infer<typeof RoofingRateOverlaySchema>

/** Result of parsing a stored overlay from the DB (or a fresh PATCH
 *  body). Validation errors are surfaced field-by-field. */
export type ParseOverlayResult =
  | { ok: true; overlay: RoofingRateOverlay }
  | {
      ok: false
      issues: Array<{ field: string; message: string }>
    }

/**
 * PURE — parse + validate an unknown JSON value as a RoofingRateOverlay.
 */
export function parseRoofingRateOverlay(input: unknown): ParseOverlayResult {
  if (input == null) return { ok: true, overlay: {} }
  if (typeof input !== 'object' || Array.isArray(input)) {
    return {
      ok: false,
      issues: [{ field: '', message: 'Overlay must be an object.' }],
    }
  }
  const parsed = RoofingRateOverlaySchema.safeParse(input)
  if (parsed.success) return { ok: true, overlay: parsed.data }
  const issues = parsed.error.issues.map((i) => ({
    field: i.path.join('.'),
    message: i.message,
  }))
  return { ok: false, issues }
}

/**
 * PURE — merge an overlay onto the canonical default rate card.
 *
 * Every key the overlay supplies REPLACES the corresponding default;
 * missing/null keys use the default.
 *
 * Note: `complexity_loading_pct` does NOT exist on the base RoofingRateCard
 * type — it's a new lever introduced by the overlay. We stash it on the
 * returned card via a typed-extension so the pricing engine can read it
 * during loading-stack assembly.
 */
export function mergeRoofingRateCard(
  base: RoofingRateCard,
  overlay: RoofingRateOverlay | null | undefined,
): RoofingRateCard {
  if (!overlay) return base

  // Rate map merge (same as before).
  let merged: RoofingRateCard = base
  if (overlay.reroof_rate_per_m2) {
    const o = overlay.reroof_rate_per_m2 as Record<
      (typeof EDITABLE_MATERIALS)[number],
      number | null | undefined
    >
    const map: Record<RoofMaterial, number> = { ...base.reroof_rate_per_m2 }
    for (const m of EDITABLE_MATERIALS) {
      const v = o[m]
      if (typeof v === 'number' && Number.isFinite(v)) map[m] = v
    }
    merged = { ...merged, reroof_rate_per_m2: map }
  }

  // Scalar overrides.
  if (
    typeof overlay.multi_storey_loading_pct === 'number' &&
    Number.isFinite(overlay.multi_storey_loading_pct)
  ) {
    merged = { ...merged, multi_storey_loading_pct: overlay.multi_storey_loading_pct }
  }
  if (
    typeof overlay.asbestos_loading_pct === 'number' &&
    Number.isFinite(overlay.asbestos_loading_pct)
  ) {
    merged = { ...merged, asbestos_loading_pct: overlay.asbestos_loading_pct }
  }
  if (overlay.upgrade_material) {
    merged = { ...merged, upgrade_material: overlay.upgrade_material }
  }
  if (typeof overlay.gst_registered === 'boolean') {
    merged = { ...merged, gst_registered: overlay.gst_registered }
  }

  // Complexity loading — new lever the base type does not declare.
  // Stash on the returned object so callers that read it via the
  // `withComplexityLoading` helper find it; callers that ignore it see
  // an ordinary RoofingRateCard.
  if (
    typeof overlay.complexity_loading_pct === 'number' &&
    Number.isFinite(overlay.complexity_loading_pct)
  ) {
    ;(merged as RoofingRateCard & { complexity_loading_pct?: number }).complexity_loading_pct =
      overlay.complexity_loading_pct
  }

  // Solar detach & reinstate dollar allowance — new levers the base type
  // does not declare; read back via solarAllowanceConfigFromCard (lib/roofing/solar.ts).
  if (
    typeof overlay.solar_detach_reinstate_base_ex_gst === 'number' &&
    Number.isFinite(overlay.solar_detach_reinstate_base_ex_gst)
  ) {
    ;(merged as RoofingRateCard & { solar_detach_reinstate_base_ex_gst?: number }).solar_detach_reinstate_base_ex_gst =
      overlay.solar_detach_reinstate_base_ex_gst
  }
  if (
    typeof overlay.solar_detach_reinstate_per_array_ex_gst === 'number' &&
    Number.isFinite(overlay.solar_detach_reinstate_per_array_ex_gst)
  ) {
    ;(merged as RoofingRateCard & { solar_detach_reinstate_per_array_ex_gst?: number }).solar_detach_reinstate_per_array_ex_gst =
      overlay.solar_detach_reinstate_per_array_ex_gst
  }

  return merged
}

/** PURE — read the optional complexity loading from a merged card. */
export function complexityLoadingFromCard(card: RoofingRateCard): number {
  const v = (card as { complexity_loading_pct?: unknown }).complexity_loading_pct
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0
}

/**
 * Convenience — build the effective rate card for a tenant from a raw
 * jsonb overlay value. Unparseable overlays silently fall back to the
 * default so a malformed DB row never breaks a quote.
 */
export function effectiveRateCardFromOverlay(
  overlayJson: unknown,
  base: RoofingRateCard = DEFAULT_ROOFING_RATE_CARD,
): RoofingRateCard {
  const parsed = parseRoofingRateOverlay(overlayJson)
  if (!parsed.ok) return base
  return mergeRoofingRateCard(base, parsed.overlay)
}

/** Shape of the partial body the dashboard PATCH sends. */
export type DashboardInputs = {
  reroof_rate_per_m2?: Partial<Record<RoofMaterial, number | string | null | undefined>>
  multi_storey_loading_pct?: number | string | null
  asbestos_loading_pct?: number | string | null
  complexity_loading_pct?: number | string | null
  upgrade_material?: RoofMaterial | null
  gst_registered?: boolean | null
}

/**
 * PURE — turn a partial rate-card body from the dashboard into the
 * canonical overlay shape, dropping any blank/null values (so they
 * fall back to the default).
 */
export function buildOverlayFromInputs(
  inputs: DashboardInputs | Partial<Record<RoofMaterial, number | string | null | undefined>>,
): ParseOverlayResult {
  const issues: Array<{ field: string; message: string }> = []
  const overlay: RoofingRateOverlay = {}

  // Back-compat — earlier callers passed the rate map directly; detect
  // that shape and rewrap.
  const inputsAny = inputs as Record<string, unknown>
  const isLegacyRateMap =
    !('reroof_rate_per_m2' in inputsAny) &&
    Object.keys(inputsAny).some((k) =>
      (EDITABLE_MATERIALS as readonly string[]).includes(k),
    )
  const dashboard: DashboardInputs = isLegacyRateMap
    ? { reroof_rate_per_m2: inputsAny as Partial<Record<RoofMaterial, number | string | null | undefined>> }
    : (inputs as DashboardInputs)

  // ── Rate map ─────────────────────────────────────────────────────
  const rates = dashboard.reroof_rate_per_m2
  if (rates) {
    const cleaned: Record<string, number> = {}
    for (const m of EDITABLE_MATERIALS) {
      const raw = rates[m]
      if (raw === null || raw === undefined || raw === '') continue
      const n = typeof raw === 'number' ? raw : Number(raw)
      if (!Number.isFinite(n)) {
        issues.push({ field: `reroof_rate_per_m2.${m}`, message: 'Rate must be a number.' })
        continue
      }
      if (n <= MIN_RATE_PER_M2) {
        issues.push({
          field: `reroof_rate_per_m2.${m}`,
          message: 'Rate must be greater than 0.',
        })
        continue
      }
      if (n > MAX_RATE_PER_M2) {
        issues.push({
          field: `reroof_rate_per_m2.${m}`,
          message: `Rate must be at most $${MAX_RATE_PER_M2}/m².`,
        })
        continue
      }
      cleaned[m] = n
    }
    if (Object.keys(cleaned).length > 0) {
      overlay.reroof_rate_per_m2 = cleaned as Partial<Record<RoofMaterial, number>>
    }
  }

  // ── Loadings (3 of them — multi_storey, asbestos, complexity) ────
  const loadingKeys = [
    ['multi_storey_loading_pct', dashboard.multi_storey_loading_pct],
    ['asbestos_loading_pct',     dashboard.asbestos_loading_pct],
    ['complexity_loading_pct',   dashboard.complexity_loading_pct],
  ] as const
  for (const [key, raw] of loadingKeys) {
    if (raw === null || raw === undefined || raw === '') continue
    const n = typeof raw === 'number' ? raw : Number(raw)
    if (!Number.isFinite(n)) {
      issues.push({ field: key, message: 'Loading must be a number.' })
      continue
    }
    if (n < MIN_LOADING_PCT) {
      issues.push({ field: key, message: 'Loading must be 0% or more.' })
      continue
    }
    if (n > MAX_LOADING_PCT) {
      issues.push({
        field: key,
        message: `Loading must be at most ${MAX_LOADING_PCT * 100}%.`,
      })
      continue
    }
    overlay[key] = n
  }

  // ── Upgrade material (enum) ──────────────────────────────────────
  if (dashboard.upgrade_material) {
    if (!(EDITABLE_MATERIALS as readonly string[]).includes(dashboard.upgrade_material)) {
      issues.push({
        field: 'upgrade_material',
        message: `Upgrade material must be one of: ${EDITABLE_MATERIALS.join(', ')}.`,
      })
    } else {
      overlay.upgrade_material = dashboard.upgrade_material as
        | 'colorbond_trimdek'
        | 'colorbond_kliplok'
        | 'concrete_tile'
        | 'terracotta_tile'
        | 'cement_sheet'
    }
  }

  // ── GST flag ─────────────────────────────────────────────────────
  if (typeof dashboard.gst_registered === 'boolean') {
    overlay.gst_registered = dashboard.gst_registered
  }

  if (issues.length > 0) return { ok: false, issues }
  return { ok: true, overlay }
}
