// Google Map Tiles (2D satellite) as a MapLibre raster source, served through
// OUR server proxy so the existing SERVER-side GOOGLE_MAPS_API_KEY powers the
// interactive maps (RoofMap, RoofLayoutMapFigure) and never reaches the browser:
//   GET /api/roofing/map-tiles/session          → { session } (server mints+caches)
//   GET /api/roofing/map-tiles/{z}/{x}/{y}?session=…  → the tile (server proxies)
//
// The session is cached in localStorage so we hit the session route at most once
// per fortnight per browser. Browser-only + best-effort: any failure (Map Tiles
// API not enabled on the key, no key, network) returns null so the caller keeps
// its free Esri basemap — the map never breaks when Map Tiles isn't available.

const SESSION_ROUTE = '/api/roofing/map-tiles/session'
const TILE_ROUTE = '/api/roofing/map-tiles'
const CACHE_KEY = 'qm.gmaps.tiles.session.v2'

export type TileSession = { session: string; expiry: number } // expiry = unix seconds

/** PURE — the MapLibre raster tile-URL template pointing at our proxy. The
 *  {z}/{x}/{y} placeholders stay literal in the path for MapLibre to fill. */
export function proxyTilesUrl(session: string): string {
  return `${TILE_ROUTE}/{z}/{x}/{y}?session=${encodeURIComponent(session)}`
}

/** PURE — valid slippy-tile coords for the proxy: z is ≤2 digits, x/y range
 *  0..2^Z-1 so up to 7 digits at max zoom (e.g. z19 → x=485204, 6 digits). Guards
 *  the proxy from forwarding arbitrary paths without 400ing legitimate tiles. */
export function isValidTileCoord(z: string, x: string, y: string): boolean {
  return /^\d{1,2}$/.test(z) && /^\d{1,7}$/.test(x) && /^\d{1,7}$/.test(y)
}

/** PURE — a cached session is usable when it exists and isn't within 5 min of
 *  expiry. `nowSec` is injected so this is deterministic + unit-testable. */
export function sessionUsable(s: TileSession | null | undefined, nowSec: number): boolean {
  return !!s && typeof s.session === 'string' && s.session.length > 0 && s.expiry - 300 > nowSec
}

function readCache(): TileSession | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const s = JSON.parse(raw) as TileSession
    return sessionUsable(s, Date.now() / 1000) ? s : null
  } catch {
    return null
  }
}

async function fetchSession(): Promise<TileSession | null> {
  const cached = readCache()
  if (cached) return cached
  const res = await fetch(SESSION_ROUTE)
  if (!res.ok) return null
  const b = (await res.json().catch(() => ({}))) as { ok?: boolean; session?: string; expiry?: number }
  if (!b.session) return null
  const s: TileSession = {
    session: b.session,
    expiry: Number.isFinite(b.expiry) ? Number(b.expiry) : Date.now() / 1000 + 3600,
  }
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(s))
  } catch {
    /* private mode / quota — session still works this render */
  }
  return s
}

/**
 * Resolve a MapLibre raster source for Google satellite 2D tiles (via our proxy),
 * or null when unavailable (Map Tiles API off / no key / not in a browser) so the
 * caller keeps its Esri basemap.
 */
export async function resolveGoogleSatelliteSource(): Promise<
  { tiles: string[]; attribution: string; maxzoom: number } | null
> {
  if (typeof window === 'undefined') return null
  let session: TileSession | null = null
  try {
    session = await fetchSession()
  } catch {
    session = null
  }
  if (!session) return null
  return {
    tiles: [proxyTilesUrl(session.session)],
    attribution: 'Imagery ©Google',
    maxzoom: 21,
  }
}
