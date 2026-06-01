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
import {
  EDITABLE_MATERIALS,
  buildOverlayFromInputs,
  effectiveRateCardFromOverlay,
  parseRoofingRateOverlay,
} from '@/lib/roofing/rate-card-overlay'
import { DEFAULT_ROOFING_RATE_CARD } from '@/lib/roofing/pricing'

export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

async function tenantFromBearer(req: Request) {
  const auth = req.headers.get('authorization') ?? ''
  if (!auth.toLowerCase().startsWith('bearer ')) return null
  const token = auth.slice(7).trim()
  if (!token) return null
  const { data, error } = await supabase.auth.getUser(token)
  if (error || !data.user) return null
  const { data: tenant } = await supabase
    .from('tenants')
    .select('id, trade, trades')
    .eq('owner_user_id', data.user.id)
    .maybeSingle()
  if (!tenant) return null
  return tenant
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
  const overrides =
    parsed.ok && parsed.overlay.reroof_rate_per_m2
      ? parsed.overlay.reroof_rate_per_m2
      : {}
  return Response.json({
    ok: true,
    materials: EDITABLE_MATERIALS,
    defaults: DEFAULT_ROOFING_RATE_CARD.reroof_rate_per_m2,
    overrides,
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
  const inputs = (body as { reroof_rate_per_m2?: unknown })?.reroof_rate_per_m2 ?? {}
  if (typeof inputs !== 'object' || inputs === null || Array.isArray(inputs)) {
    return Response.json(
      { ok: false, error: 'invalid_request', issues: [{ field: 'reroof_rate_per_m2', message: 'Must be an object' }] },
      { status: 400 },
    )
  }
  const built = buildOverlayFromInputs(inputs as Record<string, unknown>)
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
