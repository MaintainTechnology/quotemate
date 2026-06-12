// ════════════════════════════════════════════════════════════════════
// Solar — Felt map provisioning (Felt tab spec 2026-06-13 §4.5).
//
// Runs in the estimate/redraft route's after() for quote_variant='felt'
// rows: creates the per-estimate Felt map (satellite basemap, unlisted
// view_only), uploads the panel-layout + plane-marker GeoJSON layers and
// the annual-flux + DSM GeoTIFF rasters (raw bytes re-downloaded from
// the short-lived dataLayers URLs), styles each layer with FSL, drops
// the property pin, and persists the provisioning record on the row's
// `felt` jsonb column.
//
// Contract (same as sun-assets):
//   • BEST-EFFORT — any failure persists a degraded felt record
//     ('failed'/'partial'); the estimate itself is already valid.
//     Never throws.
//   • Felt computes nothing — every number on the map echoes the
//     deterministic engine's persisted output (grounding rule).
//   • Re-draft: the previous map is deleted and a fresh one provisioned
//     (panel layout/sizing may have changed).
// ════════════════════════════════════════════════════════════════════

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  createFeltMap,
  deleteFeltMap,
  uploadFeltGeoJson,
  uploadFeltLayerBuffer,
  updateFeltLayerStyle,
  getFeltLayerStatus,
  createFeltElements,
  feltTabEnabled,
  feltEmbedUrl,
  type FeltClientOpts,
} from '../felt/client'
import {
  buildPanelLayoutGeoJson,
  buildPlaneMarkersGeoJson,
  buildPropertyPinGeoJson,
  panelLayoutFsl,
  planeMarkersFsl,
  fluxRasterFsl,
  dsmHillshadeFsl,
  feltMapTitle,
  headlinePanelCount,
} from './felt-map'
import { fetchSolarDataLayersWithUrls } from './data-layers'
import { withApiKey } from './sun-assets'
import type { LatLng, SolarEstimate } from './types'

const RASTER_DOWNLOAD_CAP = 30 * 1024 * 1024
const RASTER_TIMEOUT_MS = 20_000

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

export type SolarFeltLayerKey = 'panels' | 'planes' | 'flux' | 'dsm'

export type SolarFeltLayerState = {
  id: string | null
  status: 'completed' | 'processing' | 'failed' | 'skipped'
}

export type SolarFeltRecord = {
  map_id: string | null
  map_url: string | null
  embed_url: string | null
  thumbnail_url: string | null
  status: 'provisioning' | 'ready' | 'partial' | 'failed'
  layers: Record<SolarFeltLayerKey, SolarFeltLayerState>
  error: string | null
  provisioned_at: string | null
}

export type SolarFeltProvisionOpts = {
  /** Felt client opts (apiKey, fetchImpl, baseUrl) — injectable for tests. */
  feltOpts?: FeltClientOpts
  /** Google Solar key for the dataLayers raster re-download. */
  googleApiKey?: string
  /** Fetch used for the raster downloads + dataLayers call. */
  fetchImpl?: FetchLike
  /** dataLayers base URL override (tests). */
  dataLayersBaseUrl?: string
  /** Processing-poll budget. Defaults: 10 polls × 5000 ms. */
  pollAttempts?: number
  pollIntervalMs?: number
  /** Bypass the env gate (tests). */
  forceEnabled?: boolean
}

const SKIPPED: SolarFeltLayerState = { id: null, status: 'skipped' }

/** PURE — overall status from the per-layer states. 'ready' when every
 *  attempted layer completed (skipped layers don't count against it);
 *  'partial' when some completed or some are still processing (the lazy
 *  repair pass finishes those later); 'failed' only when nothing was
 *  attempted or every attempted layer failed outright. */
export function deriveFeltStatus(
  layers: Record<SolarFeltLayerKey, SolarFeltLayerState>,
): 'ready' | 'partial' | 'failed' {
  const attempted = Object.values(layers).filter((l) => l.status !== 'skipped')
  if (attempted.length === 0) return 'failed'
  const completed = attempted.filter((l) => l.status === 'completed').length
  const processing = attempted.filter((l) => l.status === 'processing').length
  if (completed === attempted.length) return 'ready'
  if (completed > 0 || processing > 0) return 'partial'
  return 'failed'
}

