// ════════════════════════════════════════════════════════════════════
// Painting — per-tenant rate-card overlay (read + merge + validate).
//
// Mirrors lib/roofing/rate-card-overlay.ts. Lets a tradie override the
// painting pricing levers; stored in pricing_book.overlays.painting_rate_card
// (jsonb). Read by /api/painting/estimate before pricing and by the
// /api/tenant/painting-rates editor.
//
// Editable levers (the rest of PaintingRateCard — coats/condition
// multipliers — stay at the code defaults and are shown read-only in the
// price breakdown):
//   • rate_per_unit (walls / ceilings / trim / exterior)  $/unit
//   • double_storey_loading_pct                           fraction
//   • premium_uplift_pct (Best tier)                      fraction
//   • good_refresh_fraction (Good tier)                   fraction
//   • colour_change_extra                                 fraction
//   • call_out_minimum_ex_gst                             $
//   • gst_registered                                      bool
//
// MERGE SEMANTICS (same as roofing): a supplied value REPLACES the
// default; blank/null/undefined falls back to the default; out-of-range
// values are rejected at validation rather than silently clamped.
//
// PURE — no I/O.
// ════════════════════════════════════════════════════════════════════

import { z } from 'zod'
import { DEFAULT_PAINTING_RATE_CARD } from './pricing'
import type { PaintScope, PaintingRateCard } from './types'

export const MAX_RATE_PER_UNIT = 200
export const MAX_CALL_OUT_EX_GST = 5000
/** Loadings/uplift can plausibly exceed 100% (a double-storey exterior at
 *  +50% is 0.5; premium uplift caps lower). Hard cap to stop a typo. */
export const MAX_FRACTION = 2
/** Hourly charge-out ceiling (ex-GST) — a generous cap to stop a fat-finger. */
export const MAX_HOURLY_RATE = 2000
/** Throughput ceiling (units/hour) — well above any real painter's pace. */
export const MAX_PRODUCTION_RATE = 200

export const EDITABLE_SCOPES: ReadonlyArray<PaintScope> = [
  'walls',
  'ceilings',
  'trim',
  'exterior',
] as const

const Rate = z.number().positive('Rate must be greater than 0').max(MAX_RATE_PER_UNIT, `Rate must be at most $${MAX_RATE_PER_UNIT}`)
const Fraction = z.number().min(0, 'Must be 0% or more').max(MAX_FRACTION, `Must be at most ${MAX_FRACTION * 100}%`)
const UnitFraction = z.number().positive('Must be greater than 0%').max(1, 'Must be at most 100%')
const Money = z.number().min(0).max(MAX_CALL_OUT_EX_GST)
const HourlyRate = z.number().positive('Hourly rate must be greater than 0').max(MAX_HOURLY_RATE, `Hourly rate must be at most $${MAX_HOURLY_RATE}`)
const Production = z.number().positive('Must be greater than 0').max(MAX_PRODUCTION_RATE)

export const PaintingRateOverlaySchema = z.object({
  rate_per_unit: z
    .object({
      walls: Rate.optional().nullable(),
      ceilings: Rate.optional().nullable(),
      trim: Rate.optional().nullable(),
      exterior: Rate.optional().nullable(),
    })
    .partial()
    .optional(),
  double_storey_loading_pct: Fraction.optional().nullable(),
  premium_uplift_pct: Fraction.optional().nullable(),
  good_refresh_fraction: UnitFraction.optional().nullable(),
  colour_change_extra: Fraction.optional().nullable(),
  call_out_minimum_ex_gst: Money.optional().nullable(),
  gst_registered: z.boolean().optional().nullable(),
  // Hourly-pricing levers (absent ⇒ the per-m² model). pricing_model toggles
  // the engine; hourly_rate is the charge-out; production_rate_per_unit is the
  // (optional) area→hours throughput, defaulted in code when omitted.
  pricing_model: z.enum(['sqm', 'hourly']).optional().nullable(),
  hourly_rate: HourlyRate.optional().nullable(),
  production_rate_per_unit: z
    .object({
      walls: Production.optional().nullable(),
      ceilings: Production.optional().nullable(),
      trim: Production.optional().nullable(),
      exterior: Production.optional().nullable(),
    })
    .partial()
    .optional(),
})

export type PaintingRateOverlay = z.infer<typeof PaintingRateOverlaySchema>

export type ParseOverlayResult =
  | { ok: true; overlay: PaintingRateOverlay }
  | { ok: false; issues: Array<{ field: string; message: string }> }

