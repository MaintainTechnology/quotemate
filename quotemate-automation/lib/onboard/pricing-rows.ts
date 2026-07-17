// PURE — builds the pricing_book rows the activate route inserts, one per
// selected trade. Extracted from /api/onboard/activate so overlay placement
// and contents are unit-testable.
//
// Placement rule that matters: the roofing rate-card overlay lives on the
// tenant's PRIMARY-trade row (trades[0], mirrored to tenants.trade) — that is
// the row loadRoofingOverlay (/api/roofing/measure) and the dashboard
// Roof-rates editor (findPrimaryPricingBook in /api/tenant/roofing-rates)
// resolve. Writing it to the roofing row would strand the rates for any
// multi-trade tenant whose first trade isn't roofing.

import { buildPaintingOverlayFromInputs } from '@/lib/painting/rate-card-overlay'
import {
  buildOverlayFromInputs as buildRoofingOverlayFromInputs,
  type RoofingRateOverlay,
} from '@/lib/roofing/rate-card-overlay'
import { DEFAULT_ROOFING_RATE_CARD } from '@/lib/roofing/pricing'
import type { RoofMaterial } from '@/lib/roofing/types'
import { defaultsForTrade, type OnboardActivatePayload } from './schema'

// The schema validated the rate-card fields as positive numbers (or
// undefined) — this narrows the inferred `unknown` of its z.preprocess()
// wrappers.
const num = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? v : undefined

/**
 * PURE — the roofing rate-card overlay the wizard's answers amount to.
 *
 * Two deliberate behaviours:
 *   • A rate equal to the shipped default is dropped: the wizard pre-fills
 *     the defaults, and persisting an untouched pre-fill would pin the
 *     tenant to signup-time rates (the dashboard treats "no override" as
 *     "track the default"). Only genuine edits become overrides.
 *   • gst_registered always rides along: the roofing pricing engine reads
 *     GST from the overlay-merged rate card only (DEFAULT gst is true) —
 *     the pricing_book column never reaches it.
 */
export function roofingOverlayFromOnboarding(
  form: OnboardActivatePayload,
): RoofingRateOverlay {
  const rate = (v: unknown, material: RoofMaterial): number | undefined => {
    const n = num(v)
    return n !== undefined && n !== DEFAULT_ROOFING_RATE_CARD.reroof_rate_per_m2[material]
      ? n
      : undefined
  }
  const gst_registered = form.gst_registered ?? true
  const built = buildRoofingOverlayFromInputs({
    reroof_rate_per_m2: {
      colorbond_corrugated: rate(form.roofing_corrugated_rate, 'colorbond_corrugated'),
      colorbond_trimdek: rate(form.roofing_trimdek_rate, 'colorbond_trimdek'),
      colorbond_spandek: rate(form.roofing_spandek_rate, 'colorbond_spandek'),
      colorbond_kliplok: rate(form.roofing_kliplok_rate, 'colorbond_kliplok'),
      concrete_tile: rate(form.roofing_concrete_tile_rate, 'concrete_tile'),
      terracotta_tile: rate(form.roofing_terracotta_tile_rate, 'terracotta_tile'),
      cement_sheet: rate(form.roofing_cement_sheet_rate, 'cement_sheet'),
    },
    gst_registered,
  })
  if (!built.ok) {
    // Unreachable while the schema bounds mirror the overlay validator's —
    // but if they ever drift, dropping rates must not be silent.
    console.warn('[onboard] roofing overlay rejected — persisting GST only', built.issues)
    return { gst_registered }
  }
  return built.overlay
}

export type PricingBookRow = {
  tenant_id: string
  trade: OnboardActivatePayload['trades'][number]
  hourly_rate: number
  call_out_minimum: number
  default_markup_pct: number
  apprentice_rate: number
  senior_rate: number
  after_hours_multiplier: number
  min_labour_hours: number
  risk_buffer_pct: number
  gst_registered: boolean
  licence_type: string | null
  licence_number: string | null
  licence_state: string | null
  licence_expiry: string | null
  overlays?: Record<string, unknown>
}

/** PURE — one pricing_book row per selected trade. */
export function buildPricingRows(
  form: OnboardActivatePayload,
  tenantId: string,
): PricingBookRow[] {
  const primaryTrade = form.trades[0]
  const roofingOverlay = form.trades.includes('roofing')
    ? roofingOverlayFromOnboarding(form)
    : null

  return form.trades.map((t) => {
    const d = defaultsForTrade(t)

    const overlays: Record<string, unknown> = {}
    if (roofingOverlay && t === primaryTrade) {
      overlays.roofing_rate_card = roofingOverlay
    }
    if (t === 'painting') {
      const built = buildPaintingOverlayFromInputs({
        rate_per_unit: {
          walls: num(form.painting_walls_rate),
          ceilings: num(form.painting_ceilings_rate),
          trim: num(form.painting_trim_rate),
          exterior: num(form.painting_exterior_rate),
        },
        call_out_minimum_ex_gst: num(form.painting_call_out_minimum),
        gst_registered: form.gst_registered ?? true,
        // Hourly painters set a model + charge-out; sqm painters leave the
        // model at its default and these are inert.
        pricing_model: form.painting_pricing_model ?? 'sqm',
        hourly_rate: num(form.painting_hourly_rate),
      })
      // On any validation miss, persist an empty overlay so the estimator
      // falls back to DEFAULT_PAINTING_RATE_CARD rather than bad rates.
      overlays.painting_rate_card = built.ok ? built.overlay : {}
    }

    return {
      tenant_id: tenantId,
      trade: t,
      // Electrical/plumbing: the superRefine guarantees the three labour
      // rates are present, so the fallbacks are inert for them. Painting and
      // roofing never read the labour columns, but they're NOT NULL — keep
      // the harmless placeholders.
      hourly_rate: num(form.hourly_rate) ?? 110,
      call_out_minimum: num(form.call_out_minimum) ?? 150,
      default_markup_pct: num(form.default_markup_pct) ?? 0,
      apprentice_rate: num(form.apprentice_rate) ?? d.apprentice_rate,
      senior_rate: num(form.senior_rate) ?? d.senior_rate,
      after_hours_multiplier: num(form.after_hours_multiplier) ?? d.after_hours_multiplier,
      min_labour_hours: num(form.min_labour_hours) ?? d.min_labour_hours,
      risk_buffer_pct: num(form.risk_buffer_pct) ?? d.risk_buffer_pct,
      gst_registered: form.gst_registered ?? true,
      licence_type: form.licence_type || null,
      licence_number: form.licence_number || null,
      licence_state: form.state || null,
      licence_expiry: form.licence_expiry || null,
      ...(Object.keys(overlays).length > 0 ? { overlays } : {}),
    }
  })
}
