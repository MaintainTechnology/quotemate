// POST /api/painting/preview — generates an AI "after repaint" image.
//
// Flow (mirrors lib/roofing/roof-after.ts, but stateless — painting
// estimates aren't persisted, so the image is returned inline rather than
// stored): Street View photo of the house → base64 → image-to-image edit
// with a "repaint ONLY the exterior in <colour>" prompt → return the
// edited image as a data URL.
//
// The provider is selected by ig-engine/providers/edit-select.ts — Gemini
// first, then Hugging Face (FLUX.1-Kontext), then Replicate. Override with
// PAINTING_IMAGE_PROVIDER.
//
// Auth: bearer token. Body: { address, postcode?, state?, colour?, scopes? }.
// The render takes ~10–20s, so maxDuration is raised (needs Vercel Pro /
// Railway; Hobby's 10s will time out).

import { createClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { resolveIdentityRequest } from '@/lib/tenant/from-request'
import {
  buildStreetViewMetadataUrl,
  buildStreetViewUrl,
  parseStreetViewMetadata,
} from '@/lib/painting/streetview'
import { buildRepaintPrompt } from '@/lib/painting/repaint-prompt'
import { resolveEditImageProvider } from '@/lib/ig-engine/providers/edit-select'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

const BodySchema = z.object({
  address: z.string().min(3).max(300),
  postcode: z.string().max(12).optional(),
  state: z.string().max(8).optional(),
  colour: z.string().max(80).optional(),
  scopes: z.array(z.enum(['walls', 'ceilings', 'trim', 'exterior'])).optional(),
})

export async function POST(req: Request) {
  // Dual-auth gate: Clerk session token OR legacy Supabase token.
  const identity = await resolveIdentityRequest(supabase, req)
  if (!identity) {
    return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }
  if (!process.env.GOOGLE_MAPS_API_KEY) {
    return Response.json({ ok: false, code: 'maps_key_missing' }, { status: 200 })
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

  const { address, postcode, state, colour, scopes } = parsed.data
  const apiKey = process.env.GOOGLE_MAPS_API_KEY!
  const location = [address, postcode, state, 'Australia'].filter(Boolean).join(', ')

  try {
    // 1. Confirm Street View imagery exists, then fetch the front-of-house photo.
    const metaRes = await fetch(buildStreetViewMetadataUrl({ location }, { apiKey }))
    const meta = parseStreetViewMetadata(await metaRes.json().catch(() => null))
    if (!meta.ok) {
      return Response.json({ ok: false, code: 'no_streetview', detail: 'No Street View imagery for this address.' }, { status: 200 })
    }
    const svRes = await fetch(buildStreetViewUrl({ location }, { apiKey }))
    if (!svRes.ok) {
      return Response.json({ ok: false, code: 'no_streetview', detail: `Street View HTTP ${svRes.status}` }, { status: 200 })
    }
    const srcMime = svRes.headers.get('content-type') ?? 'image/jpeg'
    const srcBytes = Buffer.from(await svRes.arrayBuffer())

    // 2. Repaint via the selected image-edit provider (image-to-image).
    const prompt = buildRepaintPrompt({
      colour: colour ?? '',
      scopes: scopes ?? ['exterior'],
    })
    const out = await provider.renderImage({
      system: prompt.system,
      user: prompt.user,
      sourceImage: { base64: srcBytes.toString('base64'), mime: srcMime },
      aspectRatio: '4:3',
    })

    return Response.json(
      {
        ok: true,
        before: `data:${srcMime};base64,${srcBytes.toString('base64')}`,
        after: `data:${out.mime};base64,${out.base64}`,
        imagery_date: meta.ok ? meta.date : null,
      },
      { status: 200 },
    )
  } catch (e) {
    return Response.json(
      { ok: false, code: 'generation_failed', detail: e instanceof Error ? e.message : String(e) },
      { status: 200 },
    )
  }
}
