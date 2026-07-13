'use client'

// Roof layout map — a REAL interactive map (spec quote-visual-parity R6,
// pan/rotate follow-up): drag to pan, scroll/± to zoom, right-click-drag (or
// Ctrl-drag) to rotate, compass click to reset north — the same MapLibre +
// free Esri World Imagery setup as the roof-measurement view
// (app/dashboard/roofing/_components/RoofMap.tsx), so no Google billing on
// customer interaction.
//
// The AI plan's zones render as GEOGRAPHIC layers (lib/roofing/layout-geojson)
// so they stay glued to the roof through pan/zoom/rotate. The numbered ZONE
// callouts float over the map margins, pointer-transparent so dragging works
// straight through them. Pass PRE-FILTERED zones (only selected structures);
// the camera fits the union of `fitIndices` (1-based; defaults to all).

import { useEffect, useRef, useState } from 'react'
import { layoutPlanGeoJson } from '@/lib/roofing/layout-geojson'
import type { LayoutOverlayStructure } from '@/lib/roofing/layout-overlay-svg'
import { ZONE_COLOR_HEX, ZONE_TEXT_HEX, type LayoutZone } from '@/lib/roofing/layout-plan'
import { polygonBBox, type BBox } from '@/lib/roofing/map-utils'
import { resolveGoogleSatelliteSource } from '@/lib/roofing/google-tiles'

const ESRI_TILE_URL =
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
const ESRI_ATTRIBUTION = '© Esri, Maxar, Earthstar Geographics, and the GIS user community'

const TINT = '#5B7B8C'
const CASING = '#1F2937'

type Props = {
  /** Zones already filtered to the SELECTED structures (structureIndex stays
   *  1-based into the FULL `structures` array). */
  zones: LayoutZone[]
  /** The FULL quote's structures, index-aligned with zone.structureIndex. */
  structures: LayoutOverlayStructure[]
  /** 1-based indices the camera should frame (the selection); default all. */
  fitIndices?: number[] | null
}

type MapHandle = {
  addSource: (id: string, src: unknown) => unknown
  addLayer: (layer: unknown) => unknown
  getSource: (id: string) => { setData: (data: unknown) => void } | undefined
  fitBounds: (
    bounds: [[number, number], [number, number]],
    opts?: { padding?: number; duration?: number; maxZoom?: number },
  ) => unknown
}

