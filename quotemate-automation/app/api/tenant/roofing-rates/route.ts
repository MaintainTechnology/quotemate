// /api/tenant/roofing-rates — per-tenant $/m² overrides for the roofing
// estimator. GET to read current values + defaults; PATCH to update.
//
// Storage: pricing_book.overlays.roofing_rate_card (jsonb). We use the
// tenant's primary pricing_book row (the one matching tenants.trade).
// Roofing tenants will eventually grow their own pricing_book row when
// the v9 trades-as-data activation flow ships; until then this Phase 1
// approach piggybacks on the primary row's overlays jsonb — same shape
// the v8 early-bird discount uses.
//
// Auth: bearer Supabase access token, resolved to the tenant via
// owner_user_id. The roofing trade need NOT be active in trades[] for
// GET, but PATCH still works the same regardless.

import { createClient } from '@supabase/supabase-js'
import { resolveTenantRequest } from '@/lib/tenant/from-request'
import {
  EDITABLE_MATERIALS,
  buildOverlayFromInputs,
  effectiveRateCardFromOverlay,
  parseRoofingRateOverlay,
} from '@/lib/roofing/rate-card-overlay'
import { DEFAULT_ROOFING_RATE_CARD } from '@/lib/roofing/pricing'
import { SOLAR_ALLOWANCE_DEFAULTS } from '@/lib/roofing/solar'

export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

async function tenantFromBearer(req: Request) {
  // Dual-auth: Clerk session token OR legacy Supabase token → tenant row.
  const resolved = await resolveTenantRequest(supabase, req, 'id, trade, trades')
  return (resolved?.tenant ?? null) as
    | { id: string; trade: string | null; trades: string[] | null }
    | null
}

/** Find the tenant's primary pricing_book row. Returns null when no row
 *  exists (tenant hasn't completed onboarding). */
async function findPrimaryPricingBook(tenant: {
  id: string
  trade: string | null
}): Promise<{ id: string; overlays: unknown } | null> {
  // Prefer the row matching tenants.trade. If that's somehow missing,
  // fall back to ANY pricing_book row for the tenant — the roofing
  // overlay is trade-agnostic so it doesn't matter which row holds it.
  if (tenant.trade) {
    const { data } = await supabase
      .from('pricing_book')
      .select('id, overlays')
      .eq('tenant_id', tenant.id)
      .eq('trade', tenant.trade)
      .maybeSingle()
    if (data) return data as { id: string; overlays: unknown }
  }
  const { data } = await supabase
    .from('pricing_book')
    .select('id, overlays')
    .eq('tenant_id', tenant.id)
    .limit(1)
    .maybeSingle()
  return (data as { id: string; overlays: unknown } | null) ?? null
}

// ─── GET ────────────────────────────────────────────────────────────
// Returns the canonical defaults + the per-tenant overrides currently
// stored. The UI uses defaults as input placeholders ("Default $95/m²")
// and pre-fills any saved override values.

