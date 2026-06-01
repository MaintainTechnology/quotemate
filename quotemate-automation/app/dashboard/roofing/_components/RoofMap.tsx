'use client'

// ════════════════════════════════════════════════════════════════════
// /dashboard/roofing — Esri-tiled MapLibre map widget.
//
// Renders Geoscape building polygons on top of free Esri World Imagery
// raster tiles. Two modes:
//   • SINGLE — pass `polygon` + `form`; one outline with per-edge
//     classification colours (eave / ridge / hip / valley).
//   • MULTI  — pass `buildings` (a list of structures); each footprint is
//     drawn and colour-coded by role + selection + included state, the
//     camera fits the union of all included buildings. Selection is
//     driven by the parent (click a structure card), so the map click
//     stays free for "add / re-measure".
//
// Tiles licence: Esri World Imagery permits commercial use with
// attribution (wired into the MapLibre control).
//
// MapLibre is dynamically imported inside useEffect so SSR doesn't try to
// evaluate it (it needs window / Canvas / WebGL).
// ════════════════════════════════════════════════════════════════════

import { useEffect, useRef, useState } from 'react'
import type { GeoJSONPolygon, RoofForm, RoofMetrics } from '@/lib/roofing/types'
import {
  classifyEdges,
  paddedBBox,
  polygonBBox,
  polygonCentroid,
  type BBox,
  type ClassifiedEdge,
  type EdgeKind,
} from '@/lib/roofing/map-utils'

// ── Edge / fill colours (Maintain palette) ──────────────────────────
const FILL_COLOUR = '#FF5A1F' // accent
const FILL_OPACITY = 0.18
const OUTLINE_COLOUR = '#FF5A1F'
const EDGE_COLOURS: Record<EdgeKind, string> = {
  eave: '#FFFFFF',
  ridge: '#FF7A45',
  hip: '#FF5A1F',
  valley: '#14B8A6',
  unknown: '#7A8699',
}

const EDGE_SWATCH_CLASS: Record<EdgeKind, string> = {
  eave: 'bg-white',
  ridge: 'bg-accent-soft',
  hip: 'bg-accent',
  valley: 'bg-teal-glow',
  unknown: 'bg-text-dim',
}

// Per-building fill/outline colours in MULTI mode.
const SELECTED_FILL = '#FF5A1F'
const PRIMARY_FILL = '#14B8A6'
const SECONDARY_FILL = '#FF7A45'
const EXCLUDED_FILL = '#7A8699'

const ESRI_TILE_URL =
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
const ESRI_ATTRIBUTION =
  '© Esri, Maxar, Earthstar Geographics, and the GIS user community'

type Stats = Pick<RoofMetrics, 'sloped_area_m2' | 'hips' | 'valleys' | 'storeys'> | null

/** One building drawn in MULTI mode. */
export type RoofMapBuilding = {
  id: string
  polygon: GeoJSONPolygon | null
  role: 'primary' | 'secondary'
  /** When false, the building is drawn faint (dropped from the job). */
  included?: boolean
}

export type RoofMapProps = {
  polygon: GeoJSONPolygon | null
  form: RoofForm
  stats: Stats
  /** Fires when the tradie clicks a different point on the map. */
  onRecenter?: (lng: number, lat: number) => void
  className?: string
  /** MULTI mode — overrides the single `polygon` when present + non-empty. */
  buildings?: RoofMapBuilding[]
  selectedId?: string | null
}

// Internal MapLibre handle — we only read a handful of methods off it.
type MapHandle = {
  getSource: (id: string) => unknown
  addSource: (id: string, src: unknown) => unknown
  getLayer: (id: string) => unknown
  addLayer: (layer: unknown) => unknown
  removeLayer: (id: string) => unknown
  removeSource: (id: string) => unknown
  fitBounds: (
    bounds: [[number, number], [number, number]],
    opts?: { padding?: number; duration?: number; maxZoom?: number },
  ) => unknown
}