/** PURE — assemble the felt jsonb record. Exported for tests. */
export function buildFeltRecord(args: {
  mapId: string | null
  mapUrl: string | null
  thumbnailUrl: string | null
  status: SolarFeltRecord['status']
  layers?: Partial<Record<SolarFeltLayerKey, SolarFeltLayerState>>
  error?: string | null
  provisionedAt?: string | null
}): SolarFeltRecord {
  return {
    map_id: args.mapId,
    map_url: args.mapUrl,
    embed_url: args.mapId ? feltEmbedUrl(args.mapId) : null,
    thumbnail_url: args.thumbnailUrl,
    status: args.status,
    layers: {
      panels: args.layers?.panels ?? SKIPPED,
      planes: args.layers?.planes ?? SKIPPED,
      flux: args.layers?.flux ?? SKIPPED,
      dsm: args.layers?.dsm ?? SKIPPED,
    },
    error: args.error ?? null,
    provisioned_at: args.provisionedAt ?? null,
  }
}

/**
 * Provision (or re-provision) the Felt map for one quote_variant='felt'
 * estimate and persist the provisioning record on the row's felt jsonb.
 * Best-effort; never throws.
 */
export async function applySolarFeltMap(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any>,
  args: { publicToken: string; location: LatLng | null },
  opts: SolarFeltProvisionOpts = {},
): Promise<void> {
  try {
    if (!opts.forceEnabled && !feltTabEnabled(process.env)) return

    // ── Row lookup. Only felt-variant rows get a map. ─────────────────
    const { data: row } = await supabase
      .from('solar_estimates')
      .select('id, estimate, address, state, postcode, quote_variant, felt')
      .eq('public_token', args.publicToken)
      .maybeSingle()
    if (!row?.id || !row.estimate) return
    if (row.quote_variant !== 'felt') return

    const estimate = row.estimate as SolarEstimate
    const persistFelt = async (felt: SolarFeltRecord) => {
      await supabase.from('solar_estimates').update({ felt }).eq('id', row.id)
    }

    // ── Re-draft hygiene: delete the previous map before re-provisioning.
    const previous = row.felt as SolarFeltRecord | null
    if (previous?.map_id) {
      await deleteFeltMap(previous.map_id, opts.feltOpts) // best-effort
    }

    // ── Create the map. ───────────────────────────────────────────────
    const location = args.location ?? estimate.context.location ?? null
    if (!location) {
      await persistFelt(
        buildFeltRecord({
          mapId: null,
          mapUrl: null,
          thumbnailUrl: null,
          status: 'failed',
          error: 'No location on the estimate — cannot centre a map.',
        }),
      )
      return
    }

    const headlineTier = estimate.price.tiers[estimate.price.tiers.length - 1] ?? null
    const created = await createFeltMap(
      {
        title: feltMapTitle({
          state: (row.state as string | null) ?? estimate.context.state ?? null,
          postcode: (row.postcode as string | null) ?? estimate.context.postcode ?? null,
          systemKw: headlineTier?.system_kw_dc ?? null,
        }),
        lat: location.lat,
        lon: location.lng,
        zoom: 20,
        basemap: 'satellite',
        publicAccess: 'view_only',
      },
      opts.feltOpts,
    )
    if (!created.ok) {
      await persistFelt(
        buildFeltRecord({
          mapId: null,
          mapUrl: null,
          thumbnailUrl: null,
          status: 'failed',
          error: `Map create failed (${created.code}): ${created.detail}`,
        }),
      )
      return
    }
    const map = created.data

    // Persist the provisioning state immediately so the dashboard can
    // show "Map building…" while layers process.
    await persistFelt(
      buildFeltRecord({
        mapId: map.id,
        mapUrl: map.url,
        thumbnailUrl: map.thumbnail_url,
        status: 'provisioning',
      }),
    )

    // ── Vector layers (panel layout + plane markers). ─────────────────
    const layers: Record<SolarFeltLayerKey, SolarFeltLayerState> = {
      panels: { ...SKIPPED },
      planes: { ...SKIPPED },
      flux: { ...SKIPPED },
      dsm: { ...SKIPPED },
    }
    const styles: Partial<Record<SolarFeltLayerKey, Record<string, unknown>>> = {}

    const panelGeoJson = buildPanelLayoutGeoJson(
      estimate.roof,
      headlinePanelCount(estimate) ?? undefined,
    )
    if (panelGeoJson) {
      const up = await uploadFeltGeoJson(
        { mapId: map.id, layerName: 'Proposed panels', fileName: 'panels.geojson', geojson: panelGeoJson },
        opts.feltOpts,
      )
      layers.panels = up.ok ? { id: up.data.layerId, status: 'processing' } : { id: null, status: 'failed' }
      if (up.ok) styles.panels = panelLayoutFsl()
    }

    const planeGeoJson = buildPlaneMarkersGeoJson(estimate.roof)
    if (planeGeoJson) {
      const up = await uploadFeltGeoJson(
        { mapId: map.id, layerName: 'Roof planes — sun score', fileName: 'planes.geojson', geojson: planeGeoJson },
        opts.feltOpts,
      )
      layers.planes = up.ok ? { id: up.data.layerId, status: 'processing' } : { id: null, status: 'failed' }
      if (up.ok) styles.planes = planeMarkersFsl()
    }

    // ── Raster layers (annual flux heat map + DSM hillshade). ─────────
    // Google path only; the dataLayers URLs are short-lived so we
    // re-fetch them fresh and download the raw GeoTIFF bytes (no decode).
    if (estimate.coverage_source === 'google') {
      const googleKey =
        opts.googleApiKey ??
        process.env.GOOGLE_SOLAR_API_KEY ??
        process.env.GOOGLE_MAPS_API_KEY
      if (googleKey) {
        const fetchImpl: FetchLike = opts.fetchImpl ?? ((u, init) => fetch(u, init))
        const { summary, urls } = await fetchSolarDataLayersWithUrls(location, {
          apiKey: googleKey,
          fetchImpl,
          baseUrl: opts.dataLayersBaseUrl,
        })
        if (summary.status === 'available' && urls) {
          const [fluxBytes, dsmBytes] = await Promise.all([
            downloadRawBytes(urls.annual_flux, googleKey, fetchImpl),
            downloadRawBytes(urls.dsm, googleKey, fetchImpl),
          ])
          if (fluxBytes) {
            const up = await uploadFeltLayerBuffer(
              {
                mapId: map.id,
                layerName: 'Sun exposure (annual)',
                fileName: 'annual-flux.tif',
                bytes: fluxBytes,
                contentType: 'image/tiff',
              },
              opts.feltOpts,
            )
            layers.flux = up.ok ? { id: up.data.layerId, status: 'processing' } : { id: null, status: 'failed' }
            if (up.ok) {
              const sun = estimate.context.sun ?? null
              styles.flux = fluxRasterFsl(sun?.min_flux ?? null, sun?.max_flux ?? null)
            }
          }
          if (dsmBytes) {
            const up = await uploadFeltLayerBuffer(
              {
                mapId: map.id,
                layerName: 'Roof elevation',
                fileName: 'dsm.tif',
                bytes: dsmBytes,
                contentType: 'image/tiff',
              },
              opts.feltOpts,
            )
            layers.dsm = up.ok ? { id: up.data.layerId, status: 'processing' } : { id: null, status: 'failed' }
            if (up.ok) styles.dsm = dsmHillshadeFsl()
          }
        }
      }
    }

    // ── Property pin (best-effort annotation). ────────────────────────
    await createFeltElements(
      {
        mapId: map.id,
        featureCollection: buildPropertyPinGeoJson(
          location,
          (row.address as string | null) ?? null,
        ),
      },
      opts.feltOpts,
    )

    // ── Poll processing + apply FSL as layers complete. ───────────────
    const attempts = opts.pollAttempts ?? 10
    const interval = opts.pollIntervalMs ?? 5_000
    for (let i = 0; i < attempts; i++) {
      const pending = (Object.keys(layers) as SolarFeltLayerKey[]).filter(
        (k) => layers[k].status === 'processing' && layers[k].id,
      )
      if (pending.length === 0) break
      if (i > 0) await sleep(interval)
      for (const key of pending) {
        const status = await getFeltLayerStatus(
          { mapId: map.id, layerId: layers[key].id! },
          opts.feltOpts,
        )
        if (!status.ok) continue
        if (status.data.status === 'completed') {
          const style = styles[key]
          if (style) {
            await updateFeltLayerStyle(
              { mapId: map.id, layerId: layers[key].id!, style },
              opts.feltOpts,
            )
          }
          layers[key] = { ...layers[key], status: 'completed' }
        } else if (status.data.status === 'failed') {
          layers[key] = { ...layers[key], status: 'failed' }
        }
      }
    }

    // ── Persist the final record. Layers still 'processing' at budget
    //    exhaustion stay recorded as such → 'partial' (lazy repair on
    //    next page open can style them later).
    await persistFelt(
      buildFeltRecord({
        mapId: map.id,
        mapUrl: map.url,
        thumbnailUrl: map.thumbnail_url,
        status: deriveFeltStatus(layers),
        layers,
        provisionedAt: new Date().toISOString(),
      }),
    )
  } catch (e) {
    console.error(
      '[solar/felt-provision] provisioning failed:',
      e instanceof Error ? e.message : String(e),
    )
  }
}

