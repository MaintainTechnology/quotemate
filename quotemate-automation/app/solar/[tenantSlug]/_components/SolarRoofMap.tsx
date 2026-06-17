'use client'

// Interactive roof picker for the solar address form (2026-06-16). Replaces
// the fixed static-map image with a pan/zoom MapLibre map so the customer can
// scroll out and pick ANY building on the property — not just the one Geoscape
// auto-detected. Detected buildings are drawn as tappable orange outlines;
// tapping anywhere else free-picks that point, which the engine estimates
// (Google snaps to the building there).
//
// Satellite imagery is Esri World Imagery — a free raster tile source, no API
// key. MapLibre is loaded CLIENT-ONLY (dynamic import inside the effect) so the
// SSR pass never touches `window`; the CSS is a build-time extracted import.

import { useEffect, useRef, useState } from 'react'
import type { Map as MlMap, Marker as MlMarker } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import type { DetectedBuilding, LatLng } from '@/lib/solar/types'

const ACCENT = '#FF5F00' // Maintain orange.
const ESRI_TILES =
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
const INITIAL_ZOOM = 18 // wider than the old static zoom-20 so neighbours show.

type Props = {
  /** Initial map centre — the geocoded address from /detect. */
  center: LatLng
  /** Detected buildings, drawn as tappable outlines. */
  buildings: DetectedBuilding[]
  /** Highlighted detected building (orange fill). */
  selectedBuildingId: string | null
  /** Free-picked point (a roof Geoscape didn't outline) — shown as a pin. */
  freePick: LatLng | null
  /** Tapped a detected building outline. */
  onSelectBuilding: (buildingId: string) => void
  /** Tapped anywhere else — resolves to that coordinate. */
  onFreePick: (point: LatLng) => void
  /** On load, frame the map to enclose ALL buildings (fitBounds) rather than
   *  the fixed centre/zoom. The quote page needs this — detected structures
   *  can be hundreds of metres apart, so a fixed zoom-18 only shows one. */
  fitToBuildings?: boolean
  /** View-only: still pans/zooms but does NOT wire click→select/free-pick
   *  and hides the "tap a roof" crosshair hint. */
  readOnly?: boolean
}

/** PURE — a LngLatBounds-shaped tuple [[w,s],[e,n]] enclosing every building's
 *  footprint coordinates (and centroid as a fallback). Null when nothing has a
 *  finite coordinate. Returned as plain numbers so the caller can hand it to
 *  maplibre's `fitBounds` without importing the class here. */
function buildingsBounds(
  buildings: DetectedBuilding[],
): [[number, number], [number, number]] | null {
  let west = Infinity
  let south = Infinity
  let east = -Infinity
  let north = -Infinity
  const extend = (lng: number, lat: number) => {
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return
    if (lng < west) west = lng
    if (lng > east) east = lng
    if (lat < south) south = lat
    if (lat > north) north = lat
  }
  for (const b of buildings) {
    const ring = b.footprint?.coordinates?.[0]
    if (ring && ring.length) {
      for (const [lng, lat] of ring) extend(lng, lat)
    } else if (b.centroid) {
      extend(b.centroid.lng, b.centroid.lat)
    }
  }
  if (west === Infinity) return null
  return [
    [west, south],
    [east, north],
  ]
}

/** PURE — detected buildings → a GeoJSON FeatureCollection for the source,
 *  stamping each with whether it is the selected one (drives the fill). */
function buildingsToGeoJson(
  buildings: DetectedBuilding[],
  selectedId: string | null,
): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: buildings
      .filter((b) => b.footprint)
      .map((b) => ({
        type: 'Feature',
        properties: { building_id: b.building_id, selected: b.building_id === selectedId },
        geometry: b.footprint as GeoJSON.Polygon,
      })),
  }
}

