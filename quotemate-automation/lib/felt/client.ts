// ════════════════════════════════════════════════════════════════════
// Felt — REST v2 client (Solar Felt tab spec 2026-06-13 §4.2).
//
// SERVER-ONLY. felt.com/api/v2 with a Bearer workspace token read from
// FELT_API_KEY (never sent to the browser — every Felt call goes
// through this module from API routes / after() steps).
//
// Felt is a GIS visualization platform, not a solar calculator: this
// client only provisions the interactive map deliverable. It computes
// nothing about irradiance or pricing — the deterministic engine
// remains the source of every number (repo grounding rule).
//
// Contract (house style, mirrors lib/pylon/client.ts):
//   • every function returns a result object and NEVER throws —
//     Felt unreachable means the estimate flow is bit-identical.
//   • control calls 5 s timeout; uploads 30 s; size caps on buffers.
//   • Phase 0 verified live 2026-06-13 (7/7): map create (satellite,
//     view_only), 2-step presigned upload, processing poll, FSL
//     numeric style, tokenless view_only embed, GeoTIFF raster,
//     delete. Embed URL shape: https://felt.com/embed/map/{id}
// ════════════════════════════════════════════════════════════════════

const FELT_BASE_URL = 'https://felt.com/api/v2'
const CONTROL_TIMEOUT_MS = 5_000
const UPLOAD_TIMEOUT_MS = 30_000
/** Per-buffer upload cap (annual flux + DSM rasters are ~1–10 MB). */
const MAX_UPLOAD_BYTES = 30 * 1024 * 1024

/** PURE — the tab gate. Enabled only when FELT_TAB_ENABLED is
 *  'true'/'1' AND a key exists. Callers pass process.env values. */
export function feltTabEnabled(env: {
  FELT_TAB_ENABLED?: string
  FELT_API_KEY?: string
  [key: string]: string | undefined
}): boolean {
  const on = env.FELT_TAB_ENABLED === 'true' || env.FELT_TAB_ENABLED === '1'
  return on && typeof env.FELT_API_KEY === 'string' && env.FELT_API_KEY.length > 0
}

/** PURE — the public, tokenless embed URL for an unlisted view_only map. */
export function feltEmbedUrl(mapId: string): string {
  return `https://felt.com/embed/map/${mapId}`
}

export type FeltResult<T> =
  | { ok: true; data: T }
  | {
      ok: false
      code: 'disabled' | 'http_error' | 'network_error' | 'invalid_response' | 'too_large'
      detail: string
    }

export type FeltClientOpts = {
  apiKey?: string
  baseUrl?: string
  fetchImpl?: typeof fetch
  timeoutMs?: number
}

async function feltRequest(
  path: string,
  init: RequestInit,
  opts: FeltClientOpts,
  timeoutMs: number,
): Promise<FeltResult<unknown>> {
  const apiKey = opts.apiKey ?? process.env.FELT_API_KEY
  if (!apiKey) {
    return { ok: false, code: 'disabled', detail: 'FELT_API_KEY is not set.' }
  }
  const base = (opts.baseUrl ?? FELT_BASE_URL).replace(/\/$/, '')
  const doFetch = opts.fetchImpl ?? fetch
  let res: Response
  try {
    res = await doFetch(base + path, {
      ...init,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/json',
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...(init.headers ?? {}),
      },
      signal: AbortSignal.timeout(opts.timeoutMs ?? timeoutMs),
    })
  } catch (e) {
    return { ok: false, code: 'network_error', detail: e instanceof Error ? e.message : String(e) }
  }
  if (!res.ok) {
    let body = ''
    try {
      body = (await res.text()).slice(0, 300)
    } catch {
      /* ignore */
    }
    return { ok: false, code: 'http_error', detail: `Felt returned ${res.status}: ${body}` }
  }
  if (res.status === 204) return { ok: true, data: null }
  try {
    return { ok: true, data: await res.json() }
  } catch (e) {
    return { ok: false, code: 'invalid_response', detail: e instanceof Error ? e.message : String(e) }
  }
}

