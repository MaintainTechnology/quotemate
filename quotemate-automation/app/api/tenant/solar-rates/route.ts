// /api/tenant/solar-rates — per-tenant overrides for the solar estimator.
// GET to read defaults + current overrides; PATCH to update. The solar
// twin of /api/tenant/roofing-rates.
//
// Storage: pricing_book.overlays.solar_rate_card (jsonb), preferring the
// tenant's trade='solar' pricing_book row, falling back to the primary
// row (the same row-resolution the roofing overlay uses).
//
// Auth: bearer token resolved to the tenant via resolveTenantRequest.

import { createClient } from '@supabase/supabase-js'
import { resolveTenantRequest } from '@/lib/tenant/from-request'
import {
  buildSolarOverlayFromInputs,
  parseSolarRateOverlay,
  type SolarDashboardInputs,
} from '@/lib/solar/rate-card-overlay'
import { DEFAULT_SOLAR_RATE_CARD } from '@/lib/solar/pricing'
import { DEFAULT_SOLAR_CONFIG } from '@/lib/solar/config'

export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

async function tenantFromBearer(req: Request) {
  const resolved = await resolveTenantRequest(supabase, req, 'id, trade, trades')
  return (resolved?.tenant ?? null) as
    | { id: string; trade: string | null; trades: string[] | null }
    | null
}

/** The tenant's solar pricing_book row, else the primary/any row (the
 *  overlay is read back with the same trade-first preference). */
async function findSolarPricingBook(tenant: {
  id: string
  trade: string | null
}): Promise<{ id: string; overlays: unknown } | null> {
  const { data: solarRow } = await supabase
    .from('pricing_book')
    .select('id, overlays')
    .eq('tenant_id', tenant.id)
    .eq('trade', 'solar')
    .maybeSingle()
  if (solarRow) return solarRow as { id: string; overlays: unknown }
  const { data } = await supabase
    .from('pricing_book')
    .select('id, overlays')
    .eq('tenant_id', tenant.id)
    .limit(1)
    .maybeSingle()
  return (data as { id: string; overlays: unknown } | null) ?? null
}

export async function GET(req: Request) {
  const tenant = await tenantFromBearer(req)
  if (!tenant) {
    return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }
  const book = await findSolarPricingBook(tenant)
  const overlays = book?.overlays as { solar_rate_card?: unknown } | null | undefined
  const parsed = parseSolarRateOverlay(overlays?.solar_rate_card)
  const o = parsed.ok ? parsed.overlay : {}
  return Response.json({
    ok: true,
    defaults: {
      install_rate_per_kw: {
        standard_panels: DEFAULT_SOLAR_RATE_CARD.install_rate_per_kw.standard_panels,
        premium_panels: DEFAULT_SOLAR_RATE_CARD.install_rate_per_kw.premium_panels,
      },
      multi_storey_loading_pct: DEFAULT_SOLAR_RATE_CARD.multi_storey_loading_pct,
      complex_roof_loading_pct: DEFAULT_SOLAR_RATE_CARD.complex_roof_loading_pct,
      call_out_minimum_ex_gst: DEFAULT_SOLAR_RATE_CARD.call_out_minimum_ex_gst ?? 0,
      gst_registered: DEFAULT_SOLAR_RATE_CARD.gst_registered,
      stc_price_aud: DEFAULT_SOLAR_CONFIG.stc_price_aud,
      deposit_pct: 30,
    },
    overrides: {
      install_rate_per_kw: o.install_rate_per_kw ?? {},
      multi_storey_loading_pct: o.multi_storey_loading_pct ?? null,
      complex_roof_loading_pct: o.complex_roof_loading_pct ?? null,
      call_out_minimum_ex_gst: o.call_out_minimum_ex_gst ?? null,
      gst_registered: o.gst_registered ?? null,
      stc_price_aud: o.stc_price_aud ?? null,
      deposit_pct: o.deposit_pct ?? null,
    },
    has_pricing_book: !!book,
  })
}

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
  const built = buildSolarOverlayFromInputs(body as SolarDashboardInputs)
  if (!built.ok) {
    return Response.json(
      { ok: false, error: 'validation_failed', issues: built.issues },
      { status: 400 },
    )
  }

  const book = await findSolarPricingBook(tenant)
  if (!book) {
    return Response.json(
      {
        ok: false,
        error: 'no_pricing_book',
        detail:
          'No pricing_book row for this tenant — complete onboarding before setting solar overrides.',
      },
      { status: 404 },
    )
  }

  const existingOverlays =
    book.overlays && typeof book.overlays === 'object' && !Array.isArray(book.overlays)
      ? (book.overlays as Record<string, unknown>)
      : {}
  const nextOverlays = { ...existingOverlays, solar_rate_card: built.overlay }
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
  return Response.json({ ok: true, overrides: built.overlay })
}