/**
 * Lazy repair pass (§4.5.6) — for a 'partial'/'provisioning' record,
 * re-poll the unfinished layers and apply their styles when processing
 * has since completed. Cheap status polls only; no re-uploads. Returns
 * the refreshed record (or null when nothing changed / not applicable).
 */
export async function repairSolarFeltLayers(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any>,
  args: { publicToken: string },
  opts: SolarFeltProvisionOpts = {},
): Promise<SolarFeltRecord | null> {
  try {
    if (!opts.forceEnabled && !feltTabEnabled(process.env)) return null
    const { data: row } = await supabase
      .from('solar_estimates')
      .select('id, felt, estimate')
      .eq('public_token', args.publicToken)
      .maybeSingle()
    if (!row?.id) return null
    const felt = row.felt as SolarFeltRecord | null
    if (!felt?.map_id) return null
    if (felt.status !== 'partial' && felt.status !== 'provisioning') return null

    const estimate = (row.estimate as SolarEstimate | null) ?? null
    const sun = estimate?.context.sun ?? null
    const styleFor: Record<SolarFeltLayerKey, Record<string, unknown>> = {
      panels: panelLayoutFsl(),
      planes: planeMarkersFsl(),
      flux: fluxRasterFsl(sun?.min_flux ?? null, sun?.max_flux ?? null),
      dsm: dsmHillshadeFsl(),
    }

    let changed = false
    const layers = { ...felt.layers }
    for (const key of Object.keys(layers) as SolarFeltLayerKey[]) {
      const layer = layers[key]
      if (layer.status !== 'processing' || !layer.id) continue
      const status = await getFeltLayerStatus(
        { mapId: felt.map_id, layerId: layer.id },
        opts.feltOpts,
      )
      if (!status.ok) continue
      if (status.data.status === 'completed') {
        await updateFeltLayerStyle(
          { mapId: felt.map_id, layerId: layer.id, style: styleFor[key] },
          opts.feltOpts,
        )
        layers[key] = { ...layer, status: 'completed' }
        changed = true
      } else if (status.data.status === 'failed') {
        layers[key] = { ...layer, status: 'failed' }
        changed = true
      }
    }
    if (!changed) return null

    const next: SolarFeltRecord = { ...felt, layers, status: deriveFeltStatus(layers) }
    await supabase.from('solar_estimates').update({ felt: next }).eq('id', row.id)
    return next
  } catch (e) {
    console.error(
      '[solar/felt-provision] repair failed:',
      e instanceof Error ? e.message : String(e),
    )
    return null
  }
}

// ── helpers ──────────────────────────────────────────────────────────

/** Download one GeoTIFF's RAW bytes (no decode); null on any failure. */
async function downloadRawBytes(
  url: string | null,
  apiKey: string,
  fetchImpl: FetchLike,
): Promise<Uint8Array | null> {
  if (!url) return null
  try {
    const res = await fetchImpl(withApiKey(url, apiKey), {
      signal: AbortSignal.timeout(RASTER_TIMEOUT_MS),
    })
    if (!res.ok) return null
    const buf = await res.arrayBuffer()
    if (buf.byteLength === 0 || buf.byteLength > RASTER_DOWNLOAD_CAP) return null
    return new Uint8Array(buf)
  } catch {
    return null
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms))
}

export const __test_only__ = { RASTER_DOWNLOAD_CAP }