// ── Maps ──────────────────────────────────────────────────────────────

export type FeltMap = {
  id: string
  url: string | null
  thumbnail_url: string | null
}

function parseMap(data: unknown): FeltMap | null {
  if (!data || typeof data !== 'object') return null
  const m = data as Record<string, unknown>
  if (typeof m.id !== 'string' || m.id.length === 0) return null
  return {
    id: m.id,
    url: typeof m.url === 'string' ? m.url : null,
    thumbnail_url: typeof m.thumbnail_url === 'string' ? m.thumbnail_url : null,
  }
}

/** POST /maps — one map per estimate (satellite basemap, unlisted view_only). */
export async function createFeltMap(
  args: {
    title: string
    lat: number
    lon: number
    zoom?: number
    basemap?: string
    publicAccess?: 'private' | 'view_only' | 'view_and_comment' | 'view_comment_and_edit'
  },
  opts: FeltClientOpts = {},
): Promise<FeltResult<FeltMap>> {
  const res = await feltRequest(
    '/maps',
    {
      method: 'POST',
      body: JSON.stringify({
        title: args.title,
        lat: args.lat,
        lon: args.lon,
        zoom: args.zoom ?? 20,
        basemap: args.basemap ?? 'satellite',
        public_access: args.publicAccess ?? 'view_only',
      }),
    },
    opts,
    CONTROL_TIMEOUT_MS,
  )
  if (!res.ok) return res
  const map = parseMap(res.data)
  if (!map) return { ok: false, code: 'invalid_response', detail: 'Map response missing id.' }
  return { ok: true, data: map }
}

/** DELETE /maps/{id} — cleanup on re-draft / estimate deletion. */
export async function deleteFeltMap(
  mapId: string,
  opts: FeltClientOpts = {},
): Promise<FeltResult<null>> {
  const res = await feltRequest(`/maps/${mapId}`, { method: 'DELETE' }, opts, CONTROL_TIMEOUT_MS)
  if (!res.ok) return res
  return { ok: true, data: null }
}

// ── Layer uploads (two-step S3 presigned) ────────────────────────────

export type FeltLayerStatus = 'uploading' | 'processing' | 'failed' | 'completed' | 'unknown'

export type FeltUploadedLayer = { layerId: string }

/**
 * Upload an in-memory file buffer as a new layer: request the presigned
 * S3 form from Felt, then POST the bytes to S3. Used for both the panel
 * GeoJSON and the flux/DSM GeoTIFF rasters (Phase 0 verified).
 */
export async function uploadFeltLayerBuffer(
  args: {
    mapId: string
    layerName: string
    fileName: string
    bytes: Uint8Array
    contentType: string
  },
  opts: FeltClientOpts = {},
): Promise<FeltResult<FeltUploadedLayer>> {
  if (args.bytes.byteLength === 0) {
    return { ok: false, code: 'too_large', detail: 'Empty upload buffer.' }
  }
  if (args.bytes.byteLength > MAX_UPLOAD_BYTES) {
    return {
      ok: false,
      code: 'too_large',
      detail: `Upload buffer ${args.bytes.byteLength} bytes exceeds cap ${MAX_UPLOAD_BYTES}.`,
    }
  }

  // Step 1 — presigned upload request.
  const presign = await feltRequest(
    `/maps/${args.mapId}/upload`,
    { method: 'POST', body: JSON.stringify({ name: args.layerName }) },
    opts,
    CONTROL_TIMEOUT_MS,
  )
  if (!presign.ok) return presign
  const p = (presign.data ?? {}) as Record<string, unknown>
  const url = typeof p.url === 'string' ? p.url : null
  const attrs =
    p.presigned_attributes && typeof p.presigned_attributes === 'object'
      ? (p.presigned_attributes as Record<string, string>)
      : null
  const layerId = typeof p.layer_id === 'string' ? p.layer_id : null
  if (!url || !attrs || !layerId) {
    return { ok: false, code: 'invalid_response', detail: 'Presigned upload response incomplete.' }
  }

  // Step 2 — S3 form upload (file field must come last).
  const form = new FormData()
  for (const [k, v] of Object.entries(attrs)) form.append(k, v)
  form.append(
    'file',
    new Blob([args.bytes as BlobPart], { type: args.contentType }),
    args.fileName,
  )
  const doFetch = opts.fetchImpl ?? fetch
  try {
    const up = await doFetch(url, {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(opts.timeoutMs ?? UPLOAD_TIMEOUT_MS),
    })
    if (!up.ok && up.status !== 204) {
      return { ok: false, code: 'http_error', detail: `S3 upload returned ${up.status}.` }
    }
  } catch (e) {
    return { ok: false, code: 'network_error', detail: e instanceof Error ? e.message : String(e) }
  }
  return { ok: true, data: { layerId } }
}

