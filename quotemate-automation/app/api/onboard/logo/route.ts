// POST /api/onboard/logo — tradie logo upload (multipart/form-data).
//
// Called from the onboarding wizard BEFORE activate, while the tenant row
// doesn't exist yet — so the object is keyed by the owner's auth user_id.
// Validates type + size server-side (never trusting the client check),
// sanitises SVGs, uploads to the public tenant-logos bucket, and returns the
// stable public URL + storage path the wizard then passes to /activate.

import { uploadTenantLogo, MAX_LOGO_BYTES, ALLOWED_LOGO_MIME } from '@/lib/storage/upload'

// node:crypto + the Supabase client need the Node.js runtime.
export const runtime = 'nodejs'

export async function POST(req: Request) {
  try {
    const form = await req.formData()
    const file = form.get('file')
    const ownerUserId = (form.get('owner_user_id') as string | null) ?? ''

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
      ownerKey: ownerUserId,
      data,
      contentType: mime,
    })

    return Response.json({ ok: true, path, publicUrl })
  } catch (err: any) {
    return Response.json(
      { ok: false, error: err?.message ?? 'Logo upload failed.' },
      { status: 400 },
    )
  }
}