export function RoofMap({
  polygon,
  form,
  stats,
  onRecenter,
  className,
  buildings,
  selectedId,
}: RoofMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<unknown>(null)
  const drawnRef = useRef<{ layers: string[]; sources: string[] }>({ layers: [], sources: [] })
  const [ready, setReady] = useState(false)
  const [loadErr, setLoadErr] = useState<string | null>(null)

  const multi = Array.isArray(buildings) && buildings.length > 0

  // ── Boot MapLibre once on mount ───────────────────────────────────
  useEffect(() => {
    let cancelled = false
    let cleanup: (() => void) | null = null

    void (async () => {
      if (!containerRef.current) return
      try {
        const maplibre = (await import('maplibre-gl')).default
        await import('maplibre-gl/dist/maplibre-gl.css')
        if (cancelled || !containerRef.current) return

        const firstPolygon = multi
          ? buildings!.find((b) => b.polygon)?.polygon ?? null
          : polygon
        const centroid = polygonCentroid(firstPolygon) ?? [151.2093, -33.8688]

        const map = new maplibre.Map({
          container: containerRef.current,
          style: {
            version: 8,
            sources: {
              'esri-imagery': {
                type: 'raster',
                tiles: [ESRI_TILE_URL],
                tileSize: 256,
                attribution: ESRI_ATTRIBUTION,
                maxzoom: 19,
              },
            },
            layers: [{ id: 'esri-imagery', type: 'raster', source: 'esri-imagery' }],
          },
          center: centroid,
          zoom: firstPolygon ? 18 : 12,
          attributionControl: { compact: true },
        })

        map.addControl(new maplibre.NavigationControl(), 'top-left')
        map.on('click', (e: { lngLat: { lng: number; lat: number } }) => {
          onRecenter?.(e.lngLat.lng, e.lngLat.lat)
        })
        map.on('load', () => {
          if (cancelled) return
          setReady(true)
          mapRef.current = map
        })

        cleanup = () => map.remove()
      } catch (e) {
        if (!cancelled) setLoadErr(e instanceof Error ? e.message : String(e))
      }
    })()

    return () => {
      cancelled = true
      if (cleanup) cleanup()
      mapRef.current = null
    }
    // Boot once; layers/camera update in the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Refresh layers whenever polygon / buildings / selection change ─
  useEffect(() => {
    if (!ready) return
    const map = mapRef.current as MapHandle | null
    if (!map) return

    // Tear down everything we drew last time.
    for (const id of drawnRef.current.layers) safeRemoveLayer(map, id)
    for (const id of drawnRef.current.sources) safeRemoveSource(map, id)
    drawnRef.current = { layers: [], sources: [] }

    if (multi) {
      const drawn = drawMultiBuildings(map, buildings!, selectedId ?? null)
      drawnRef.current = drawn
      const bounds = unionBBox(buildings!.filter((b) => b.included !== false).map((b) => b.polygon))
        ?? unionBBox(buildings!.map((b) => b.polygon))
      if (bounds) fitToBounds(map, bounds)
      return
    }

    if (!polygon) return
    const drawn = drawSinglePolygon(map, polygon, form)
    drawnRef.current = drawn
    const bb = polygonBBox(polygon)
    if (bb) fitToBounds(map, bb)
  }, [ready, polygon, form, buildings, selectedId, multi])

  return (
    <div className={`relative w-full ${className ?? ''}`}>
      <div
        ref={containerRef}
        role="presentation"
        className="h-112 w-full border border-ink-line bg-ink-card sm:h-128"
      />

      {stats && (
        <div className="pointer-events-none absolute right-4 top-4 max-w-[18rem] border border-ink-line bg-ink-deep/95 p-4 backdrop-blur">
          <div className="font-mono text-[0.78rem] font-semibold uppercase tracking-[0.16em] text-accent">
            {multi ? 'Selected structure' : 'Geoscape measurement'}
          </div>
          <ul className="mt-3 space-y-2 font-mono text-base">
            <StatRow
              label="Sloped area"
              value={stats.sloped_area_m2 !== null ? `${stats.sloped_area_m2.toFixed(0)} m²` : '—'}
            />
            <StatRow label="Hips" value={fmtCount(stats.hips)} />
            <StatRow label="Valleys" value={fmtCount(stats.valleys)} />
            <StatRow label="Storeys" value={fmtCount(stats.storeys)} />
          </ul>
        </div>
      )}

      {multi ? (
        <div className="pointer-events-none absolute bottom-4 left-4 border border-ink-line bg-ink-deep/95 p-3 backdrop-blur">
          <div className="font-mono text-[0.7rem] font-semibold uppercase tracking-[0.16em] text-text-dim">
            Structure legend
          </div>
          <ul className="mt-2 grid gap-1.5 text-xs text-text-sec">
            <Legend swatchClass="bg-accent" label="Selected" />
            <Legend swatchClass="bg-teal-glow" label="Main dwelling" />
            <Legend swatchClass="bg-accent-soft" label="Secondary structure" />
            <Legend swatchClass="bg-text-dim" label="Excluded from job" />
          </ul>
        </div>
      ) : (
        polygon && (
          <div className="pointer-events-none absolute bottom-4 left-4 border border-ink-line bg-ink-deep/95 p-3 backdrop-blur">
            <div className="font-mono text-[0.7rem] font-semibold uppercase tracking-[0.16em] text-text-dim">
              Edge legend
            </div>
            <ul className="mt-2 grid gap-1.5 text-xs text-text-sec">
              <Legend swatchClass={EDGE_SWATCH_CLASS.eave} label="Eave" />
              <Legend swatchClass={EDGE_SWATCH_CLASS.ridge} label="Ridge / gable end" />
              <Legend swatchClass={EDGE_SWATCH_CLASS.hip} label="Hip (heuristic)" />
              <Legend swatchClass={EDGE_SWATCH_CLASS.valley} label="Valley (heuristic)" />
            </ul>
          </div>
        )
      )}

      {onRecenter && (
        <div className="pointer-events-none absolute bottom-4 right-4 border border-ink-line bg-ink-deep/95 px-3 py-2 backdrop-blur">
          <span className="font-mono text-[0.7rem] font-semibold uppercase tracking-[0.16em] text-text-dim">
            {multi ? 'Click the map to add / re-measure a building' : 'Click any building to re-measure'}
          </span>
        </div>
      )}

      {loadErr && (
        <div className="absolute inset-0 flex items-center justify-center bg-ink-deep/80 p-4 text-center">
          <p className="max-w-md text-base text-text-sec">Map could not load: {loadErr}</p>
        </div>
      )}
    </div>
  )
}

// ── Layer drawing helpers ─────────────────────────────────────────────

function drawSinglePolygon(
  map: MapHandle,
  polygon: GeoJSONPolygon,
  form: RoofForm,
): { layers: string[]; sources: string[] } {
  map.addSource('roof-polygon', {
    type: 'geojson',
    data: { type: 'Feature', properties: {}, geometry: polygon },
  })
  map.addLayer({
    id: 'roof-fill',
    type: 'fill',
    source: 'roof-polygon',
    paint: { 'fill-color': FILL_COLOUR, 'fill-opacity': FILL_OPACITY },
  })
  map.addLayer({
    id: 'roof-outline',
    type: 'line',
    source: 'roof-polygon',
    paint: { 'line-color': OUTLINE_COLOUR, 'line-width': 2 },
  })

  const edges = classifyEdges(polygon, form)
  const features = edges.map((e: ClassifiedEdge, i: number) => ({
    type: 'Feature' as const,
    properties: { kind: e.kind, idx: i, length_m: e.length_m },
    geometry: { type: 'LineString' as const, coordinates: [e.from, e.to] },
  }))
  map.addSource('roof-edges-source', {
    type: 'geojson',
    data: { type: 'FeatureCollection', features },
  })
  map.addLayer({
    id: 'roof-edges',
    type: 'line',
    source: 'roof-edges-source',
    paint: {
      'line-color': [
        'match',
        ['get', 'kind'],
        'eave', EDGE_COLOURS.eave,
        'ridge', EDGE_COLOURS.ridge,
        'hip', EDGE_COLOURS.hip,
        'valley', EDGE_COLOURS.valley,
        EDGE_COLOURS.unknown,
      ],
      'line-width': 4,
      'line-opacity': 0.92,
    },
  })

  return {
    layers: ['roof-edges', 'roof-outline', 'roof-fill'],
    sources: ['roof-polygon', 'roof-edges-source'],
  }
}

function drawMultiBuildings(
  map: MapHandle,
  buildings: RoofMapBuilding[],
  selectedId: string | null,
): { layers: string[]; sources: string[] } {
  const layers: string[] = []
  const sources: string[] = []
  buildings.forEach((b, i) => {
    if (!b.polygon) return
    const included = b.included !== false
    const isSelected = selectedId != null && b.id === selectedId
    const fillColour = !included
      ? EXCLUDED_FILL
      : isSelected
        ? SELECTED_FILL
        : b.role === 'primary'
          ? PRIMARY_FILL
          : SECONDARY_FILL
    const srcId = `mb-src-${i}`
    const fillId = `mb-fill-${i}`
    const lineId = `mb-line-${i}`
    map.addSource(srcId, {
      type: 'geojson',
      data: { type: 'Feature', properties: {}, geometry: b.polygon },
    })
    map.addLayer({
      id: fillId,
      type: 'fill',
      source: srcId,
      paint: { 'fill-color': fillColour, 'fill-opacity': included ? (isSelected ? 0.3 : 0.16) : 0.05 },
    })
    map.addLayer({
      id: lineId,
      type: 'line',
      source: srcId,
      paint: {
        'line-color': fillColour,
        'line-width': isSelected ? 3 : 2,
        'line-opacity': included ? 0.95 : 0.5,
        ...(included ? {} : { 'line-dasharray': [2, 2] }),
      },
    })
    // Push line first so removal order (layers before sources) is safe.
    layers.push(lineId, fillId)
    sources.push(srcId)
  })
  return { layers, sources }
}

function fitToBounds(map: MapHandle, bb: BBox) {
  const padded = paddedBBox(bb, 0.5)
  map.fitBounds(
    [
      [padded.west, padded.south],
      [padded.east, padded.north],
    ],
    { padding: 24, duration: 400, maxZoom: 19 },
  )
}

/** PURE — union bbox across several polygons (nulls skipped). */
function unionBBox(polygons: Array<GeoJSONPolygon | null>): BBox | null {
  let acc: BBox | null = null
  for (const p of polygons) {
    const bb = polygonBBox(p)
    if (!bb) continue
    acc = acc
      ? {
          west: Math.min(acc.west, bb.west),
          south: Math.min(acc.south, bb.south),
          east: Math.max(acc.east, bb.east),
          north: Math.max(acc.north, bb.north),
        }
      : bb
  }
  return acc
}

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <li className="flex items-baseline justify-between gap-4">
      <span className="text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-text-dim">{label}</span>
      <span className="font-bold text-text-pri">{value}</span>
    </li>
  )
}

function Legend({ swatchClass, label }: { swatchClass: string; label: string }) {
  return (
    <li className="flex items-center gap-2">
      <span aria-hidden="true" className={`inline-block h-1 w-5 ${swatchClass}`} />
      <span>{label}</span>
    </li>
  )
}

function fmtCount(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—'
  return String(n)
}

function safeRemoveLayer(map: { getLayer: (id: string) => unknown; removeLayer: (id: string) => unknown }, id: string) {
  try {
    if (map.getLayer(id)) map.removeLayer(id)
  } catch {
    /* ignore — MapLibre throws when the map is mid-teardown */
  }
}

function safeRemoveSource(map: { getSource: (id: string) => unknown; removeSource: (id: string) => unknown }, id: string) {
  try {
    if (map.getSource(id)) map.removeSource(id)
  } catch {
    /* ignore */
  }
}
