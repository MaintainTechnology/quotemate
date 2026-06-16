// ════════════════════════════════════════════════════════════════════
// Solar — sun & shade asset generation (full-exploitation build
// 2026-06-13). Runs in the estimate/redraft route's after(): downloads
// the Google Solar dataLayers GeoTIFFs (annual flux, monthly flux,
// hourly shade, DSM, mask), runs the pure analyses, renders + caches the
// roof irradiance heatmap PNG to the intake-photos bucket, and merges a
// compact `context.sun` summary into the persisted estimate jsonb.
//
// Contract (same as every other supplement):
//   • BEST-EFFORT — any failure leaves the row bit-identical or with a
//     partial context.sun (each layer nulls independently). Never throws.
//   • The signed geoTiff:get URLs require the API key appended
//     (&key=…) per the Solar API docs, and are never persisted.
//   • Display/insight only — nothing here feeds sizing or pricing.
// ════════════════════════════════════════════════════════════════════

import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchSolarDataLayersWithUrls } from './data-layers'
import { decodeSolarGeoTiff, type SolarRaster } from './geotiff'
import {
  analyzeHourlyShade,
  deriveMonthlyProductionWeights,
  estimateBuildingHeightFromDsm,
  fluxRasterLatLngBounds,
  projectPlaneAnchors,
  type FluxLatLngBounds,
  type PlaneAnchor,
  type RasterBand,
  type SolarShadeAnalysis,
  type SolarBuildingHeight,
} from './raster-analysis'
import { renderFluxHeatmapPng, type FluxHeatmapResult } from './flux-render'
import type { LatLng, SolarEstimate, SolarEstimateContext } from './types'

const BUCKET = 'intake-photos'
/** Per-GeoTIFF download cap. */
const MAX_DOWNLOAD_BYTES = 50 * 1024 * 1024
const DOWNLOAD_TIMEOUT_MS = 20_000

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

export type SunAssetsOpts = {
  apiKey?: string
  fetchImpl?: FetchLike
  baseUrl?: string
  /** Skip the 12 hourly-shade downloads (the heaviest part). */
  skipHourlyShade?: boolean
  /**
   * Multi-roof building picker (approach A): when set, the cached heatmap
   * PNG is namespaced under this building id (`solar/{id}/{buildingId}/…`)
   * so each detected building keeps its own heatmap rather than clobbering
   * a sibling's. Absent ⇒ the flat `solar/{id}/…` path (single-building).
   */
  buildingId?: string
}

/** PURE — the generation gate. On by default when a Solar key exists;
 *  SOLAR_SUN_ASSETS=false switches it off explicitly. */
export function sunAssetsEnabled(env: {
  SOLAR_SUN_ASSETS?: string
  GOOGLE_SOLAR_API_KEY?: string
  GOOGLE_MAPS_API_KEY?: string
  [key: string]: string | undefined
}): boolean {
  if (env.SOLAR_SUN_ASSETS === 'false' || env.SOLAR_SUN_ASSETS === '0') return false
  return Boolean(env.GOOGLE_SOLAR_API_KEY ?? env.GOOGLE_MAPS_API_KEY)
}

/**
 * PURE — assemble the persisted context.sun object from the analysis
 * results. Exported for tests; every field nulls independently.
 */
export function buildSunContext(args: {
  now: string
  fluxImagePath: string | null
  flux: FluxHeatmapResult | null
  monthlyWeights: number[] | null
  shade: SolarShadeAnalysis | null
  buildingHeight: SolarBuildingHeight | null
  imageryDate: string | null
  planeAnchors?: PlaneAnchor[] | null
  fluxBounds?: FluxLatLngBounds | null
}): NonNullable<SolarEstimateContext['sun']> {
  return {
    generated_at: args.now,
    flux_image_path: args.fluxImagePath,
    min_flux: args.flux?.min_flux ?? null,
    max_flux: args.flux?.max_flux ?? null,
    plane_anchors:
      args.planeAnchors && args.planeAnchors.length > 0 ? args.planeAnchors : null,
    flux_bounds: args.fluxBounds ?? null,
    monthly_production_weights: args.monthlyWeights,
    shade: args.shade
      ? {
          hourly_sun_fraction: args.shade.hourly_sun_fraction,
          monthly_midday_sun_fraction: args.shade.monthly_midday_sun_fraction,
          shade_free_start_hour: args.shade.shade_free_start_hour,
          shade_free_end_hour: args.shade.shade_free_end_hour,
          shade_free_hours: args.shade.shade_free_hours,
        }
      : null,
    building_height: args.buildingHeight
      ? { height_m: args.buildingHeight.height_m, storeys_hint: args.buildingHeight.storeys_hint }
      : null,
    imagery_date: args.imageryDate,
  }
}