/** PURE — parse + validate an unknown JSON value as a PaintingRateOverlay. */
export function parsePaintingRateOverlay(input: unknown): ParseOverlayResult {
  if (input == null) return { ok: true, overlay: {} }
  if (typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, issues: [{ field: '', message: 'Overlay must be an object.' }] }
  }
  const parsed = PaintingRateOverlaySchema.safeParse(input)
  if (parsed.success) return { ok: true, overlay: parsed.data }
  return {
    ok: false,
    issues: parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
  }
}

/** PURE — merge an overlay onto the default painting rate card. */
export function mergePaintingRateCard(
  base: PaintingRateCard,
  overlay: PaintingRateOverlay | null | undefined,
): PaintingRateCard {
  if (!overlay) return base
  let merged: PaintingRateCard = base

  if (overlay.rate_per_unit) {
    const map = { ...base.rate_per_unit }
    for (const s of EDITABLE_SCOPES) {
      const v = (overlay.rate_per_unit as Record<PaintScope, number | null | undefined>)[s]
      if (typeof v === 'number' && Number.isFinite(v)) map[s] = v
    }
    merged = { ...merged, rate_per_unit: map }
  }

  const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
  if (num(overlay.double_storey_loading_pct)) merged = { ...merged, double_storey_loading_pct: overlay.double_storey_loading_pct as number }
  if (num(overlay.premium_uplift_pct)) merged = { ...merged, premium_uplift_pct: overlay.premium_uplift_pct as number }
  if (num(overlay.good_refresh_fraction)) merged = { ...merged, good_refresh_fraction: overlay.good_refresh_fraction as number }
  if (num(overlay.colour_change_extra)) merged = { ...merged, colour_change_extra: overlay.colour_change_extra as number }
  if (num(overlay.call_out_minimum_ex_gst)) merged = { ...merged, call_out_minimum_ex_gst: overlay.call_out_minimum_ex_gst as number }
  if (typeof overlay.gst_registered === 'boolean') merged = { ...merged, gst_registered: overlay.gst_registered }

  // Hourly model.
  if (overlay.pricing_model === 'sqm' || overlay.pricing_model === 'hourly') {
    merged = { ...merged, pricing_model: overlay.pricing_model }
  }
  if (num(overlay.hourly_rate)) merged = { ...merged, hourly_rate: overlay.hourly_rate as number }
  if (overlay.production_rate_per_unit) {
    const map = { ...(merged.production_rate_per_unit ?? base.production_rate_per_unit ?? {}) } as Record<PaintScope, number>
    for (const s of EDITABLE_SCOPES) {
      const v = (overlay.production_rate_per_unit as Record<PaintScope, number | null | undefined>)[s]
      if (typeof v === 'number' && Number.isFinite(v)) map[s] = v
    }
    merged = { ...merged, production_rate_per_unit: map }
  }

  return merged
}

/** Convenience — effective rate card from a raw jsonb overlay value. */
export function effectivePaintingRateCardFromOverlay(
  overlayJson: unknown,
  base: PaintingRateCard = DEFAULT_PAINTING_RATE_CARD,
): PaintingRateCard {
  const parsed = parsePaintingRateOverlay(overlayJson)
  if (!parsed.ok) return base
  return mergePaintingRateCard(base, parsed.overlay)
}

/** The partial body the dashboard editor PATCHes. */
export type DashboardInputs = {
  rate_per_unit?: Partial<Record<PaintScope, number | string | null | undefined>>
  double_storey_loading_pct?: number | string | null
  premium_uplift_pct?: number | string | null
  good_refresh_fraction?: number | string | null
  colour_change_extra?: number | string | null
  call_out_minimum_ex_gst?: number | string | null
  gst_registered?: boolean | null
  pricing_model?: 'sqm' | 'hourly' | null
  hourly_rate?: number | string | null
  production_rate_per_unit?: Partial<Record<PaintScope, number | string | null | undefined>>
}

/** PURE — turn a partial editor body into a validated overlay, dropping
 *  blank/null values (so they fall back to the default). */
