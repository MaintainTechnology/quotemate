// POST /api/tenant/job-quote/photos — the OPTIONAL photo field on the tradie
// dashboard's EV charger job form (spec specs/ev-charger-location-photo.md R2).
//
// Auth is a TENANT BEARER, not an unguessable token. Its public siblings
// (/api/quote-request/[token]/photos, /api/upload/[token]) are capability-based
// because a customer holds a one-off link; this is a dashboard surface reached
// by a signed-in tradie, so it uses the same resolveTenantRequest path the rest
// of /api/tenant/* uses. A token model here would be an open upload endpoint.
//
// Photos land in the PRIVATE intake-photos bucket through the shared
// uploadIntakePhoto helper, so they arrive exactly where every other intake
// photo lives — which is what makes intakes.photo_paths, the vision pass, the
// EV estimate document's Images section and the Gemini render all work with no
// new plumbing.
//
// Uploaded on pick, then the returned paths ride along in the job-quote JSON
// submit (R3). The intake row does not exist yet at upload time, so the objects
// are keyed by a caller-supplied draft id; an abandoned form leaves unreferenced
// objects in the bucket, which is accepted (spec edge case).

import { createClient } from '@supabase/supabase-js'
import { randomBytes } from 'node:crypto'
import { resolveTenantRequest } from '@/lib/tenant/from-request'
import { uploadIntakePhoto } from '@/lib/storage/upload'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

/** Spec R1: at most 3 photos, 8 MB each, JPEG/PNG/WebP. */
export const MAX_FILES = 3
export const MAX_BYTES = 8 * 1024 * 1024
export const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp'])

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
)

export async function POST(req: Request) {
  // Dual-auth (Clerk or legacy Supabase); null covers missing token, invalid
  // token and authed-but-no-tenant alike.
  const resolved = await resolveTenantRequest(supabase, req, 'id')
  const tenant = (resolved?.tenant ?? null) as { id: string } | null
  if (!tenant) return Response.json({ ok: false, error: 'unauthorised' }, { status: 401 })

  let formData: FormData
  try {
    formData = await req.formData()
  } catch {
    return Response.json({ ok: false, error: 'invalid_form' }, { status: 400 })
  }

  const photos = formData.getAll('photos').filter((v): v is File => v instanceof File)
  if (photos.length === 0) {
    return Response.json({ ok: false, error: 'no_photos' }, { status: 400 })
  }
  if (photos.length > MAX_FILES) {
    return Response.json({ ok: false, error: `max_${MAX_FILES}_photos` }, { status: 400 })
  }
  // Validated server-side: the client's accept= and length check are a
  // convenience, never the gate.
  for (const f of photos) {
    if (f.size > MAX_BYTES) {
      return Response.json({ ok: false, error: 'photo_over_8mb' }, { status: 400 })
    }
    if (!ALLOWED_MIME.has(f.type)) {
      return Response.json({ ok: false, error: 'unsupported_image_type' }, { status: 400 })
    }
  }

  // The intake does not exist yet, so group this batch under a draft id. Scoped
  // by tenant so one tradie's drafts can never collide with another's.
  const draftId = `jobquote-${tenant.id}-${randomBytes(8).toString('hex')}`

  const urls: string[] = []
  const paths: string[] = []
  for (let i = 0; i < photos.length; i++) {
    const f = photos[i]
    try {
      const buf = Buffer.from(await f.arrayBuffer())
      const { path, signedUrl } = await uploadIntakePhoto({
        callId: draftId,
        data: buf,
        contentType: f.type,
        index: i,
      })
      paths.push(path)
      urls.push(signedUrl)
    } catch (e) {
      // Partial success is fine — the form never blocks on photos (R1), so
      // return what landed rather than failing the whole batch.
      console.error('[tenant/job-quote/photos] upload failed', {
        tenantId: tenant.id,
        index: i,
        error: e instanceof Error ? e.message : String(e),
      })
    }
  }

  if (paths.length === 0) {
    return Response.json({ ok: false, error: 'upload_failed' }, { status: 502 })
  }
  return Response.json({ ok: true, count: paths.length, paths, urls })
}
