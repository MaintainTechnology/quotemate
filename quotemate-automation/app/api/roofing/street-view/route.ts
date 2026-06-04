// GET /api/roofing/street-view — server-side proxy for Google Street View
// Static API images (Tier-2 display layer on /dashboard/roofing/measure).
//
//   • Keeps GOOGLE_MAPS_API_KEY off the browser.
//   • Checks the free METADATA endpoint first; if no panorama exists at the
//     address it returns 404 (so the client shows a clean "no street imagery
//     here" fallback instead of Google's grey placeholder — and we don't
//     bill for an image of nothing).
//
// Inputs (query-params):
//   address     — string  (optional if lat+lng supplied)
//   lat / lng   — number  (optional if address supplied)
//   heading     — number  (optional; omit → camera points at the building)
//   fov / pitch — number  (optional)
//   w / h       — pixels  (optional, max 640)
//
// Auth: bearer token from the dashboard (same pattern as static-map).

import { createClient } from '@supabase/supabase-js'
import {
  buildStreetViewMetadataUrl,
  buildStreetViewUrl,
  parseMetadataStatus,
  redactKey,
  type StreetViewInput,
} from '@/lib/roofing/street-view'

export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

async function userIdFromBearer(req: Request): Promise<string | null> {
  const auth = req.headers.get('authorization') ?? ''
  if (!auth.toLowerCase().startsWith('bearer ')) return null
  const token = auth.slice(7).trim()
  if (!token) return null
  const { data, error } = await supabase.auth.getUser(token)
  if (error || !data.user) return null
  return data.user.id
}

export async function GET(req: Request) {
  const userId = await userIdFromBearer(req)
  if (!userId) {
    return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  const apiKey = process.env.GOOGLE_MAPS_API_KEY
  if (!apiKey) {
    return Response.json(
      { ok: false, error: 'GOOGLE_MAPS_API_KEY not set on the server' },
      { status: 503 },
    )
  }

  const url = new URL(req.url)
  const address = url.searchParams.get('address') ?? undefined
  const latRaw = url.searchParams.get('lat')
  const lngRaw = url.searchParams.get('lng')
  const location =
    latRaw && lngRaw && Number.isFinite(Number(latRaw)) && Number.isFinite(Number(lngRaw))
      ? { lat: Number(latRaw), lng: Number(lngRaw) }
      : undefined

  if (!address && !location) {
    return Response.json({ ok: false, error: 'address or lat+lng is required' }, { status: 400 })
  }

  const numParam = (k: string) => {
    const v = url.searchParams.get(k)
    return v != null && Number.isFinite(Number(v)) ? Number(v) : undefined
  }
  const w = numParam('w')
  const h = numParam('h')
  const input: StreetViewInput = {
    address,
    location,
    heading: numParam('heading'),
    fov: numParam('fov'),
    pitch: numParam('pitch'),
    size: w && h ? { width: w, height: h } : undefined,
  }

  // 1. Metadata pre-check (free). Avoids billing + the grey placeholder.
  try {
    const metaUrl = buildStreetViewMetadataUrl(input, { apiKey })
    const metaRes = await fetch(metaUrl, { method: 'GET' })
    if (metaRes.ok) {
      const status = parseMetadataStatus(await metaRes.json())
      if (status !== 'OK') {
        return Response.json(
          { ok: false, code: 'no_imagery', status },
          { status: 404 },
        )
      }
    }
    // If metadata itself errors, fall through and try the image — the image
    // endpoint will surface the real problem (key/billing).
  } catch {
    /* metadata best-effort */
  }

  // 2. Fetch + stream the image.
  let target: string
  try {
    target = buildStreetViewUrl(input, { apiKey })
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 400 })
  }

  let res: Response
  try {
    res = await fetch(target, { method: 'GET' })
  } catch (e) {
    return Response.json(
      { ok: false, error: `Street View fetch failed: ${e instanceof Error ? e.message : String(e)}` },
      { status: 502 },
    )
  }
  if (!res.ok) {
    // With return_error_code=true, a missing pano yields 404; key/billing
    // problems yield 403. Surface the reason (without the key).
    let body = ''
    try {
      body = (await res.text()).slice(0, 400)
    } catch {
      /* ignore */
    }
    if (res.status === 404) {
      return Response.json({ ok: false, code: 'no_imagery', status: 'ZERO_RESULTS' }, { status: 404 })
    }
    return Response.json(
      {
        ok: false,
        error: `Street View returned ${res.status}`,
        upstreamBody: body,
        requestUrl: redactKey(target),
        hint:
          res.status === 403
            ? "Google 403: enable the 'Street View Static API' on the project, attach billing, and ensure the key allows server-to-server calls (no referer/IP block)."
            : 'Check Google Cloud Console for the project status.',
      },
      { status: 502 },
    )
  }

  const ct = res.headers.get('content-type') ?? 'image/jpeg'
  const arrayBuffer = await res.arrayBuffer()
  return new Response(arrayBuffer, {
    status: 200,
    headers: {
      'Content-Type': ct,
      'Cache-Control': 'public, max-age=86400, immutable',
    },
  })
}
