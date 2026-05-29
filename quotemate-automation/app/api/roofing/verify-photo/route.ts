// POST /api/roofing/verify-photo
//
// Takes the customer-uploaded photo + the address and (optionally) a
// Google Maps satellite snapshot of that address, sends them to Claude
// vision, and returns a structured verdict { match, reason, material,
// material_confidence, red_flags }.
//
// The dashboard uses this for two things:
//   1. "Is this the right building?" → shows the verdict next to the
//      uploaded photo so the tradie can decide whether to trust the
//      measurement.
//   2. Material auto-fill — when material_confidence is high, the
//      dashboard auto-selects the material in the dropdown.

import { createClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { buildStaticMapUrl } from '@/lib/roofing/google-maps'
import { verifyAndClassify } from '@/lib/roofing/vision-verify'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

const RequestSchema = z.object({
  /** Storage path of the uploaded photo in the intake-photos bucket. */
  photoPath: z.string().min(3),
  /** Address text — fed into the Claude prompt + used to render the
   *  Google Maps reference. */
  address: z.string().min(3),
})

async function userIdFromBearer(req: Request): Promise<string | null> {
  const auth = req.headers.get('authorization') ?? ''
  if (!auth.toLowerCase().startsWith('bearer ')) return null
  const token = auth.slice(7).trim()
  if (!token) return null
  const { data, error } = await supabase.auth.getUser(token)
  if (error || !data.user) return null
  return data.user.id
}

export async function POST(req: Request) {
  const userId = await userIdFromBearer(req)
  if (!userId) {
    return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return Response.json({ ok: false, error: 'invalid_json' }, { status: 400 })
  }
  const parsed = RequestSchema.safeParse(body)
  if (!parsed.success) {
    return Response.json(
      { ok: false, error: 'invalid_request', issues: parsed.error.issues },
      { status: 400 },
    )
  }
  const { photoPath, address } = parsed.data

  // 1. Fetch the customer photo bytes from Supabase storage.
  const { data: photoBlob, error: dlErr } = await supabase.storage
    .from('intake-photos')
    .download(photoPath)
  if (dlErr || !photoBlob) {
    return Response.json(
      { ok: false, error: `photo_unreadable: ${dlErr?.message ?? 'no blob'}` },
      { status: 400 },
    )
  }
  const customerPhotoBuf = Buffer.from(await photoBlob.arrayBuffer())
  const customerPhoto = {
    base64: customerPhotoBuf.toString('base64'),
    mime: photoBlob.type || 'image/jpeg',
  }

  // 2. (Best-effort) fetch a Google Maps Static reference image for the
  //    address. When the key isn't set we skip this and only do the
  //    material classification.
  let referenceImage: { base64: string; mime: string } | undefined
  const gmapsKey = process.env.GOOGLE_MAPS_API_KEY
  if (gmapsKey) {
    try {
      const url = buildStaticMapUrl(
        { address, zoom: 19, size: { width: 640, height: 480 } },
        { apiKey: gmapsKey },
      )
      const r = await fetch(url)
      if (r.ok) {
        const buf = Buffer.from(await r.arrayBuffer())
        referenceImage = {
          base64: buf.toString('base64'),
          mime: r.headers.get('content-type') || 'image/png',
        }
      }
    } catch {
      // Non-fatal — the verifier falls back to single-image mode.
    }
  }

  // 3. Run Claude vision.
  const verdict = await verifyAndClassify({
    customerPhoto,
    referenceImage,
    address,
  })

  return Response.json({ ok: true, verdict, hadReference: !!referenceImage }, { status: 200 })
}
