// Shared handler for the two authenticated tenant brand-image uploads:
//
//   POST /api/tenant/logo   → tenants.logo_url  / logo_path   (mig 141)
//   POST /api/tenant/photo  → tenants.photo_url / photo_path  (mig 180)
//
// Both are the same operation on the same public bucket — validate the
// multipart file, store it, then write the URL + path onto THIS tenant's row.
// Kept in one place so the auth boundary and the validation rules can never
// drift between them (a photo route that forgot resolveTenantRequest would let
// any signed-in user rewrite another tenant's branding).

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  uploadTenantLogo,
  MAX_LOGO_BYTES,
  ALLOWED_LOGO_MIME,
  type TenantImageKind,
} from '@/lib/storage/upload'
import { resolveTenantRequest } from '@/lib/tenant/from-request'

const NOUN: Record<TenantImageKind, string> = { logo: 'logo', photo: 'photo' }

export async function handleTenantImageUpload(
  supabase: SupabaseClient,
  req: Request,
  kind: TenantImageKind,
): Promise<Response> {
  const noun = NOUN[kind]

  // Dual-auth: Clerk session token (→ clerk_user_id) OR legacy Supabase token
  // (→ owner_user_id). The image is scoped/written to THIS tenant only — a user
  // can never change another tenant's branding.
  const resolved = await resolveTenantRequest(supabase, req, 'id')
  if (!resolved) {
    return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }
  const tenant = resolved.tenant as { id: string } | null
  if (!tenant) {
    return Response.json({ ok: false, error: 'no_tenant' }, { status: 404 })
  }

  try {
    const form = await req.formData()
    const file = form.get('file')
    if (!(file instanceof File)) {
      return Response.json({ ok: false, error: `No ${noun} file provided.` }, { status: 400 })
    }

    const mime = (file.type || '').split(';')[0].trim().toLowerCase()
    if (!(ALLOWED_LOGO_MIME as readonly string[]).includes(mime)) {
      return Response.json(
        { ok: false, error: `Your ${noun} must be a PNG, JPG, WEBP, or SVG image.` },
        { status: 400 },
      )
    }
    if (file.size > MAX_LOGO_BYTES) {
      return Response.json(
        { ok: false, error: `Your ${noun} must be 2 MB or smaller.` },
        { status: 400 },
      )
    }

    const data = await file.arrayBuffer()
    const { path, publicUrl } = await uploadTenantLogo({
      ownerKey: tenant.id,
      data,
      contentType: mime,
      kind,
    })

    // Column names follow the kind: logo_url/logo_path, photo_url/photo_path.
    const { error: upErr } = await supabase
      .from('tenants')
      .update({ [`${kind}_url`]: publicUrl, [`${kind}_path`]: path })
      .eq('id', tenant.id)
    if (upErr) {
      return Response.json({ ok: false, error: upErr.message }, { status: 500 })
    }

    return Response.json({ ok: true, publicUrl, path })
  } catch (err) {
    return Response.json(
      { ok: false, error: err instanceof Error ? err.message : `${noun} upload failed.` },
      { status: 400 },
    )
  }
}