export function buildPaintingOverlayFromInputs(inputs: DashboardInputs): ParseOverlayResult {
  const issues: Array<{ field: string; message: string }> = []
  const overlay: PaintingRateOverlay = {}

  // Rates.
  if (inputs.rate_per_unit) {
    const cleaned: Partial<Record<PaintScope, number>> = {}
    for (const s of EDITABLE_SCOPES) {
      const raw = inputs.rate_per_unit[s]
      if (raw === null || raw === undefined || raw === '') continue
      const n = typeof raw === 'number' ? raw : Number(raw)
      if (!Number.isFinite(n)) { issues.push({ field: `rate_per_unit.${s}`, message: 'Rate must be a number.' }); continue }
      if (n <= 0) { issues.push({ field: `rate_per_unit.${s}`, message: 'Rate must be greater than 0.' }); continue }
      if (n > MAX_RATE_PER_UNIT) { issues.push({ field: `rate_per_unit.${s}`, message: `Rate must be at most $${MAX_RATE_PER_UNIT}.` }); continue }
      cleaned[s] = n
    }
    if (Object.keys(cleaned).length > 0) overlay.rate_per_unit = cleaned
  }

  // Fractional levers.
  const fracKeys = [
    ['double_storey_loading_pct', inputs.double_storey_loading_pct, MAX_FRACTION, false],
    ['premium_uplift_pct', inputs.premium_uplift_pct, MAX_FRACTION, false],
    ['good_refresh_fraction', inputs.good_refresh_fraction, 1, true],
    ['colour_change_extra', inputs.colour_change_extra, MAX_FRACTION, false],
  ] as const
  for (const [key, raw, max, mustBePositive] of fracKeys) {
    if (raw === null || raw === undefined || raw === '') continue
    const n = typeof raw === 'number' ? raw : Number(raw)
    if (!Number.isFinite(n)) { issues.push({ field: key, message: 'Must be a number.' }); continue }
    if (mustBePositive ? n <= 0 : n < 0) { issues.push({ field: key, message: mustBePositive ? 'Must be greater than 0%.' : 'Must be 0% or more.' }); continue }
    if (n > max) { issues.push({ field: key, message: `Must be at most ${max * 100}%.` }); continue }
    overlay[key] = n
  }

  // Call-out minimum ($).
  if (inputs.call_out_minimum_ex_gst !== null && inputs.call_out_minimum_ex_gst !== undefined && inputs.call_out_minimum_ex_gst !== '') {
    const n = typeof inputs.call_out_minimum_ex_gst === 'number' ? inputs.call_out_minimum_ex_gst : Number(inputs.call_out_minimum_ex_gst)
    if (!Number.isFinite(n) || n < 0) issues.push({ field: 'call_out_minimum_ex_gst', message: 'Must be 0 or more.' })
    else if (n > MAX_CALL_OUT_EX_GST) issues.push({ field: 'call_out_minimum_ex_gst', message: `Must be at most $${MAX_CALL_OUT_EX_GST}.` })
    else overlay.call_out_minimum_ex_gst = n
  }

  // GST flag.
  if (typeof inputs.gst_registered === 'boolean') overlay.gst_registered = inputs.gst_registered

  // Pricing model + hourly levers.
  if (inputs.pricing_model === 'sqm' || inputs.pricing_model === 'hourly') {
    overlay.pricing_model = inputs.pricing_model
  } else if (inputs.pricing_model != null) {
    issues.push({ field: 'pricing_model', message: "Must be 'sqm' or 'hourly'." })
  }

  if (inputs.hourly_rate !== null && inputs.hourly_rate !== undefined && inputs.hourly_rate !== '') {
    const n = typeof inputs.hourly_rate === 'number' ? inputs.hourly_rate : Number(inputs.hourly_rate)
    if (!Number.isFinite(n) || n <= 0) issues.push({ field: 'hourly_rate', message: 'Hourly rate must be greater than 0.' })
    else if (n > MAX_HOURLY_RATE) issues.push({ field: 'hourly_rate', message: `Hourly rate must be at most $${MAX_HOURLY_RATE}.` })
    else overlay.hourly_rate = n
  }

  if (inputs.production_rate_per_unit) {
    const cleaned: Partial<Record<PaintScope, number>> = {}
    for (const s of EDITABLE_SCOPES) {
      const raw = inputs.production_rate_per_unit[s]
      if (raw === null || raw === undefined || raw === '') continue
      const n = typeof raw === 'number' ? raw : Number(raw)
      if (!Number.isFinite(n) || n <= 0) { issues.push({ field: `production_rate_per_unit.${s}`, message: 'Must be greater than 0.' }); continue }
      if (n > MAX_PRODUCTION_RATE) { issues.push({ field: `production_rate_per_unit.${s}`, message: `Must be at most ${MAX_PRODUCTION_RATE}.` }); continue }
      cleaned[s] = n
    }
    if (Object.keys(cleaned).length > 0) overlay.production_rate_per_unit = cleaned
  }

  if (issues.length > 0) return { ok: false, issues }
  return { ok: true, overlay }
}
