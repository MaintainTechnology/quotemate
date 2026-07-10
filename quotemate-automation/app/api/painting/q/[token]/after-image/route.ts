// GET /api/painting/q/[token]/after-image — public, share-token-gated AI
// "after repaint" preview for a saved painting measurement.
//
// Lazy + self-caching (mirrors /api/roofing/q/[token]/after-image): first
// request generates the Gemini image-to-image render FROM the Street View
// photo, stores it in the intake-photos bucket
// (painting_measurements.preview_image_path, migration 169) and streams
// it. Subsequent requests serve the cached image. If generation isn't
// possible (in-flight, failed, or the row is an unreleased draft — the
// billing gate) it falls back to streaming the plain Street View photo,
// so the <img> on /p/[token] always shows something.

import { createClient } from '@supabase/supabase-js'
import { generatePaintAfterImage, composePaintLocation } from '@/lib/painting/paint-after'
import {
  buildStreetViewMetadataUrl,
  buildStreetViewUrl,
  parseStreetViewMetadata,
} from '@/lib/painting/streetview'

export const dynamic = 'force-dynamic'
// Gemini image generation can take 10-20s; raise the default 10s limit.
export const maxDuration = 60

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

type LocRow = { address: string | null; postcode: string | null; state: string | null }

/** Stream the plain Street View photo — the graceful fallback. */
async function streetViewFallback(row: LocRow): Promise<Response> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY
  if (!apiKey) return Response.json({ ok: false, error: 'no_maps_key' }, { status: 503 })
  if (!row.address) return Response.json({ ok: false, error: 'no_location' }, { status: 400 })
  const location = composePaintLocation(row)
  try {
    const metaRes = await fetch(buildStreetViewMetadataUrl({ location }, { apiKey }))
    const meta = parseStreetViewMetadata(await metaRes.json().catch(() => null))
    if (!meta.ok) {
      return Response.json({ ok: false, code: 'no_streetview', status: meta.status }, { status: 404 })
    }
    const res = await fetch(buildStreetViewUrl({ location }, { apiKey }))
    if (!res.ok) return Response.json({ ok: false, error: `street view ${res.status}` }, { status: 502 })
    const ct = res.headers.get('content-type') ?? 'image/jpeg'
    return new Response(await res.arrayBuffer(), {
      status: 200,
      // Short cache — this is the fallback while the AI render finishes.
      headers: { 'Content-Type': ct, 'Cache-Control': 'public, max-age=60' },
    })
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 502 })
  }
}

async function streamStored(path: string): Promise<Response | null> {
  const { data, error } = await supabase.storage.from('intake-photos').download(path)
  if (error || !data) return null
  const buf = Buffer.from(await data.arrayBuffer())
  return new Response(buf, {
    status: 200,
    headers: {
      'Content-Type': data.type || 'image/png',
      'Cache-Control': 'public, max-age=86400, immutable',
    },
  })
}

export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params
  if (!token || token.length < 8) {
    return Response.json({ ok: false, error: 'bad_token' }, { status: 400 })
  }

  const { data: row } = await supabase
    .from('painting_measurements')
    .select('address, postcode, state, preview_image_path, preview_status, released_at')
    .eq('public_token', token)
    .maybeSingle()
  if (!row) return Response.json({ ok: false, error: 'not_found' }, { status: 404 })

  const loc: LocRow = {
    address: (row.address as string | null) ?? null,
    postcode: (row.postcode as string | null) ?? null,
    state: (row.state as string | null) ?? null,
  }

  // Already rendered → serve the cached image.
  if (row.preview_status === 'ready' && row.preview_image_path) {
    const stored = await streamStored(row.preview_image_path as string)
    if (stored) return stored
  }

  // Billing gate — only spend a Gemini render on a released quote (dashboard
  // saves are released at save time; held SMS/form drafts are not). Mirrors
  // roofing's confirmed_at gate: no billable render for anyone who merely
  // holds the share token of a draft.
  if (!row.released_at) return streetViewFallback(loc)

  // Generate on demand (CAS-guarded). On success, serve it; otherwise fall
  // back to the plain Street View so the page never shows a broken image.
  const gen = await generatePaintAfterImage(token)
  if (gen.ok) {
    const stored = await streamStored(gen.path)
    if (stored) return stored
  }
  return streetViewFallback(loc)
}