export async function GET(req: Request) {
  const tenant = await tenantFromBearer(req)
  if (!tenant) {
    return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }
  const book = await findPrimaryPricingBook(tenant)
  const overlay = book?.overlays as
    | { roofing_rate_card?: unknown }
    | null
    | undefined
  const parsed = parseRoofingRateOverlay(overlay?.roofing_rate_card)
  const overrideObj = parsed.ok ? parsed.overlay : {}
  return Response.json({
    ok: true,
    materials: EDITABLE_MATERIALS,
    defaults: {
      reroof_rate_per_m2: DEFAULT_ROOFING_RATE_CARD.reroof_rate_per_m2,
      multi_storey_loading_pct: DEFAULT_ROOFING_RATE_CARD.multi_storey_loading_pct,
      asbestos_loading_pct: DEFAULT_ROOFING_RATE_CARD.asbestos_loading_pct,
      complexity_loading_pct: 0,
      upgrade_material: DEFAULT_ROOFING_RATE_CARD.upgrade_material,
      gst_registered: DEFAULT_ROOFING_RATE_CARD.gst_registered,
      gutter_rate_per_lm: DEFAULT_ROOFING_RATE_CARD.gutter_rate_per_lm,
      downpipe_rate_per_each: DEFAULT_ROOFING_RATE_CARD.downpipe_rate_per_each,
      fascia_rate_per_lm: DEFAULT_ROOFING_RATE_CARD.fascia_rate_per_lm,
      soffit_rate_per_lm: DEFAULT_ROOFING_RATE_CARD.soffit_rate_per_lm,
      ridge_hip_repoint_rate_per_lm: DEFAULT_ROOFING_RATE_CARD.ridge_hip_repoint_rate_per_lm,
      valley_flashing_rate_per_lm: DEFAULT_ROOFING_RATE_CARD.valley_flashing_rate_per_lm,
      box_gutter_rate_per_lm: DEFAULT_ROOFING_RATE_CARD.box_gutter_rate_per_lm,
      price_edge_works: DEFAULT_ROOFING_RATE_CARD.price_edge_works,
      call_out_minimum_ex_gst: DEFAULT_ROOFING_RATE_CARD.call_out_minimum_ex_gst,
      solar_detach_reinstate_base_ex_gst: SOLAR_ALLOWANCE_DEFAULTS.base_ex_gst,
      solar_detach_reinstate_per_array_ex_gst: SOLAR_ALLOWANCE_DEFAULTS.per_array_ex_gst,
    },
    overrides: {
      reroof_rate_per_m2: overrideObj.reroof_rate_per_m2 ?? {},
      multi_storey_loading_pct: overrideObj.multi_storey_loading_pct ?? null,
      asbestos_loading_pct: overrideObj.asbestos_loading_pct ?? null,
      complexity_loading_pct: overrideObj.complexity_loading_pct ?? null,
      upgrade_material: overrideObj.upgrade_material ?? null,
      gst_registered: overrideObj.gst_registered ?? null,
      gutter_rate_per_lm: overrideObj.gutter_rate_per_lm ?? null,
      downpipe_rate_per_each: overrideObj.downpipe_rate_per_each ?? null,
      fascia_rate_per_lm: overrideObj.fascia_rate_per_lm ?? null,
      soffit_rate_per_lm: overrideObj.soffit_rate_per_lm ?? null,
      ridge_hip_repoint_rate_per_lm: overrideObj.ridge_hip_repoint_rate_per_lm ?? null,
      valley_flashing_rate_per_lm: overrideObj.valley_flashing_rate_per_lm ?? null,
      box_gutter_rate_per_lm: overrideObj.box_gutter_rate_per_lm ?? null,
      price_edge_works: overrideObj.price_edge_works ?? null,
      call_out_minimum_ex_gst: overrideObj.call_out_minimum_ex_gst ?? null,
      solar_detach_reinstate_base_ex_gst: overrideObj.solar_detach_reinstate_base_ex_gst ?? null,
      solar_detach_reinstate_per_array_ex_gst: overrideObj.solar_detach_reinstate_per_array_ex_gst ?? null,
    },
    has_pricing_book: !!book,
  })
}

// ─── PATCH ──────────────────────────────────────────────────────────
// Body shape:
//   { reroof_rate_per_m2?: Partial<Record<RoofMaterial, number|null|''>> }
// Blank / null / undefined values clear that material's override
// (the global default takes over). Numeric values are validated as
// strictly positive and <= MAX_RATE_PER_M2.

export async function PATCH(req: Request) {
  const tenant = await tenantFromBearer(req)
  if (!tenant) {
    return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return Response.json({ ok: false, error: 'invalid_json' }, { status: 400 })
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return Response.json(
      { ok: false, error: 'invalid_request', issues: [{ field: '', message: 'Body must be an object' }] },
      { status: 400 },
    )
  }
  // The PATCH now accepts the full overlay shape (rate map + 3 loadings
  // + upgrade material + gst flag). buildOverlayFromInputs handles
  // partial bodies (any key omitted falls back to the default).
  const built = buildOverlayFromInputs(body as Record<string, unknown>)
  if (!built.ok) {
    return Response.json(
      { ok: false, error: 'validation_failed', issues: built.issues },
      { status: 400 },
    )
  }

  const book = await findPrimaryPricingBook(tenant)
  if (!book) {
    return Response.json(
      {
        ok: false,
        error: 'no_pricing_book',
        detail:
          'No pricing_book row for this tenant — complete onboarding for your primary trade before setting roofing overrides.',
      },
      { status: 404 },
    )
  }

  // Merge new overlay into the existing overlays jsonb (preserve other keys
  // like early_bird, quote_display, etc.).
  const existingOverlays =
    book.overlays && typeof book.overlays === 'object' && !Array.isArray(book.overlays)
      ? (book.overlays as Record<string, unknown>)
      : {}
  const nextOverlays = {
    ...existingOverlays,
    roofing_rate_card: built.overlay,
  }
  const { error: upErr } = await supabase
    .from('pricing_book')
    .update({ overlays: nextOverlays })
    .eq('id', book.id)
  if (upErr) {
    return Response.json(
      { ok: false, error: 'update_failed', detail: upErr.message },
      { status: 500 },
    )
  }

  // Echo back the effective rate card so the UI can update instantly.
  const effective = effectiveRateCardFromOverlay(built.overlay)
  return Response.json({
    ok: true,
    overrides: built.overlay.reroof_rate_per_m2 ?? {},
    effective_rate_per_m2: effective.reroof_rate_per_m2,
  })
}
