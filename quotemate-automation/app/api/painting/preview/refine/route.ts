// POST /api/painting/preview/refine — conversational refinement of an
// already-generated paint preview (Jon's "paint the fence grey as well").
//
// Source is the CURRENT preview image (a data URL the client holds), not a
// fresh Street View fetch — so changes compound. Body:
//   { image: "data:image/...;base64,...", instruction: "paint the fence grey too" }
// → Gemini image-to-image applies ONLY that change → returns the new image.
//
// Auth: bearer token. Gemini takes ~10–20s → maxDuration raised.

import { createClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { buildRefinePrompt } from '@/lib/painting/repaint-prompt'
import { geminiProvider } from '@/lib/ig-engine/providers/gemini'

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

async function authed(req: Request): Promise<boolean> {
  const auth = req.headers.get('authorization') ?? ''
  if (!auth.toLowerCase().startsWith('bearer ')) return false
  const token = auth.slice(7).trim()
  if (!token) return false
  const { data, error } = await supabase.auth.getUser(token)
  return !error && !!data.user
}

/** Pull the mime + base64 out of a data URL. */
function parseDataUrl(s: string): { mime: string; base64: string } | null {
  const m = /^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/.exec(s)
  if (!m) return null
  return { mime: m[1], base64: m[2] }
}

export async function POST(req: Request) {
  if (!(await authed(req))) {
    return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }
  if (!process.env.GEMINI_API_KEY) {
    return Response.json({ ok: false, code: 'gemini_key_missing' }, { status: 200 })
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

  const renderImage = geminiProvider.renderImage
  if (!renderImage) {
    return Response.json({ ok: false, code: 'vision_unavailable' }, { status: 200 })
  }

  try {
    const prompt = buildRefinePrompt(parsed.data.instruction)
    const out = await renderImage({
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
