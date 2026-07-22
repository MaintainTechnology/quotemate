// ════════════════════════════════════════════════════════════════════
// GET /api/q/roof/[token]/showcase — the CUSTOMER's view of their 3D house.
//
// Token = roofing_measurements.public_token (the customer-facing one), same
// trust model as the rest of /q: unguessable token as capability, no auth.
//
// Deliberately NOT the tradie route. /api/roofing/model3d/[token] is keyed on
// measure_token, returns tradie fields (task id, error text, anatomy overlays),
// and — importantly — its GET is not read-only: it polls Tripo and writes
// model3d_status, so a customer hitting it could drive paid third-party calls.
//
// This route is strictly read-only and returns only what a customer may see:
// a signed GLB, the two studio renders, and the quoted material. It never
// calls Tripo, never writes, and never starts a generation. No customer
// interaction on the thank-you page can spend money.
//
// Entitlement (paid AND scheduled) is decided by resolveShowcasePayload, which
// checks it BEFORE model readiness so an unpaid probe learns nothing.
// ════════════════════════════════════════════════════════════════════

import { createClient } from '@supabase/supabase-js'
import { resolveShowcasePayload } from '@/lib/roofing/showcase'
import { signedShowcaseAssets } from '@/lib/roofing/showcase-assets'

export const dynamic = 'force-dynamic'

function db() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ token: string }> },
) {
  const { token } = await ctx.params
  if (!token || token.length < 8) {
    return Response.json({ ok: false, error: 'bad_token' }, { status: 400 })
  }

  // Narrow select — the payload resolver's ShowcaseRow shape plus the address,
  // which keys the address-scoped studio-render cache. No tradie columns.
  const { data: row } = await db()
    .from('roofing_measurements')
    .select('address, quote, paid_at, scheduled_at, model3d_status, model3d_glb_path')
    .eq('public_token', token)
    .maybeSingle()

  if (!row) return Response.json({ ok: false, error: 'not_found' }, { status: 404 })

  const payload = resolveShowcasePayload(row)

  // Not entitled → 404, not 403. A 403 would confirm the token is real.
  if (payload.status === 'forbidden') {
    return Response.json({ ok: false, error: 'not_found' }, { status: 404 })
  }

  if (payload.status === 'unavailable') {
    return Response.json({
      ok: true,
      status: 'unavailable',
      modelUrl: null,
      images: { front: null, back: null },
      materialImages: {},
      material: payload.material,
    })
  }

  const assets = await signedShowcaseAssets({
    glbPath: payload.glbPath,
    address: (row.address as string | null) ?? null,
  })

  return Response.json({
    ok: true,
    status: 'ready',
    modelUrl: assets.modelUrl,
    images: assets.images,
    materialImages: assets.materialImages,
    material: payload.material,
  })
}