/** PURE — geoTiff:get URLs require the API key appended. */
export function withApiKey(url: string, apiKey: string): string {
  if (url.includes('key=')) return url
  return url + (url.includes('?') ? '&' : '?') + 'key=' + encodeURIComponent(apiKey)
}

/**
 * Generate sun & shade assets for one estimate and merge context.sun
 * into the persisted estimate jsonb. Best-effort; never throws.
 */
export async function applySolarSunAssets(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any>,
  args: { publicToken: string; location: LatLng },
  opts: SunAssetsOpts = {},
): Promise<void> {
  try {
    if (!sunAssetsEnabled(process.env)) return
    const apiKey =
      opts.apiKey ?? process.env.GOOGLE_SOLAR_API_KEY ?? process.env.GOOGLE_MAPS_API_KEY
    if (!apiKey) return
    const fetchImpl: FetchLike = opts.fetchImpl ?? ((u, init) => fetch(u, init))

    // ── Row lookup (need the id for the storage path). ───────────────
    const { data: row } = await supabase
      .from('solar_estimates')
      .select('id, estimate')
      .eq('public_token', args.publicToken)
      .maybeSingle()
    if (!row?.id || !row.estimate) return

    // ── Fresh dataLayers call — signed URLs are short-lived, so asset
    //    generation always re-fetches rather than reusing draft-time URLs.
    const { summary, urls } = await fetchSolarDataLayersWithUrls(args.location, {
      apiKey,
      fetchImpl,
      baseUrl: opts.baseUrl,
    })
    if (summary.status !== 'available' || !urls) return

    // ── Downloads (mask first — everything clips/aggregates by it). ──
    const mask = await downloadRaster(urls.mask, apiKey, fetchImpl)
    const maskBand = firstBand(mask)

    const [annualFlux, monthlyFlux, dsm, rgb] = await Promise.all([
      downloadRaster(urls.annual_flux, apiKey, fetchImpl),
      downloadRaster(urls.monthly_flux, apiKey, fetchImpl),
      downloadRaster(urls.dsm, apiKey, fetchImpl),
      downloadRaster(urls.rgb, apiKey, fetchImpl),
    ])

    let hourlyShade: Array<SolarRaster | null> = []
    if (!opts.skipHourlyShade && urls.hourly_shade.length === 12) {
      hourlyShade = await Promise.all(
        urls.hourly_shade.map((u) => downloadRaster(u, apiKey, fetchImpl)),
      )
    }

    // ── Analyses (each independent; failures null their slice). ──────
    // The aerial RGB layer (same grid as the flux raster) makes the
    // heatmap an opaque photo composite instead of a transparent overlay.
    const rgbBands =
      rgb !== null && rgb.bands >= 3
        ? {
            r: { data: rgb.rasters[0], width: rgb.width, height: rgb.height },
            g: { data: rgb.rasters[1], width: rgb.width, height: rgb.height },
            b: { data: rgb.rasters[2], width: rgb.width, height: rgb.height },
          }
        : null

    const flux =
      annualFlux !== null
        ? renderFluxHeatmapPng(
            firstBand(annualFlux)!,
            maskBand,
            annualFlux.no_data_value,
            rgbBands,
          )
        : null

    const monthlyWeights =
      monthlyFlux !== null && monthlyFlux.bands === 12
        ? deriveMonthlyProductionWeights(
            monthlyFlux.rasters.map((r) => ({
              data: r,
              width: monthlyFlux.width,
              height: monthlyFlux.height,
            })),
            maskBand,
            monthlyFlux.no_data_value,
          )
        : null

    const shade =
      hourlyShade.length === 12
        ? analyzeHourlyShade(
            hourlyShade.map((m) =>
              m && m.bands === 24
                ? {
                    bands: m.rasters.map((r) => ({
                      data: r,
                      width: m.width,
                      height: m.height,
                    })),
                  }
                : null,
            ),
            maskBand,
          )
        : null

    const buildingHeight =
      dsm !== null && maskBand !== null
        ? estimateBuildingHeightFromDsm(firstBand(dsm)!, maskBand, dsm.no_data_value)
        : null

    // Nothing usable at all → leave the row untouched.
    if (!flux && !monthlyWeights && !shade && !buildingHeight) return

    // ── Cache the heatmap PNG. ────────────────────────────────────────
    let fluxImagePath: string | null = null
    if (flux) {
      const ns = opts.buildingId ? `${encodeURIComponent(opts.buildingId)}/` : ''
      const path = `solar/${row.id}/${ns}flux-annual-${Date.now()}.png`
      const { error: upErr } = await supabase.storage
        .from(BUCKET)
        .upload(path, Buffer.from(flux.png), { contentType: 'image/png', upsert: false })
      if (!upErr) fluxImagePath = path
    }

    // ── Merge context.sun into the persisted estimate jsonb. ─────────
    const estimate = row.estimate as SolarEstimate

    // Per-plane label anchors: panel centroids projected through the flux
    // raster's geo bbox → % positions inside the heatmap image, so the
    // quote page can pin sun-score labels onto the roof deterministically.
    const planeAnchors =
      flux && annualFlux?.bbox
        ? projectPlaneAnchors(estimate.roof.panels ?? [], annualFlux.bbox, args.location)
        : []

    // Geographic extent of the rendered heatmap PNG, derived with the same
    // north-up/centred model as the anchors — lets the quote page render it
    // as a georeferenced raster on the interactive pan/zoom SunShadeMap.
    const fluxBounds =
      flux && annualFlux?.bbox
        ? fluxRasterLatLngBounds(annualFlux.bbox, args.location)
        : null

    const sun = buildSunContext({
      now: new Date().toISOString(),
      fluxImagePath,
      flux,
      monthlyWeights,
      shade,
      buildingHeight,
      imageryDate: summary.imagery_date,
      planeAnchors,
      fluxBounds,
    })
    const nextEstimate: SolarEstimate = {
      ...estimate,
      context: { ...estimate.context, sun },
    }
    await supabase
      .from('solar_estimates')
      .update({ estimate: nextEstimate })
      .eq('public_token', args.publicToken)
  } catch (e) {
    console.error(
      '[solar/sun-assets] generation failed:',
      e instanceof Error ? e.message : String(e),
    )
  }
}

// ── helpers ──────────────────────────────────────────────────────────

/** Download + decode one GeoTIFF; null on any failure. */
async function downloadRaster(
  url: string | null,
  apiKey: string,
  fetchImpl: FetchLike,
): Promise<SolarRaster | null> {
  if (!url) return null
  try {
    const res = await fetchImpl(withApiKey(url, apiKey), {
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
    })
    if (!res.ok) return null
    const buf = await res.arrayBuffer()
    if (buf.byteLength === 0 || buf.byteLength > MAX_DOWNLOAD_BYTES) return null
    const decoded = await decodeSolarGeoTiff(new Uint8Array(buf))
    return decoded.ok ? decoded.data : null
  } catch {
    return null
  }
}

function firstBand(raster: SolarRaster | null): RasterBand | null {
  if (!raster || raster.rasters.length === 0) return null
  return { data: raster.rasters[0], width: raster.width, height: raster.height }
}

export const __test_only__ = { BUCKET, MAX_DOWNLOAD_BYTES }
