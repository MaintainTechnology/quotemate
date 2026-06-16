// GET /api/solar/[tenantSlug]/static-map — PUBLIC, tenant-gated Google
// Maps Static proxy for the PRE-ESTIMATE building picker (mode='local').
//
// The address form's "Find my roof" step (/detect) returns the detected
// buildings but no image. This route gives the form a satellite photo to
// draw those building outlines over, centred on a caller-supplied
// coordinate (the centroid spanning the detected structures) at the SAME
// zoom 20 / 640×480 framing the post-estimate static-map route uses — so
// the building-footprint projection (lib/solar/project-latlng.ts) is
// pixel-aligned by construction.
//
// Tenant-gated like /detect (the slug is the tenant id) but NOT bearer-
// authed — it is part of the public customer entry form. Keeps
// GOOGLE_MAPS_API_KEY server-side. Best-effort: any failure is a normal
// error response; the form simply hides the picker preview.
//
// Next 16: params is a Promise (awaited); force-dynamic.

import { createClient } from '@supabase/supabase-js'
import { buildStaticMapUrl } from '@/lib/roofing/google-maps'

export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

export async function GET(
  req: Request,
  ctx: { params: Promise<{ tenantSlug: string }> },
) {
  const { tenantSlug } = await ctx.params

  const { data: tenant } = await supabase
    .from('tenants')
    .select('id, status')
    .eq('id', tenantSlug)
    .maybeSingle()
  if (!tenant || tenant.status === 'suspended') {
    return Response.json({ ok: false, error: 'tenant_not_found' }, { status: 404 })
  }

  const apiKey = process.env.GOOGLE_MAPS_API_KEY
  if (!apiKey) {
    return Response.json(
      { ok: false, error: 'GOOGLE_MAPS_API_KEY not set on the server' },
      { status: 503 },
    )
  }

  const url = new URL(req.url)
  const latRaw = url.searchParams.get('lat')
  const lngRaw = url.searchParams.get('lng')
  const lat = Number(latRaw)
  const lng = Number(lngRaw)
  if (!latRaw || !lngRaw || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    return Response.json({ ok: false, error: 'lat and lng are required' }, { status: 400 })
  }

  // Abuse guard: this route is public (tenant id is effectively public) and
  // proxies a paid Google Static Maps call, so constrain it to the only
  // region the product serves — Australia + near coastal margin. This kills
  // its value as a free global image proxy while passing every real lead.
  // (Residual risk noted in the multi-roof spec — a signed short-lived URL
  // is the longer-term fix.)
  const IN_AU = lat <= -9 && lat >= -45 && lng >= 110 && lng <= 155
  if (!IN_AU) {
    return Response.json(
      { ok: false, error: 'coordinate outside the serviced region' },
      { status: 422 },
    )
  }

  // Zoom 20 / 640×480 — MUST match the post-estimate static-map route so
  // the building-outline projection stays consistent across both pickers.
  let target: string
  try {
    target = buildStaticMapUrl(
      { center: { lat, lng }, zoom: 20, size: { width: 640, height: 480 } },
      { apiKey },
    )
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 400 },
    )
  }

  let res: Response
  try {
    res = await fetch(target, { method: 'GET' })
  } catch (e) {
    return Response.json(
      { ok: false, error: `Google Maps Static fetch failed: ${e instanceof Error ? e.message : String(e)}` },
      { status: 502 },
    )
  }
  if (!res.ok) {
    let body = ''
    try { body = (await res.text()).slice(0, 300) } catch { /* ignore */ }
    return Response.json(
      { ok: false, error: `Google Maps Static returned ${res.status}`, upstreamBody: body },
      { status: 502 },
    )
  }

  const ct = res.headers.get('content-type') ?? 'image/png'
  const arrayBuffer = await res.arrayBuffer()
  return new Response(arrayBuffer, {
    status: 200,
    headers: { 'Content-Type': ct, 'Cache-Control': 'public, max-age=86400, immutable' },
  })
}
