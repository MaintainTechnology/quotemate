// ════════════════════════════════════════════════════════════════════
// Roofing — per-tenant rate-card overlay (read + merge + validate).
//
// Purpose: let a tradie override the per-material $/m² rates in
// `DEFAULT_ROOFING_RATE_CARD` without changing the global code defaults.
//
// Storage: pricing_book.overlays.roofing_rate_card (jsonb, per-tenant).
//   Shape:
//     {
//       reroof_rate_per_m2?: Partial<Record<RoofMaterial, number>>
//     }
//   Only the rate-per-m² map is editable in Phase 1; multi-storey
//   loading, asbestos loading, upgrade material, and gst_registered
//   remain global (the polished spec explicitly punts them).
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

/** Materials the editor exposes. Phase 1 covers every key in the
 *  rate card except `unknown` (which is never user-selected). */
export const EDITABLE_MATERIALS: ReadonlyArray<RoofMaterial> = [
  'colorbond_trimdek',
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

export const RoofingRateOverlaySchema = z.object({
  reroof_rate_per_m2: z
    .object({
      colorbond_trimdek: RatePerM2.optional().nullable(),
      colorbond_kliplok: RatePerM2.optional().nullable(),
      concrete_tile:     RatePerM2.optional().nullable(),
      terracotta_tile:   RatePerM2.optional().nullable(),
      cement_sheet:      RatePerM2.optional().nullable(),
    })
    .partial()
    .optional(),
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
 *
 * Best-effort: each field is checked independently. A failed field is
 * reported and dropped from the parsed overlay so a single bad entry
 * doesn't poison the whole payload.
 */
export function parseRoofingRateOverlay(input: unknown): ParseOverlayResult {
  // null / undefined / empty → empty overlay (perfectly valid — means
  // "no overrides").
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
 * The overlay's per-material values replace the corresponding default;
 * any missing/null/undefined key uses the default. Multi-storey loading,
 * asbestos loading, upgrade material, and gst_registered all pass through
 * from the default (out of scope for this iteration).
 */
export function mergeRoofingRateCard(
  base: RoofingRateCard,
  overlay: RoofingRateOverlay | null | undefined,
): RoofingRateCard {
  if (!overlay || !overlay.reroof_rate_per_m2) return base
  // `o` is keyed only by the editable materials (the schema rules out
  // 'unknown'), so cast the lookup type narrowly to avoid a TS index
  // error from the broader RoofMaterial enum.
  const o = overlay.reroof_rate_per_m2 as Record<
    (typeof EDITABLE_MATERIALS)[number],
    number | null | undefined
  >
  const merged: Record<RoofMaterial, number> = { ...base.reroof_rate_per_m2 }
  for (const m of EDITABLE_MATERIALS) {
    const v = o[m]
    if (typeof v === 'number' && Number.isFinite(v)) {
      merged[m] = v
    }
  }
  return {
    ...base,
    reroof_rate_per_m2: merged,
  }
}

/**
 * Convenience — build the effective rate card for a tenant from a raw
 * jsonb overlay value (e.g. `pricing_book.overlays.roofing_rate_card`).
 * Unparseable overlays silently fall back to the default so a malformed
 * DB row never breaks a quote — operators still see the validation error
 * in the API response when they save.
 */
export function effectiveRateCardFromOverlay(
  overlayJson: unknown,
  base: RoofingRateCard = DEFAULT_ROOFING_RATE_CARD,
): RoofingRateCard {
  const parsed = parseRoofingRateOverlay(overlayJson)
  if (!parsed.ok) return base
  return mergeRoofingRateCard(base, parsed.overlay)
}

/**
 * PURE — turn a partial rate-card body from the dashboard into the
 * canonical overlay shape, dropping any blank/null values (so they fall
 * back to the default). Used by the PATCH handler.
 *
 * Validation issues are returned in the result so the route can surface
 * them to the UI verbatim.
 */
export function buildOverlayFromInputs(
  inputs: Partial<Record<RoofMaterial, number | string | null | undefined>>,
): ParseOverlayResult {
  const cleaned: Record<string, number> = {}
  const issues: Array<{ field: string; message: string }> = []
  for (const m of EDITABLE_MATERIALS) {
    const raw = inputs[m]
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
  if (issues.length > 0) return { ok: false, issues }
  return {
    ok: true,
    overlay: Object.keys(cleaned).length > 0
      ? { reroof_rate_per_m2: cleaned as Partial<Record<RoofMaterial, number>> }
      : {},
  }
}
