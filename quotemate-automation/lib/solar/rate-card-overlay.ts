// ════════════════════════════════════════════════════════════════════
// Solar — per-tenant rate-card overlay (read + merge + validate).
//
// The solar twin of lib/roofing/rate-card-overlay.ts. Until now every
// tenant quoted from the hardcoded DEFAULT_SOLAR_CONFIG.default_rate_card
// (calculateSolarPrice's rateCard parameter existed but no caller passed
// it). This module wires the promised-but-never-built override:
//
// Storage: pricing_book.overlays.solar_rate_card (jsonb), preferring the
// tenant's trade='solar' pricing_book row, falling back to any row.
//
// Tenant-editable levers (the commercial ones only):
//   • install_rate_per_kw.standard_panels / .premium_panels ($/kW DC)
//   • multi_storey_loading_pct / complex_roof_loading_pct (fractions)
//   • call_out_minimum_ex_gst ($ floor; 0 = no floor)
//   • gst_registered
//   • stc_price_aud ($/certificate the tenant redeems)
//   • deposit_pct (% of net inc-GST charged at Stripe deposit mint)
//
// Deliberately NOT tenant levers (regulatory / liability rails, same call
// as roofing): deeming schedule, STC zone tables, export limits, derate,
// guardrail sanity bands, GOOD/MIDDLE sizing fractions, statutory GST rate.
//
// MERGE SEMANTICS (identical to roofing): a supplied key REPLACES the
// default; missing/null/blank falls back; out-of-range values are rejected
// field-by-field at write time. The read-side zod schema and the write-side
// validator MUST accept the same value space — a mismatch silently discards
// the tenant's whole overlay (the Ricardos-class bug).
//
// PURE except loadSolarRateCard (which takes an injected client).
// ════════════════════════════════════════════════════════════════════

import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import { DEFAULT_SOLAR_RATE_CARD } from './pricing'
import type { SolarConfig, SolarRateCard } from './types'

/** $/kW bounds — a $0 rate would zero the quote; cap guards fat-fingers. */
export const MIN_RATE_PER_KW = 0
export const MAX_RATE_PER_KW = 5000

export const MAX_LOADING_PCT = 1.0
export const MIN_LOADING_PCT = 0

/** Call-out floor: 0 is meaningful (no floor); cap guards a typo. */
export const MAX_CALL_OUT_MINIMUM = 20000

/** STC spot price band — certificates trade well inside this. */
export const MIN_STC_PRICE = 1
export const MAX_STC_PRICE = 60

/** Deposit percentage of net inc-GST charged at the Stripe mint. */
export const MIN_DEPOSIT_PCT = 1
export const MAX_DEPOSIT_PCT = 50

const RatePerKw = z
  .number()
  .positive('Rate must be greater than 0')
  .max(MAX_RATE_PER_KW, `Rate must be at most $${MAX_RATE_PER_KW}/kW`)

const LoadingPct = z
  .number()
  .min(MIN_LOADING_PCT, 'Loading must be 0% or more')
  .max(MAX_LOADING_PCT, `Loading must be at most ${MAX_LOADING_PCT * 100}%`)

export const SolarRateOverlaySchema = z.object({
  install_rate_per_kw: z
    .object({
      standard_panels: RatePerKw.optional().nullable(),
      premium_panels: RatePerKw.optional().nullable(),
    })
    .partial()
    .optional(),
  multi_storey_loading_pct: LoadingPct.optional().nullable(),
  complex_roof_loading_pct: LoadingPct.optional().nullable(),
  call_out_minimum_ex_gst: z.number().min(0).max(MAX_CALL_OUT_MINIMUM).optional().nullable(),
  gst_registered: z.boolean().optional().nullable(),
  stc_price_aud: z.number().min(MIN_STC_PRICE).max(MAX_STC_PRICE).optional().nullable(),
  deposit_pct: z.number().min(MIN_DEPOSIT_PCT).max(MAX_DEPOSIT_PCT).optional().nullable(),
})

export type SolarRateOverlay = z.infer<typeof SolarRateOverlaySchema>

export type ParseSolarOverlayResult =
  | { ok: true; overlay: SolarRateOverlay }
  | { ok: false; issues: Array<{ field: string; message: string }> }

