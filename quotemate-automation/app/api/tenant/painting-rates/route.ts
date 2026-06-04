// /api/tenant/painting-rates — per-tenant overrides for the painting
// estimator. GET reads current values + defaults; PATCH updates.
//
// Storage: pricing_book.overlays.painting_rate_card (jsonb) on the tenant's
// primary pricing_book row — same piggyback pattern as roofing-rates.
//
// Auth: bearer Supabase access token → tenant via owner_user_id.

import { createClient } from '@supabase/supabase-js'
import {
  EDITABLE_SCOPES,
  buildPaintingOverlayFromInputs,
  effectivePaintingRateCardFromOverlay,
  parsePaintingRateOverlay,
} from '@/lib/painting/rate-card-overlay'
import { DEFAULT_PAINTING_RATE_CARD } from '@/lib/painting/pricing'

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
  return tenant as { id: string; trade: string | null }
}

async function findPrimaryPricingBook(tenant: {
  id: string
  trade: string | null
}): Promise<{ id: string; overlays: unknown } | null> {
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

export async function GET(req: Request) {
  const tenant = await tenantFromBearer(req)
  if (!tenant) {
    return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }
  const book = await findPrimaryPricingBook(tenant)
  const overlay = book?.overlays as { painting_rate_card?: unknown } | null | undefined
  const parsed = parsePaintingRateOverlay(overlay?.painting_rate_card)
  const o = parsed.ok ? parsed.overlay : {}
  const d = DEFAULT_PAINTING_RATE_CARD
  return Response.json({
    ok: true,
    scopes: EDITABLE_SCOPES,
    defaults: {
      rate_per_unit: d.rate_per_unit,
      double_storey_loading_pct: d.double_storey_loading_pct,
      premium_uplift_pct: d.premium_uplift_pct,
      good_refresh_fraction: d.good_refresh_fraction,
      colour_change_extra: d.colour_change_extra,
      call_out_minimum_ex_gst: d.call_out_minimum_ex_gst ?? 0,
      gst_registered: d.gst_registered,
    },
    overrides: {
      rate_per_unit: o.rate_per_unit ?? {},
      double_storey_loading_pct: o.double_storey_loading_pct ?? null,
      premium_uplift_pct: o.premium_uplift_pct ?? null,
      good_refresh_fraction: o.good_refresh_fraction ?? null,
      colour_change_extra: o.colour_change_extra ?? null,
      call_out_minimum_ex_gst: o.call_out_minimum_ex_gst ?? null,
      gst_registered: o.gst_registered ?? null,
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
  const built = buildPaintingOverlayFromInputs(body as Record<string, unknown>)
  if (!built.ok) {
    return Response.json({ ok: false, error: 'validation_failed', issues: built.issues }, { status: 400 })
  }

  const book = await findPrimaryPricingBook(tenant)
  if (!book) {
    return Response.json(
      {
        ok: false,
        error: 'no_pricing_book',
        detail: 'No pricing_book row for this tenant — complete onboarding for your primary trade first.',
      },
      { status: 404 },
    )
  }

  const existingOverlays =
    book.overlays && typeof book.overlays === 'object' && !Array.isArray(book.overlays)
      ? (book.overlays as Record<string, unknown>)
      : {}
  const nextOverlays = { ...existingOverlays, painting_rate_card: built.overlay }
  const { error: upErr } = await supabase
    .from('pricing_book')
    .update({ overlays: nextOverlays })
    .eq('id', book.id)
  if (upErr) {
    return Response.json({ ok: false, error: 'update_failed', detail: upErr.message }, { status: 500 })
  }

  const effective = effectivePaintingRateCardFromOverlay(built.overlay)
  return Response.json({ ok: true, effective })
}
