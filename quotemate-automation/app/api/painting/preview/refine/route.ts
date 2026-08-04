// POST /api/painting/preview/refine — conversational refinement of an
// already-generated paint preview (Jon's "paint the fence grey as well").
//
// Source is the CURRENT preview image (a data URL the client holds), not a
// fresh Street View fetch — so changes compound. Body:
//   { image: "data:image/...;base64,...", instruction: "paint the fence grey too" }
// → image-to-image applies ONLY that change → returns the new image.
//
// Provider: ig-engine/providers/edit-select.ts — Gemini first, then Hugging
// Face (FLUX.1-Kontext), then Replicate. Override with PAINTING_IMAGE_PROVIDER.
//
// Auth: bearer token. The render takes ~10–20s → maxDuration raised.

import { createClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { resolveIdentityRequest } from '@/lib/tenant/from-request'
import { buildRefinePrompt } from '@/lib/painting/repaint-prompt'
import { resolveEditImageProvider } from '@/lib/ig-engine/providers/edit-select'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

// ~9 MB of base64 ≈ 6.7 MB image — generous for a 640² preview.
const MAX_IMAGE_CHARS = 9_000_000

const BodySchema = z.object({
  image: z.string().min(32).max(MAX_IMAGE_CHARS),
  instruction: z.string().trim().min(2).max(300),
})

/** Pull the mime + base64 out of a data URL. */
function parseDataUrl(s: string): { mime: string; base64: string } | null {
  const m = /^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/.exec(s)
  if (!m) return null
  return { mime: m[1], base64: m[2] }
}

export async function POST(req: Request) {
  // Dual-auth gate: Clerk session token OR legacy Supabase token.
  const identity = await resolveIdentityRequest(supabase, req)
  if (!identity) {
    return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }
  const provider = resolveEditImageProvider(process.env.PAINTING_IMAGE_PROVIDER)
  if (!provider) {
    return Response.json({ ok: false, code: 'image_provider_missing' }, { status: 200 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return Response.json({ ok: false, error: 'invalid_json' }, { status: 400 })
  }
  const parsed = BodySchema.safeParse(body)
  if (!parsed.success) {
    return Response.json({ ok: false, error: 'invalid_request', issues: parsed.error.issues }, { status: 400 })
  }

  const src = parseDataUrl(parsed.data.image)
  if (!src) {
    return Response.json({ ok: false, code: 'bad_image', detail: 'image must be a data:image/...;base64 URL' }, { status: 400 })
  }

  try {
    const prompt = buildRefinePrompt(parsed.data.instruction)
    const out = await provider.renderImage({
      system: prompt.system,
      user: prompt.user,
      sourceImage: { base64: src.base64, mime: src.mime },
      aspectRatio: '4:3',
    })
    return Response.json({ ok: true, after: `data:${out.mime};base64,${out.base64}` }, { status: 200 })
  } catch (e) {
    return Response.json(
      { ok: false, code: 'refine_failed', detail: e instanceof Error ? e.message : String(e) },
      { status: 200 },
    )
  }
}