/** PURE — union bbox across the fit subset. */
function fitBBox(structures: readonly LayoutOverlayStructure[], fitIndices?: number[] | null): BBox | null {
  const subset =
    fitIndices && fitIndices.length > 0
      ? fitIndices.map((i) => structures[i - 1]).filter(Boolean)
      : [...structures]
  let acc: BBox | null = null
  for (const s of subset) {
    const bb = polygonBBox(s.polygon)
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

export function RoofLayoutMapFigure({ zones, structures, fitIndices }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<MapHandle | null>(null)
  const [ready, setReady] = useState(false)
  const [loadErr, setLoadErr] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    let cleanup: (() => void) | null = null

    void (async () => {
      if (!containerRef.current) return
      try {
        const maplibre = (await import('maplibre-gl')).default
        await import('maplibre-gl/dist/maplibre-gl.css')
        if (cancelled || !containerRef.current) return

        const bounds = fitBBox(structures, fitIndices)
        const center: [number, number] = bounds
          ? [(bounds.west + bounds.east) / 2, (bounds.south + bounds.north) / 2]
          : [151.2093, -33.8688]

        // Prefer Google satellite (Map Tiles API) so the customer's layout map
        // matches the rest of the quote imagery; fall back to free Esri World
        // Imagery when no Map Tiles key is set / the session can't mint. Zones
        // are GEOGRAPHIC layers, so they stay glued to the roof either way.
        // NOTE: this map is customer-facing — Google tiles bill on customer
        // interaction (Esri did not); the key gate controls that spend.
        const google = await resolveGoogleSatelliteSource().catch(() => null)
        if (cancelled || !containerRef.current) return
        const basemap = google
          ? {
              id: 'google-satellite',
              source: {
                type: 'raster' as const,
                tiles: google.tiles,
                tileSize: 256,
                attribution: google.attribution,
                maxzoom: google.maxzoom,
              },
            }
          : {
              id: 'esri-imagery',
              source: {
                type: 'raster' as const,
                tiles: [ESRI_TILE_URL],
                tileSize: 256,
                attribution: ESRI_ATTRIBUTION,
                maxzoom: 19,
              },
            }

        const map = new maplibre.Map({
          container: containerRef.current,
          style: {
            version: 8,
            sources: { [basemap.id]: basemap.source },
            layers: [{ id: basemap.id, type: 'raster', source: basemap.id }],
          },
          center,
          zoom: 18,
          attributionControl: { compact: true },
        })
        // Zoom ± and the compass (click = reset north). Drag-rotate is
        // MapLibre's default right-click / Ctrl-drag gesture.
        map.addControl(new maplibre.NavigationControl({ visualizePitch: false }), 'bottom-right')

        map.on('load', () => {
          if (cancelled) return
          const m = map as unknown as MapHandle
          const geo = layoutPlanGeoJson({ zones, structures })
          m.addSource('layout-tints', { type: 'geojson', data: geo.tints })
          m.addLayer({
            id: 'layout-tint-fill',
            type: 'fill',
            source: 'layout-tints',
            paint: { 'fill-color': TINT, 'fill-opacity': 0.4 },
          })
          m.addSource('layout-lines', { type: 'geojson', data: geo.lines })
          m.addLayer({
            id: 'layout-line-casing',
            type: 'line',
            source: 'layout-lines',
            paint: { 'line-color': CASING, 'line-width': 4.5 },
            layout: { 'line-cap': 'round', 'line-join': 'round' },
          })
          m.addLayer({
            id: 'layout-line-solid',
            type: 'line',
            source: 'layout-lines',
            filter: ['==', ['get', 'dash'], 0],
            paint: { 'line-color': ['get', 'color'], 'line-width': 2.5 },
            layout: { 'line-cap': 'round', 'line-join': 'round' },
          })
          m.addLayer({
            id: 'layout-line-dashed',
            type: 'line',
            source: 'layout-lines',
            filter: ['==', ['get', 'dash'], 1],
            paint: {
              'line-color': ['get', 'color'],
              'line-width': 2.5,
              'line-dasharray': [2, 1.6],
            },
          })
          m.addSource('layout-points', { type: 'geojson', data: geo.points })
          m.addLayer({
            id: 'layout-point-markers',
            type: 'circle',
            source: 'layout-points',
            paint: {
              'circle-radius': 7,
              'circle-color': ['get', 'color'],
              'circle-stroke-color': CASING,
              'circle-stroke-width': 2,
            },
          })
          if (bounds) {
            m.fitBounds(
              [
                [bounds.west, bounds.south],
                [bounds.east, bounds.north],
              ],
              { padding: 72, duration: 0, maxZoom: 19 },
            )
          }
          mapRef.current = m
          setReady(true)
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
    // Boot once; live prop changes are applied by the refresh effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Live refresh — when the tradie ticks/unticks a structure, the zone layers
  // update in place (setData) and the camera re-fits the new selection.
  useEffect(() => {
    const m = mapRef.current
    if (!ready || !m) return
    const geo = layoutPlanGeoJson({ zones, structures })
    m.getSource('layout-tints')?.setData(geo.tints)
    m.getSource('layout-lines')?.setData(geo.lines)
    m.getSource('layout-points')?.setData(geo.points)
    const bounds = fitBBox(structures, fitIndices)
    if (bounds) {
      m.fitBounds(
        [
          [bounds.west, bounds.south],
          [bounds.east, bounds.north],
        ],
        { padding: 72, duration: 500, maxZoom: 19 },
      )
    }
  }, [ready, zones, structures, fitIndices])

  return (
    <div
      data-testid="layout-map"
      style={{ position: 'relative', width: '100%', aspectRatio: '4 / 3', minHeight: 420 }}
    >
      <div ref={containerRef} role="presentation" style={{ position: 'absolute', inset: 0 }} />

      {/* Numbered ZONE callouts — pointer-transparent so drag/rotate work
          straight through them; numbering matches the legend below. */}
      <div
        aria-hidden
        style={{
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
          display: 'flex',
          justifyContent: 'space-between',
          padding: 8,
          gap: 8,
        }}
      >
        {(['left', 'right'] as const).map((side) => (
          <div key={side} style={{ display: 'flex', flexDirection: 'column', gap: 8, width: 186 }}>
            {zones
              .map((z, i) => ({ z, n: i + 1 }))
              .filter((_, i) => (side === 'right' ? i % 2 === 0 : i % 2 === 1))
              .map(({ z, n }) => (
                <div
                  key={n}
                  style={{
                    borderLeft: `4px solid ${ZONE_COLOR_HEX[z.color]}`,
                    border: '1px solid #4A4038',
                    borderLeftWidth: 4,
                    borderLeftColor: ZONE_COLOR_HEX[z.color],
                    background: 'rgba(22, 18, 15, 0.92)',
                    padding: '8px 10px',
                  }}
                >
                  <div
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 8,
                      fontWeight: 700,
                      letterSpacing: '0.15em',
                      textTransform: 'uppercase',
                      color: ZONE_TEXT_HEX[z.color],
                    }}
                  >
                    ZONE {String(n).padStart(2, '0')}
                  </div>
                  <div style={{ marginTop: 3, fontSize: 11.5, fontWeight: 600, lineHeight: 1.35, color: '#F2EDE6' }}>
                    {z.label}
                  </div>
                </div>
              ))}
          </div>
        ))}
      </div>

      {loadErr ? (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(22,18,15,0.85)',
            padding: 16,
          }}
        >
          <p style={{ maxWidth: 420, fontSize: 13, color: 'var(--text-sec)', textAlign: 'center' }}>
            Map could not load: {loadErr}
          </p>
        </div>
      ) : null}
    </div>
  )
}
