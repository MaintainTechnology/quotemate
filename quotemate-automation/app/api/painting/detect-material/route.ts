// POST /api/painting/detect-material — classify the exterior WALL MATERIAL
// from the Street View frontage (Gemini vision) and return the cost guidance.
//
// Body: { address, postcode?, state? }. Auth: bearer. The roof-down satellite
// view can't see walls, so we use the same Street View image the repaint
// preview uses. Best-effort: failures surface as { ok:false, code } @ 200.

import { createClient } from '@supabase/supabase-js'
import { z } from 'zod'
import {
  buildStreetViewMetadataUrl,
  buildStreetViewUrl,
  parseStreetViewMetadata,
} from '@/lib/painting/streetview'
import {
  buildMaterialDetectPrompt,
  materialGuidance,
  parseMaterialDetection,
  MATERIAL_DETECTION_SCHEMA,
} from '@/lib/painting/material'
import { geminiProvider } from '@/lib/ig-engine/providers/gemini'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

// Wall-substrate discrimination from one Street View frame is hard: at the
// route's fov=85 a set-back façade frames small, and gemini-2.5-flash cannot
// resolve the weatherboard/plank shadow-lines — it reads the smooth-looking
// wall as render at HIGH confidence (reproduced on 31 Greens Rd, Coorparoo).
// Tightening fov is a knife-edge (non-monotonic across houses) and the prompt
// has already over-corrected twice; 2.5-pro resolves the boards at the same
// framing and keeps genuine render as render. So default this one vision call
// to pro. GEMINI_VISION_MODEL still overrides (shared with the roofing route).
const VISION_MODEL = process.env.GEMINI_VISION_MODEL ?? 'gemini-2.5-pro'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

const BodySchema = z.object({
  address: z.string().min(3).max(300),
  postcode: z.string().max(12).optional(),
  state: z.string().max(8).optional(),
  year_built: z.number().int().min(1850).max(2100).optional().nullable(),
})

async function authed(req: Request): Promise<boolean> {
  const auth = req.headers.get('authorization') ?? ''
  if (!auth.toLowerCase().startsWith('bearer ')) return false
  const token = auth.slice(7).trim()
  if (!token) return false
  const { data, error } = await supabase.auth.getUser(token)
  return !error && !!data.user
}

export async function POST(req: Request) {
  if (!(await authed(req))) {
    return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }
  if (!process.env.GOOGLE_MAPS_API_KEY) {
    return Response.json({ ok: false, code: 'maps_key_missing' }, { status: 200 })
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
  const { address, postcode, state, year_built } = parsed.data
  const apiKey = process.env.GOOGLE_MAPS_API_KEY!
  const location = [address, postcode, state, 'Australia'].filter(Boolean).join(', ')

  try {
    // 1. Confirm Street View imagery, then fetch the frontage photo.
    const metaRes = await fetch(buildStreetViewMetadataUrl({ location }, { apiKey }))
    const meta = parseStreetViewMetadata(await metaRes.json().catch(() => null))
    if (!meta.ok) {
      return Response.json({ ok: false, code: 'no_streetview' }, { status: 200 })
    }
    const svRes = await fetch(buildStreetViewUrl({ location }, { apiKey }))
    if (!svRes.ok) {
      return Response.json({ ok: false, code: 'no_streetview' }, { status: 200 })
    }
    const mime = svRes.headers.get('content-type') ?? 'image/jpeg'
    const bytes = Buffer.from(await svRes.arrayBuffer())

    // 2. Gemini vision → material classification.
    const generateText = geminiProvider.generateText
    if (!generateText) {
      return Response.json({ ok: false, code: 'vision_unavailable' }, { status: 200 })
    }
    const text = await generateText({
      prompt: buildMaterialDetectPrompt(),
      images: [{ base64: bytes.toString('base64'), mime }],
      temperature: 0,
      model: VISION_MODEL,
      responseSchema: MATERIAL_DETECTION_SCHEMA,
    })
    const detection = parseMaterialDetection(text)
    if (!detection) {
      return Response.json({ ok: false, code: 'vision_unparsable' }, { status: 200 })
    }

    const guidance = materialGuidance(detection.material, {
      yearBuilt: year_built ?? null,
      confidence: detection.confidence,
    })

    return Response.json({ ok: true, detection, guidance }, { status: 200 })
  } catch (e) {
    return Response.json(
      { ok: false, code: 'detect_failed', detail: e instanceof Error ? e.message : String(e) },
      { status: 200 },
    )
  }
}
