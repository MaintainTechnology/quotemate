// POST /api/tenant/logo — authenticated logo change for an existing tenant.
//
// The dashboard Account tab calls this to replace the tradie's logo. Auth is the
// same Bearer-token pattern as /api/tenant/me. We upload to the public
// tenant-logos bucket (keyed by tenant id now that the tenant exists), then write
// logo_url + logo_path onto the tenants row — so every customer quote letterhead
// (which renders tenants.logo_url live at /q/[token]) immediately shows the new
// logo, on existing quotes as well as future ones.

import { createClient } from '@supabase/supabase-js'
import { uploadTenantLogo, MAX_LOGO_BYTES, ALLOWED_LOGO_MIME } from '@/lib/storage/upload'

// node:crypto + the Supabase client need the Node.js runtime.
export const runtime = 'nodejs'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

async function userFromBearer(req: Request) {
  const auth = req.headers.get('authorization') ?? ''
  if (!auth.toLowerCase().startsWith('bearer ')) return null
  const token = auth.slice(7).trim()
  if (!token) return null
  const { data, error } = await supabase.auth.getUser(token)
  if (error || !data.user) return null
  return data.user
}

export async function POST(req: Request) {
  const user = await userFromBearer(req)
  if (!user) {
    return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  // Resolve the signed-in user's tenant. The logo is scoped/written to THIS
  // tenant only — a user can never change another tenant's branding.
  const { data: tenant, error: tErr } = await supabase
    .from('tenants')
    .select('id')
    .eq('owner_user_id', user.id)
    .maybeSingle()
  if (tErr) {
    return Response.json({ ok: false, error: tErr.message }, { status: 500 })
  }
  if (!tenant) {
    return Response.json({ ok: false, error: 'no_tenant' }, { status: 404 })
  }

  try {
    const form = await req.formData()
    const file = form.get('file')
    if (!(file instanceof File)) {
      return Response.json({ ok: false, error: 'No logo file provided.' }, { status: 400 })
    }

    const mime = (file.type || '').split(';')[0].trim().toLowerCase()
    if (!(ALLOWED_LOGO_MIME as readonly string[]).includes(mime)) {
      return Response.json(
        { ok: false, error: 'Logo must be a PNG, JPG, WEBP, or SVG image.' },
        { status: 400 },
      )
    }
    if (file.size > MAX_LOGO_BYTES) {
      return Response.json(
        { ok: false, error: 'Logo must be 2 MB or smaller.' },
        { status: 400 },
      )
    }

    const data = await file.arrayBuffer()
    const { path, publicUrl } = await uploadTenantLogo({
      ownerKey: tenant.id as string,
      data,
      contentType: mime,
    })

    const { error: upErr } = await supabase
      .from('tenants')
      .update({ logo_url: publicUrl, logo_path: path })
      .eq('id', tenant.id)
    if (upErr) {
      return Response.json({ ok: false, error: upErr.message }, { status: 500 })
    }

    return Response.json({ ok: true, publicUrl, path })
  } catch (err: any) {
    return Response.json(
      { ok: false, error: err?.message ?? 'Logo upload failed.' },
      { status: 400 },
    )
  }
}
