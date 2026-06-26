// POST /api/dashboard/flyer/upload (multipart)
//   Validate and store a tradie-uploaded image in the flyer-assets bucket,
//   return a public URL the editor can place on the canvas.
// Auth: Bearer token; tenant-scoped storage path.

import { randomUUID } from 'node:crypto'
import { marketingSupabase as supabase, userFromBearer } from '@/lib/marketing/auth'
import { tenantBrandForUser } from '@/lib/flyer/tenant'
import { validateFlyerImage } from '@/lib/flyer/upload'
import { FLYER_BUCKET, flyerUploadPath } from '@/lib/flyer/storage'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const user = await userFromBearer(req)
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 })
  const tenant = await tenantBrandForUser(user.id)
  if (!tenant) return Response.json({ error: 'no_tenant' }, { status: 404 })

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return Response.json({ error: 'invalid_form' }, { status: 400 })
  }
  const file = form.get('file')
  if (!(file instanceof File)) return Response.json({ error: 'no_file' }, { status: 400 })

  const verdict = validateFlyerImage({ mime: file.type, size: file.size })
  if (!verdict.ok) return Response.json({ error: verdict.error, message: verdict.message }, { status: 400 })

  const path = flyerUploadPath(tenant.id, randomUUID(), verdict.ext)
  const buffer = Buffer.from(await file.arrayBuffer())
  const up = await supabase.storage
    .from(FLYER_BUCKET)
    .upload(path, buffer, { contentType: file.type, upsert: false })
  if (up.error) return Response.json({ error: up.error.message }, { status: 500 })

  const url = supabase.storage.from(FLYER_BUCKET).getPublicUrl(path).data.publicUrl
  return Response.json({ ok: true, url, path })
}
