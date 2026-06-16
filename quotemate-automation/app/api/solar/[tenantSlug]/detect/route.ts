// POST /api/solar/[tenantSlug]/detect — PUBLIC, customer-facing.
//
// The PRE-ESTIMATE building picker. A solar address can resolve to a
// property with several structures (dwelling + shed/garage/granny flat);
// this route enumerates every detected building up front (the cheap
// Geoscape-only step) so the address form can offer "which roof?" before
// the customer pays the full Google Solar estimate.
//
// Mirrors the estimate route's tenant resolution + zod address validation,
// but does NOTHING expensive: no engine, no persistence. Best-effort by
// contract — ANY failure (no Geoscape key, provider error, ≤1 structure)
// resolves to `buildings: []`, and the caller simply hides the picker and
// falls back to today's single-building flow.
//
// Next 16: params is a Promise (awaited); force-dynamic.

import { createClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { detectPropertyBuildings } from '@/lib/solar/buildings'
import { geocodeAddress } from '@/lib/solar/geocode'
import type { DetectedBuilding, LatLng } from '@/lib/solar/types'

export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

const AU_STATES = ['NSW', 'VIC', 'QLD', 'SA', 'WA', 'TAS', 'ACT', 'NT'] as const

const DetectRequestSchema = z.object({
  address: z.object({
    address: z.string().min(3),
    postcode: z.string().min(3),
    state: z.enum(AU_STATES),
  }),
})

export async function POST(
  req: Request,
  ctx: { params: Promise<{ tenantSlug: string }> },
) {
  const { tenantSlug } = await ctx.params

  // ── Resolve the tenant from the path segment (tenant id). ────────
  const { data: tenant } = await supabase
    .from('tenants')
    .select('id, status')
    .eq('id', tenantSlug)
    .maybeSingle()
  if (!tenant || tenant.status === 'suspended') {
    return Response.json({ ok: false, error: 'tenant_not_found' }, { status: 404 })
  }

  // ── Parse + validate the body. ───────────────────────────────────
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return Response.json({ ok: false, error: 'invalid_json' }, { status: 400 })
  }
  const parsed = DetectRequestSchema.safeParse(body)
  if (!parsed.success) {
    return Response.json(
      { ok: false, error: 'invalid_request', issues: parsed.error.issues },
      { status: 400 },
    )
  }

  // ── Detect (best-effort). Geoscape down / no key / ≤1 structure all
  //    resolve to []; the picker is simply hidden client-side. Never 500s
  //    on a detection miss — detection is pure enrichment over the form.
  let buildings: DetectedBuilding[]
  try {
    buildings = await detectPropertyBuildings(parsed.data.address)
  } catch {
    buildings = []
  }

  // ── Map centre for the always-on address-form picker. The map must show
  //    even with 0–1 detected buildings (so the customer can free-tap any
  //    roof), so we geocode the address. Best-effort: fall back to a detected
  //    building centroid, then null (the form then hides the map). ─────────
  let center: LatLng | null = null
  try {
    const g = await geocodeAddress(
      `${parsed.data.address.address}, ${parsed.data.address.state}`,
      { apiKey: process.env.GOOGLE_GEOCODE_API_KEY ?? process.env.GOOGLE_MAPS_API_KEY },
    )
    if (g.ok) center = g.location
  } catch {
    center = null
  }
  if (!center && buildings.length > 0) center = buildings[0].centroid

  return Response.json({ ok: true, buildings, center })
}
