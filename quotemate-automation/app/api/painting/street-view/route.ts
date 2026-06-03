// GET /api/painting/street-view — streams a Google Street View photo of the
// front of a house (the "before" image for the paint preview), server-side
// so the GOOGLE_MAPS_API_KEY is never exposed to the browser.
//
// Auth: same bearer-token pattern as the other painting routes. Query:
//   ?address=...&postcode=...&state=...   (postcode/state optional)
// Returns the image bytes on success, or { ok:false, code } JSON when there
// is no Street View imagery for the address.

import { createClient } from '@supabase/supabase-js'
import {
  buildStreetViewMetadataUrl,
  buildStreetViewUrl,
  parseStreetViewMetadata,
} from '@/lib/painting/streetview'

export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

async function authed(req: Request): Promise<boolean> {
  const auth = req.headers.get('authorization') ?? ''
  if (!auth.toLowerCase().startsWith('bearer ')) return false
  const token = auth.slice(7).trim()
  if (!token) return false
  const { data, error } = await supabase.auth.getUser(token)
  return !error && !!data.user
}

function composeLocation(url: URL): string {
  const address = (url.searchParams.get('address') ?? '').trim()
  const postcode = (url.searchParams.get('postcode') ?? '').trim()
  const state = (url.searchParams.get('state') ?? '').trim()
  return [address, postcode, state, 'Australia'].filter(Boolean).join(', ')
}

export async function GET(req: Request) {
  if (!(await authed(req))) {
    return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }
  const apiKey = process.env.GOOGLE_MAPS_API_KEY
  if (!apiKey) {
    return Response.json({ ok: false, code: 'maps_key_missing' }, { status: 200 })
  }

  const url = new URL(req.url)
  const location = composeLocation(url)
  if (location.replace(/, Australia$/, '').trim().length < 3) {
    return Response.json({ ok: false, code: 'no_address' }, { status: 400 })
  }

  // Cheap metadata check first — avoids charging for a "no imagery" tile.
  try {
    const metaRes = await fetch(buildStreetViewMetadataUrl({ location }, { apiKey }))
    const meta = parseStreetViewMetadata(await metaRes.json().catch(() => null))
    if (!meta.ok) {
      return Response.json({ ok: false, code: 'no_streetview', status: meta.status }, { status: 404 })
    }
  } catch (e) {
    return Response.json(
      { ok: false, code: 'provider_error', detail: e instanceof Error ? e.message : String(e) },
      { status: 200 },
    )
  }

  const imgUrl = buildStreetViewUrl({ location }, { apiKey })
  const res = await fetch(imgUrl)
  if (!res.ok) {
    return Response.json({ ok: false, code: 'no_streetview', status: res.status }, { status: 404 })
  }
  const contentType = res.headers.get('content-type') ?? 'image/jpeg'
  const bytes = await res.arrayBuffer()
  return new Response(bytes, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'private, max-age=86400',
    },
  })
}
