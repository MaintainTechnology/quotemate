// POST /api/dashboard/flyer/canva/designs/[id]/import
//   Pull the finished Canva design back into QuoteMax: export it (PNG and/or
//   PDF) via the Connect export API, store the artifacts in the flyer-assets
//   bucket, and record their paths on the canva_designs row. Body (optional):
//   { formats?: ('png'|'pdf')[] } — defaults to both.
// Auth: Authorization: Bearer <token>. Ownership-checked; requires a connection.

import { marketingSupabase as supabase, userFromBearer } from '@/lib/marketing/auth'
import { tenantBrandForUser } from '@/lib/flyer/tenant'
import { ownershipVerdict } from '@/lib/flyer/api-logic'
import { ImportCanvaBody, importFormats } from '@/lib/canva/api-logic'
import { getValidAccessToken } from '@/lib/canva/tokens'
import { exportDesign, downloadToBuffer } from '@/lib/canva/client'
import { FLYER_BUCKET, canvaAssetPath } from '@/lib/canva/storage'

export const dynamic = 'force-dynamic'

const CONTENT_TYPE: Record<'png' | 'pdf', string> = {
  png: 'image/png',
  pdf: 'application/pdf',
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const user = await userFromBearer(req)
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 })
  const tenant = await tenantBrandForUser(user.id)
  if (!tenant) return Response.json({ error: 'no_tenant' }, { status: 404 })

  let raw: unknown = {}
  try {
    raw = await req.json()
  } catch {
    raw = {}
  }
  const parsed = ImportCanvaBody.safeParse(raw ?? {})
  if (!parsed.success) {
    return Response.json({ error: 'invalid_request', details: parsed.error.flatten() }, { status: 400 })
  }

  const { data: row } = await supabase
    .from('canva_designs')
    .select('tenant_id, canva_design_id, png_path, pdf_path')
    .eq('id', id)
    .maybeSingle()
  const verdict = ownershipVerdict((row as { tenant_id: string } | null) ?? null, tenant.id)
  if (!verdict.ok) return Response.json({ error: verdict.error }, { status: verdict.status })

  const design = row as { canva_design_id: string; png_path: string | null; pdf_path: string | null }

  const accessToken = await getValidAccessToken(tenant.id)
  if (!accessToken) return Response.json({ error: 'not_connected' }, { status: 409 })

  const formats = importFormats(parsed.data)
  const paths: { png_path: string | null; pdf_path: string | null } = {
    png_path: design.png_path,
    pdf_path: design.pdf_path,
  }
  const errors: string[] = []

  for (const fmt of formats) {
    try {
      const job = await exportDesign(accessToken, design.canva_design_id, fmt)
      if (job.status !== 'success' || job.urls.length === 0) {
        errors.push(`${fmt}:${job.status}${job.error ? `:${job.error}` : ''}`)
        continue
      }
      const { buffer } = await downloadToBuffer(job.urls[0])
      const path = canvaAssetPath(tenant.id, id, fmt)
      const up = await supabase.storage
        .from(FLYER_BUCKET)
        .upload(path, buffer, { contentType: CONTENT_TYPE[fmt], upsert: true })
      if (up.error) {
        errors.push(`${fmt}:storage:${up.error.message}`)
        continue
      }
      if (fmt === 'png') paths.png_path = path
      else paths.pdf_path = path
    } catch (err) {
      errors.push(`${fmt}:${String(err)}`)
    }
  }

  const imported = (formats.includes('png') && paths.png_path) || (formats.includes('pdf') && paths.pdf_path)
  const status = imported ? 'imported' : 'failed'

  await supabase
    .from('canva_designs')
    .update({ png_path: paths.png_path, pdf_path: paths.pdf_path, status, updated_at: new Date().toISOString() })
    .eq('id', id)

  const publicUrl = (p: string | null): string | null =>
    p ? supabase.storage.from(FLYER_BUCKET).getPublicUrl(p).data.publicUrl : null

  if (!imported) {
    return Response.json({ ok: false, error: 'export_failed', errors }, { status: 502 })
  }
  return Response.json({
    ok: true,
    status,
    png_url: publicUrl(paths.png_path),
    pdf_url: publicUrl(paths.pdf_path),
    errors,
  })
}