/** Convenience — serialize a GeoJSON FeatureCollection and upload it. */
export async function uploadFeltGeoJson(
  args: { mapId: string; layerName: string; fileName: string; geojson: unknown },
  opts: FeltClientOpts = {},
): Promise<FeltResult<FeltUploadedLayer>> {
  return uploadFeltLayerBuffer(
    {
      mapId: args.mapId,
      layerName: args.layerName,
      fileName: args.fileName,
      bytes: new TextEncoder().encode(JSON.stringify(args.geojson)),
      contentType: 'application/geo+json',
    },
    opts,
  )
}

/** GET /maps/{id}/layers/{layerId} — processing status poll. */
export async function getFeltLayerStatus(
  args: { mapId: string; layerId: string },
  opts: FeltClientOpts = {},
): Promise<FeltResult<{ status: FeltLayerStatus; progress: number | null }>> {
  const res = await feltRequest(
    `/maps/${args.mapId}/layers/${args.layerId}`,
    { method: 'GET' },
    opts,
    CONTROL_TIMEOUT_MS,
  )
  if (!res.ok) return res
  const l = (res.data ?? {}) as Record<string, unknown>
  const status: FeltLayerStatus =
    l.status === 'uploading' ||
    l.status === 'processing' ||
    l.status === 'failed' ||
    l.status === 'completed'
      ? l.status
      : 'unknown'
  return {
    ok: true,
    data: { status, progress: typeof l.progress === 'number' ? l.progress : null },
  }
}

/** POST /maps/{id}/layers/{layerId}/update_style — apply an FSL style. */
export async function updateFeltLayerStyle(
  args: { mapId: string; layerId: string; style: Record<string, unknown> },
  opts: FeltClientOpts = {},
): Promise<FeltResult<null>> {
  const res = await feltRequest(
    `/maps/${args.mapId}/layers/${args.layerId}/update_style`,
    { method: 'POST', body: JSON.stringify({ style: args.style }) },
    opts,
    CONTROL_TIMEOUT_MS,
  )
  if (!res.ok) return res
  return { ok: true, data: null }
}

// ── Elements (annotations) ────────────────────────────────────────────

/**
 * POST /maps/{id}/elements — drop the property pin. Felt's elements API
 * accepts a GeoJSON FeatureCollection of annotation features.
 */
export async function createFeltElements(
  args: { mapId: string; featureCollection: unknown },
  opts: FeltClientOpts = {},
): Promise<FeltResult<null>> {
  const res = await feltRequest(
    `/maps/${args.mapId}/elements`,
    { method: 'POST', body: JSON.stringify(args.featureCollection) },
    opts,
    CONTROL_TIMEOUT_MS,
  )
  if (!res.ok) return res
  return { ok: true, data: null }
}

export const __test_only__ = { MAX_UPLOAD_BYTES, CONTROL_TIMEOUT_MS, UPLOAD_TIMEOUT_MS }