export function SolarRoofMap({
  center,
  buildings,
  selectedBuildingId,
  freePick,
  onSelectBuilding,
  onFreePick,
  fitToBuildings = false,
  readOnly = false,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<MlMap | null>(null)
  const markerRef = useRef<MlMarker | null>(null)
  const readyRef = useRef(false)
  const [mapReady, setMapReady] = useState(false)
  const persistedFreePick =
    buildings.find((b) => b.building_id === selectedBuildingId && !b.footprint)?.centroid ?? null
  const selectedPoint = freePick ?? persistedFreePick
  // Latest callbacks for the once-bound click handler (avoid stale closures).
  const cbRef = useRef({ onSelectBuilding, onFreePick })
  useEffect(() => {
    cbRef.current = { onSelectBuilding, onFreePick }
  }, [onSelectBuilding, onFreePick])

  // ── Create the map once on mount (client only). ──────────────────
  useEffect(() => {
    let cancelled = false
    let map: MlMap | null = null
    ;(async () => {
      const maplibregl = (await import('maplibre-gl')).default
      if (cancelled || !containerRef.current) return
      map = new maplibregl.Map({
        container: containerRef.current,
        style: {
          version: 8,
          sources: {
            esri: {
              type: 'raster',
              tiles: [ESRI_TILES],
              tileSize: 256,
              attribution: 'Imagery © Esri, Maxar, Earthstar Geographics',
            },
          },
          layers: [{ id: 'esri', type: 'raster', source: 'esri' }],
        },
        center: [center.lng, center.lat],
        zoom: INITIAL_ZOOM,
      })
      mapRef.current = map
      setMapReady(true)
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right')

      map.on('load', () => {
        if (!map) return
        map.addSource('buildings', {
          type: 'geojson',
          data: buildingsToGeoJson(buildings, selectedBuildingId),
        })
        map.addLayer({
          id: 'buildings-fill',
          type: 'fill',
          source: 'buildings',
          paint: { 'fill-color': ACCENT, 'fill-opacity': ['case', ['get', 'selected'], 0.38, 0.12] },
        })
        map.addLayer({
          id: 'buildings-line',
          type: 'line',
          source: 'buildings',
          paint: { 'line-color': ACCENT, 'line-width': ['case', ['get', 'selected'], 3, 1.5] },
        })
        // Frame ALL buildings instead of the fixed centre/zoom — they can be
        // hundreds of metres apart, so a single zoom-18 view misses some.
        if (fitToBuildings) {
          const bounds = buildingsBounds(buildings)
          if (bounds) map.fitBounds(bounds, { padding: 40, maxZoom: 19 })
        }
        readyRef.current = true
        setMapReady(true)
      })

      // Tap a building outline → select it; tap anywhere else → free-pick.
      // Skipped entirely in read-only mode (the map still pans/zooms).
      if (!readOnly) {
        map.on('click', (e) => {
          if (!map) return
          const cb = cbRef.current
          const feats = readyRef.current
            ? map.queryRenderedFeatures(e.point, { layers: ['buildings-fill'] })
            : []
          const id = feats[0]?.properties?.building_id
          if (id) cb.onSelectBuilding(String(id))
          else cb.onFreePick({ lat: e.lngLat.lat, lng: e.lngLat.lng })
        })
        map.on('mouseenter', 'buildings-fill', () => {
          if (map) map.getCanvas().style.cursor = 'pointer'
        })
        map.on('mouseleave', 'buildings-fill', () => {
          if (map) map.getCanvas().style.cursor = ''
        })
      }
    })()

    return () => {
      cancelled = true
      readyRef.current = false
      markerRef.current?.remove()
      markerRef.current = null
      mapRef.current?.remove()
      mapRef.current = null
    }
    // Create once; prop changes are handled by the focused effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Re-centre when a new address is detected. ────────────────────
  useEffect(() => {
    mapRef.current?.setCenter([center.lng, center.lat])
  }, [center.lat, center.lng])

  // ── Refresh outlines + highlight when buildings / selection change. ──
  useEffect(() => {
    const map = mapRef.current
    if (!map || !readyRef.current) return
    const src = map.getSource('buildings') as
      | { setData: (d: GeoJSON.FeatureCollection) => void }
      | undefined
    src?.setData(buildingsToGeoJson(buildings, selectedBuildingId))
  }, [buildings, selectedBuildingId])

  // ── Free-pick pin. ───────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const map = mapRef.current
      if (!map || !mapReady) return
      if (!selectedPoint) {
        markerRef.current?.remove()
        markerRef.current = null
        return
      }
      const maplibregl = (await import('maplibre-gl')).default
      if (cancelled || !mapRef.current) return
      if (!markerRef.current) markerRef.current = new maplibregl.Marker({ color: ACCENT })
      markerRef.current.setLngLat([selectedPoint.lng, selectedPoint.lat]).addTo(mapRef.current)
    })()
    return () => {
      cancelled = true
    }
  }, [mapReady, selectedPoint])

  return (
    <div className="mt-5 border border-ink-line bg-ink-card">
      <div ref={containerRef} className="h-80 w-full" data-testid="solar-roof-map" />
      <div className="border-t border-ink-line px-5 py-3">
        <p className="font-mono text-[0.66rem] uppercase tracking-[0.14em] text-text-dim">
          {readOnly
            ? 'Drag to move · scroll or pinch to zoom — the highlighted roof is the one this estimate is for.'
            : 'Drag to move · scroll or pinch to zoom out · tap the roof you want a solar estimate for.'}
        </p>
      </div>
    </div>
  )
}