/** PURE — parse + validate an unknown JSON value as a SolarRateOverlay. */
export function parseSolarRateOverlay(input: unknown): ParseSolarOverlayResult {
  if (input == null) return { ok: true, overlay: {} }
  if (typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, issues: [{ field: '', message: 'Overlay must be an object.' }] }
  }
  const parsed = SolarRateOverlaySchema.safeParse(input)
  if (parsed.success) return { ok: true, overlay: parsed.data }
  return {
    ok: false,
    issues: parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
  }
}

/**
 * PURE — merge an overlay onto the default rate card. `unknown` panel
 * grade always stays 0 (the throw-if-priced sentinel) — never overridable.
 */
export function mergeSolarRateCard(
  base: SolarRateCard,
  overlay: SolarRateOverlay | null | undefined,
): SolarRateCard {
  if (!overlay) return base
  let merged: SolarRateCard = base
  if (overlay.install_rate_per_kw) {
    const map = { ...base.install_rate_per_kw }
    const std = overlay.install_rate_per_kw.standard_panels
    const prem = overlay.install_rate_per_kw.premium_panels
    if (typeof std === 'number' && Number.isFinite(std)) map.standard_panels = std
    if (typeof prem === 'number' && Number.isFinite(prem)) map.premium_panels = prem
    merged = { ...merged, install_rate_per_kw: map }
  }
  if (
    typeof overlay.multi_storey_loading_pct === 'number' &&
    Number.isFinite(overlay.multi_storey_loading_pct)
  ) {
    merged = { ...merged, multi_storey_loading_pct: overlay.multi_storey_loading_pct }
  }
  if (
    typeof overlay.complex_roof_loading_pct === 'number' &&
    Number.isFinite(overlay.complex_roof_loading_pct)
  ) {
    merged = { ...merged, complex_roof_loading_pct: overlay.complex_roof_loading_pct }
  }
  if (
    typeof overlay.call_out_minimum_ex_gst === 'number' &&
    Number.isFinite(overlay.call_out_minimum_ex_gst)
  ) {
    merged = { ...merged, call_out_minimum_ex_gst: overlay.call_out_minimum_ex_gst }
  }
  if (typeof overlay.gst_registered === 'boolean') {
    merged = { ...merged, gst_registered: overlay.gst_registered }
  }
  return merged
}

