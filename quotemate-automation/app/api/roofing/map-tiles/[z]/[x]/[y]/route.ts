// GET /api/roofing/map-tiles/{z}/{x}/{y}?session=… — proxy one Google Map Tiles
// 2D satellite tile using the SERVER-side GOOGLE_MAPS_API_KEY, so MapLibre can
// render Google imagery without the key touching the browser. The client gets a
// session from /api/roofing/map-tiles/session, then MapLibre fills {z}/{x}/{y}
// and requests each tile here.
//
// Tiles are immutable content-addressed by (z,x,y,session) → long edge cache, so
// after the first fetch the CDN serves them and this function is rarely hit.

import { isValidTileCoord } from '@/lib/roofing/google-tiles'

export const dynamic = 'force-dynamic'

const TILE_BASE = 'https://tile.googleapis.com/v1/2dtiles'

function tilesKey(): string | undefined {
  return process.env.GOOGLE_MAP_TILES_KEY ?? process.env.GOOGLE_MAPS_API_KEY
}

export async function GET(
  req: Request,
  ctx: { params: Promise<{ z: string; x: string; y: string }> },
) {
  const { z, x, y } = await ctx.params
  if (!isValidTileCoord(z, x, y)) {
    return new Response('bad_tile', { status: 400 })
  }
  const session = new URL(req.url).searchParams.get('session')
  if (!session || session.length < 4) {
    return new Response('no_session', { status: 400 })
  }
  const key = tilesKey()
  if (!key) {
    return new Response('no_key', { status: 503 })
  }

  const url =
    `${TILE_BASE}/${z}/${x}/${y}` +
    `?session=${encodeURIComponent(session)}&key=${encodeURIComponent(key)}`

  let res: Response
  try {
    res = await fetch(url)
  } catch (e) {
    return new Response(`tile_fetch_failed: ${e instanceof Error ? e.message : String(e)}`, {
      status: 502,
    })
  }
  if (!res.ok) {
    return new Response(`tile_upstream_${res.status}`, { status: 502 })
  }

  const buf = await res.arrayBuffer()
  return new Response(buf, {
    status: 200,
    headers: {
      'Content-Type': res.headers.get('content-type') ?? 'image/jpeg',
      'Cache-Control': 'public, max-age=86400, immutable',
    },
  })
}
