// GET /api/roofing/map-tiles/session — mint (and cache) a Google Map Tiles 2D
// satellite SESSION token using the SERVER-side GOOGLE_MAPS_API_KEY, so the
// interactive MapLibre maps (RoofMap, RoofLayoutMapFigure) can fetch tiles
// through our proxy without the key ever reaching the browser.
//
// Google Map Tiles 2D flow: POST createSession {mapType:'satellite'} → a session
// token (~2 wk TTL) that the tile endpoint requires. We cache it module-level so
// every map load shares ONE session (→ identical, CDN-cacheable tile URLs) and
// we mint at most once per instance per fortnight.
//
// PREREQUISITE: the key's Google Cloud project must have the **Map Tiles API**
// enabled (separate from Static Maps / Street View / Solar). Not enabled → 502
// here → the client falls back to free Esri imagery (nothing breaks).
//
// Unauthed (the customer /q layout map has no session). Imagery only — low value;
// a best-effort same-origin check deters casual off-site use. ponytail: add IP
// rate-limiting if the proxy ever shows up as an abuse vector.

export const dynamic = 'force-dynamic'

const CREATE_SESSION = 'https://tile.googleapis.com/v1/createSession'

let cached: { session: string; expiry: number } | null = null

function tilesKey(): string | undefined {
  return process.env.GOOGLE_MAP_TILES_KEY ?? process.env.GOOGLE_MAPS_API_KEY
}

/** Best-effort same-origin gate: block only when an Origin/Referer IS present and
 *  from a different host (missing header → allow, so privacy-stripped clients and
 *  same-origin fetches both work). Not a hard security boundary. */
function crossOrigin(req: Request): boolean {
  const host = req.headers.get('host')
  if (!host) return false
  const ref = req.headers.get('origin') ?? req.headers.get('referer')
  if (!ref) return false
  try {
    return new URL(ref).host !== host
  } catch {
    return false
  }
}

export async function GET(req: Request) {
  if (crossOrigin(req)) {
    return Response.json({ ok: false, error: 'cross_origin' }, { status: 403 })
  }
  const key = tilesKey()
  if (!key) {
    return Response.json({ ok: false, error: 'no_key' }, { status: 503 })
  }

  const now = Date.now() / 1000
  if (cached && cached.expiry - 300 > now) {
    return Response.json(
      { ok: true, session: cached.session, expiry: cached.expiry },
      { headers: { 'Cache-Control': 'private, max-age=300' } },
    )
  }

  let res: Response
  try {
    res = await fetch(`${CREATE_SESSION}?key=${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mapType: 'satellite', language: 'en-AU', region: 'AU' }),
    })
  } catch (e) {
    return Response.json(
      { ok: false, error: `createSession fetch failed: ${e instanceof Error ? e.message : String(e)}` },
      { status: 502 },
    )
  }
  if (!res.ok) {
    let body = ''
    try { body = (await res.text()).slice(0, 300) } catch { /* ignore */ }
    return Response.json(
      {
        ok: false,
        error: `createSession ${res.status}`,
        hint:
          res.status === 403
            ? 'Enable the Map Tiles API on this key’s Google Cloud project (separate from Static Maps / Street View / Solar), and ensure billing is on.'
            : undefined,
        upstream: body,
      },
      { status: 502 },
    )
  }

  const b = (await res.json().catch(() => ({}))) as { session?: string; expiry?: string }
  if (!b.session) {
    return Response.json({ ok: false, error: 'no_session_in_response' }, { status: 502 })
  }
  const expiry = Number(b.expiry)
  cached = { session: b.session, expiry: Number.isFinite(expiry) ? expiry : now + 3600 }
  return Response.json(
    { ok: true, session: cached.session, expiry: cached.expiry },
    { headers: { 'Cache-Control': 'private, max-age=300' } },
  )
}