/** PURE — the tenant's STC $/certificate override, or null for default. */
export function stcPriceFromOverlay(overlay: SolarRateOverlay | null | undefined): number | null {
  const v = overlay?.stc_price_aud
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

/** PURE — the tenant's deposit %, or null for the platform default (30). */
export function depositPctFromOverlay(overlay: SolarRateOverlay | null | undefined): number | null {
  const v = overlay?.deposit_pct
  return typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : null
}

/** Convenience — effective rate card from a raw jsonb value; malformed
 *  overlays fall back to the default so a bad row never breaks a quote. */
export function effectiveSolarRateCardFromOverlay(
  overlayJson: unknown,
  base: SolarRateCard = DEFAULT_SOLAR_RATE_CARD,
): SolarRateCard {
  const parsed = parseSolarRateOverlay(overlayJson)
  if (!parsed.ok) return base
  return mergeSolarRateCard(base, parsed.overlay)
}

/** Shape of the partial body the dashboard PATCH sends. */
export type SolarDashboardInputs = {
  install_rate_per_kw?: {
    standard_panels?: number | string | null
    premium_panels?: number | string | null
  }
  multi_storey_loading_pct?: number | string | null
  complex_roof_loading_pct?: number | string | null
  call_out_minimum_ex_gst?: number | string | null
  gst_registered?: boolean | null
  stc_price_aud?: number | string | null
  deposit_pct?: number | string | null
}

/** PURE — dashboard body → canonical overlay, dropping blanks so they
 *  fall back to defaults. Field-by-field issues, never silent clamps. */
export function buildSolarOverlayFromInputs(inputs: SolarDashboardInputs): ParseSolarOverlayResult {
  const issues: Array<{ field: string; message: string }> = []
  const overlay: SolarRateOverlay = {}

  const rates = inputs.install_rate_per_kw
  if (rates) {
    const cleaned: { standard_panels?: number; premium_panels?: number } = {}
    for (const grade of ['standard_panels', 'premium_panels'] as const) {
      const raw = rates[grade]
      if (raw === null || raw === undefined || raw === '') continue
      const n = typeof raw === 'number' ? raw : Number(raw)
      if (!Number.isFinite(n)) {
        issues.push({ field: `install_rate_per_kw.${grade}`, message: 'Rate must be a number.' })
        continue
      }
      if (n <= MIN_RATE_PER_KW) {
        issues.push({ field: `install_rate_per_kw.${grade}`, message: 'Rate must be greater than 0.' })
        continue
      }
      if (n > MAX_RATE_PER_KW) {
        issues.push({
          field: `install_rate_per_kw.${grade}`,
          message: `Rate must be at most $${MAX_RATE_PER_KW}/kW.`,
        })
        continue
      }
      cleaned[grade] = n
    }
    if (Object.keys(cleaned).length > 0) overlay.install_rate_per_kw = cleaned
  }

  for (const [key, raw] of [
    ['multi_storey_loading_pct', inputs.multi_storey_loading_pct],
    ['complex_roof_loading_pct', inputs.complex_roof_loading_pct],
  ] as const) {
    if (raw === null || raw === undefined || raw === '') continue
    const n = typeof raw === 'number' ? raw : Number(raw)
    if (!Number.isFinite(n)) {
      issues.push({ field: key, message: 'Loading must be a number.' })
      continue
    }
    if (n < MIN_LOADING_PCT || n > MAX_LOADING_PCT) {
      issues.push({
        field: key,
        message: `Loading must be between 0% and ${MAX_LOADING_PCT * 100}%.`,
      })
      continue
    }
    overlay[key] = n
  }

  const dollarKeys = [
    ['call_out_minimum_ex_gst', inputs.call_out_minimum_ex_gst, 0, MAX_CALL_OUT_MINIMUM],
    ['stc_price_aud', inputs.stc_price_aud, MIN_STC_PRICE, MAX_STC_PRICE],
    ['deposit_pct', inputs.deposit_pct, MIN_DEPOSIT_PCT, MAX_DEPOSIT_PCT],
  ] as const
  for (const [key, raw, min, max] of dollarKeys) {
    if (raw === null || raw === undefined || raw === '') continue
    const n = typeof raw === 'number' ? raw : Number(raw)
    if (!Number.isFinite(n)) {
      issues.push({ field: key, message: 'Amount must be a number.' })
      continue
    }
    if (n < min || n > max) {
      issues.push({ field: key, message: `Amount must be between ${min} and ${max}.` })
      continue
    }
    overlay[key] = n
  }

  if (typeof inputs.gst_registered === 'boolean') {
    overlay.gst_registered = inputs.gst_registered
  }

  if (issues.length > 0) return { ok: false, issues }
  return { ok: true, overlay }
}

// ── Loader (server routes inject their Supabase client) ──────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type OverlayClient = SupabaseClient<any, any, any, any, any>

/**
 * One-call composite for the estimate/redraft/select-building routes:
 * load the tenant overlay, merge the rate card, and apply the STC-price
 * override onto the config. No overlay → the exact pre-override inputs.
 */
export async function loadSolarTenantRates(
  supabase: OverlayClient,
  tenantId: string | null | undefined,
  config: SolarConfig,
): Promise<{ config: SolarConfig; rateCard: SolarRateCard; overlay: SolarRateOverlay }> {
  const overlay = await loadSolarRateOverlay(supabase, tenantId)
  const rateCard = mergeSolarRateCard(config.default_rate_card, overlay)
  const stc = stcPriceFromOverlay(overlay)
  return {
    config: stc !== null ? { ...config, stc_price_aud: stc } : config,
    rateCard,
    overlay,
  }
}

/**
 * Load the tenant's parsed solar overlay from pricing_book.overlays
 * (trade='solar' row preferred, any row as fallback — mirrors the
 * roofing-rates route). Null tenant / missing row / malformed overlay all
 * degrade to {} so quoting is never blocked by rate-card state.
 */
export async function loadSolarRateOverlay(
  supabase: OverlayClient,
  tenantId: string | null | undefined,
): Promise<SolarRateOverlay> {
  if (!tenantId) return {}
  try {
    let row = (
      await supabase
        .from('pricing_book')
        .select('overlays')
        .eq('tenant_id', tenantId)
        .eq('trade', 'solar')
        .maybeSingle()
    ).data as { overlays?: unknown } | null
    if (!row) {
      row = (
        await supabase
          .from('pricing_book')
          .select('overlays')
          .eq('tenant_id', tenantId)
          .limit(1)
          .maybeSingle()
      ).data as { overlays?: unknown } | null
    }
    const overlays = row?.overlays as { solar_rate_card?: unknown } | null | undefined
    const parsed = parseSolarRateOverlay(overlays?.solar_rate_card)
    return parsed.ok ? parsed.overlay : {}
  } catch {
    return {}
  }
}
