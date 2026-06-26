// POST /api/dashboard/flyer/[id]/export
//   Persist the latest PNG (and optional PDF) the client rendered from the
//   Konva stage into the flyer-assets bucket, and record their paths on the
//   flyer row. Auth: Bearer token; ownership-checked.

import { marketingSupabase as supabase, userFromBearer } from '@/lib/marketing/auth'
import { tenantBrandForUser } from '@/lib/flyer/tenant'
import { ExportFlyerBody, ownershipVerdict } from '@/lib/flyer/api-logic'
import { FLYER_BUCKET, flyerAssetPath } from '@/lib/flyer/storage'

export const dynamic = 'force-dynamic'

function decodeDataUrl(dataUrl: string): { contentType: string; buffer: Buffer } | null {
  const m = /^data:([^;,]+)(;base64)?,([\s\S]*)$/.exec(dataUrl)
  if (!m) return null
  const contentType = m[1]
  const isBase64 = Boolean(m[2])
  const buffer = isBase64
    ? Buffer.from(m[3], 'base64')
    : Buffer.from(decodeURIComponent(m[3]), 'utf8')
  return { contentType, buffer }
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const user = await userFromBearer(req)
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 })
  const tenant = await tenantBrandForUser(user.id)
  if (!tenant) return Response.json({ error: 'no_tenant' }, { status: 404 })

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 })
  }
  const parsed = ExportFlyerBody.safeParse(raw)
  if (!parsed.success) {
    return Response.json({ error: 'invalid_request', details: parsed.error.flatten() }, { status: 400 })
  }

  const { data: flyer } = await supabase.from('flyers').select('tenant_id').eq('id', id).maybeSingle()
  const verdict = ownershipVerdict(flyer as { tenant_id: string } | null, tenant.id)
  if (!verdict.ok) return Response.json({ error: verdict.error }, { status: verdict.status })

  const png = decodeDataUrl(parsed.data.png)
  if (!png) return Response.json({ error: 'bad_png' }, { status: 400 })

  const pngPath = flyerAssetPath(tenant.id, id, 'png')
  const up1 = await supabase.storage
    .from(FLYER_BUCKET)
    .upload(pngPath, png.buffer, { contentType: 'image/png', upsert: true })
  if (up1.error) return Response.json({ error: up1.error.message }, { status: 500 })

  let pdfPath: string | null = null
  if (parsed.data.pdf) {
    const pdf = decodeDataUrl(parsed.data.pdf)
    if (pdf) {
      pdfPath = flyerAssetPath(tenant.id, id, 'pdf')
      const up2 = await supabase.storage
        .from(FLYER_BUCKET)
        .upload(pdfPath, pdf.buffer, { contentType: 'application/pdf', upsert: true })
      if (up2.error) return Response.json({ error: up2.error.message }, { status: 500 })
    }
  }

  await supabase
    .from('flyers')
    .update({ png_path: pngPath, pdf_path: pdfPath, updated_at: new Date().toISOString() })
    .eq('id', id)

  const pngUrl = supabase.storage.from(FLYER_BUCKET).getPublicUrl(pngPath).data.publicUrl
  const pdfUrl = pdfPath ? supabase.storage.from(FLYER_BUCKET).getPublicUrl(pdfPath).data.publicUrl : null
  return Response.json({ ok: true, png_path: pngPath, pdf_path: pdfPath, png_url: pngUrl, pdf_url: pdfUrl })
}
