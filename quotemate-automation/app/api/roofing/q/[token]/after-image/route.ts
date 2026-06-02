// GET /api/roofing/q/[token]/after-image — public, share-token-gated AI
// "after re-roof" preview for a saved roofing measurement.
//
// Lazy + self-caching: on the first request it generates the Gemini
// image-to-image render FROM the Google satellite aerial, stores it in the
// intake-photos bucket, and streams it. Subsequent requests serve the
// cached image. If generation isn't ready (in-flight or failed) it falls
// back to streaming the plain satellite, so the <img> on /q/roof/[token]
// always shows something.

import { createClient } from '@supabase/supabase-js'
import { buildStaticMapUrl } from '@/lib/roofing/google-maps'
import { generateRoofAfterImage } from '@/lib/roofing/roof-after'
import type { MultiRoofQuote } from '@/lib/roofing/types'

export const dynamic = 'force-dynamic'
// Gemini image generation can take 10-20s; raise the default 10s limit.
export const maxDuration = 60

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

type LngLat = [number, number]

function firstVertexOf(quote: unknown): LngLat | null {
  const structures = (quote as { structures?: unknown })?.structures
  if (!Array.isArray(structures)) return null
  for (const s of structures) {
    const v = (s as { metrics?: { polygon_geojson?: { coordinates?: number[][][] } } })
      ?.metrics?.polygon_geojson?.coordinates?.[0]?.[0]
    if (Array.isArray(v) && typeof v[0] === 'number' && typeof v[1] === 'number') {
      return [v[0], v[1]]
    }
  }
  return null
}

/** Stream the plain Google satellite — the graceful fallback. */
async function satelliteFallback(address: string | null, quote: MultiRoofQuote | null): Promise<Response> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY
  if (!apiKey) return Response.json({ ok: false, error: 'no_maps_key' }, { status: 503 })
  const vertex = firstVertexOf(quote)
  const center = vertex ? { lat: vertex[1], lng: vertex[0] } : undefined
  if (!address && !center) return Response.json({ ok: false, error: 'no_location' }, { status: 400 })
  try {
    const target = buildStaticMapUrl(
      { address: center ? undefined : address ?? undefined, center, zoom: 20, size: { width: 640, height: 480 } },
      { apiKey },
    )
    const res = await fetch(target)
    if (!res.ok) return Response.json({ ok: false, error: `satellite ${res.status}` }, { status: 502 })
    const ct = res.headers.get('content-type') ?? 'image/png'
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
    .from('roofing_measurements')
    .select('address, quote, preview_image_path, preview_status, confirmed_at')
    .eq('public_token', token)
    .maybeSingle()
  if (!row) return Response.json({ ok: false, error: 'not_found' }, { status: 404 })

  const address = (row.address as string | null) ?? null
  const quote = (row.quote ?? null) as MultiRoofQuote | null

  // Already rendered → serve the cached image.
  if (row.preview_status === 'ready' && row.preview_image_path) {
    const stored = await streamStored(row.preview_image_path as string)
    if (stored) return stored
  }

  // Only spend a Gemini render once the customer has confirmed (the page
  // only shows this image post-confirm anyway). Pre-confirm, serve the
  // plain satellite — this avoids a billable render being triggered by
  // anyone who merely holds the share token.
  if (!row.confirmed_at) return satelliteFallback(address, quote)

  // Generate on demand (CAS-guarded). On success, serve it; otherwise fall
  // back to the plain satellite so the page never shows a broken image.
  const gen = await generateRoofAfterImage(token)
  if (gen.ok) {
    const stored = await streamStored(gen.path)
    if (stored) return stored
  }
  return satelliteFallback(address, quote)
}
