'use client'

// Interactive Sun & Shade heatmap (2026-06-16). Replaces the static PNG +
// absolutely-positioned dots (SunShadeOverlay) with a GEOREFERENCED MapLibre
// map: everything lives in lat/lng, so off-centre buildings no longer drift.
//
//   • The flux heatmap PNG (/api/solar/q/[token]/flux-heatmap) is added as a
//     MapLibre `image` source pinned to the four corner coordinates derived
//     from `flux_bounds`, rendered as a raster layer over Esri satellite.
//   • Each sun-score dot is placed at its REAL lat/lng — the marker's image-%
//     anchor (x_pct/y_pct) is inverse-projected through `flux_bounds`, the
//     exact inverse of how sun-assets.ts projected the panel centroid. So the
//     dots sit on the same roof pixels the heatmap shows, at any pan/zoom.
//   • The map fits to `flux_bounds` on load and is pan/zoom (view only — no
//     click-to-select; the building picker owns selection).
//
// Mirrors SolarRoofMap: MapLibre loaded CLIENT-ONLY (dynamic import inside the
// effect) so the SSR pass never touches `window`; CSS is a build-time import.
// When `flux_bounds` is absent the PAGE renders the static SunShadeOverlay
// instead — this component is only mounted with real bounds.

import { useEffect, useRef, useState } from 'react'
import type { Map as MlMap, Marker as MlMarker } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import type { SolarSunMarker } from '@/lib/solar/sun-view'
import { SUN_SCORE_COPY, SUN_SCORE_MARKER_COLOR, SUN_SCORE_ORDER } from '@/lib/solar/sun-score'

const ESRI_TILES =
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'

export type FluxBounds = { west: number; south: number; east: number; north: number }

type Props = {
  heatmapSrc: string
  alt: string
  markers: SolarSunMarker[]
  caption: string | null
  bounds: FluxBounds
}

/** PURE — inverse of sun-assets.ts's centroid→x_pct/y_pct projection.
 *  x_pct grows east, y_pct grows south (image top-left origin). */
function pctToLngLat(
  xPct: number,
  yPct: number,
  b: FluxBounds,
): [number, number] {
  const lng = b.west + (xPct / 100) * (b.east - b.west)
  const lat = b.north - (yPct / 100) * (b.north - b.south)
  return [lng, lat]
}

/** Marker DOM element — score-coloured dot, larger ringed star for the best
 *  plane. Mirrors the SunShadeOverlay dot styling so the two views read the
 *  same; MapLibre keeps it pinned to its lat/lng across pan/zoom. */
function makeMarkerEl(m: SolarSunMarker): HTMLDivElement {
  const color = SUN_SCORE_MARKER_COLOR[m.score_label]
  const el = document.createElement('div')
  el.className = 'relative inline-flex items-center justify-center'
  const size = m.is_best ? 24 : 16
  el.style.width = `${size}px`
  el.style.height = `${size}px`
  el.style.borderRadius = '9999px'
  el.style.backgroundColor = color
  el.style.border = '2px solid #ffffff'
  el.style.boxShadow = '0 0 0 1px rgba(0,0,0,0.45), 0 1px 4px rgba(0,0,0,0.55)'
  el.style.cursor = 'pointer'
  el.setAttribute('role', 'button')
  el.setAttribute(
    'aria-label',
    `${m.is_best ? 'Best spot. ' : ''}${m.orientation} face — ${m.score_copy}, ` +
      `${m.area_m2.toLocaleString('en-AU')} square metres, ${m.relative_pct}% of the best face`,
  )
  if (m.is_best) {
    const star = document.createElement('span')
    star.textContent = '★'
    star.style.color = '#ffffff'
    star.style.fontSize = '11px'
    star.style.lineHeight = '1'
    star.style.fontWeight = '700'
    el.appendChild(star)
  }
  return el
}

export function SunShadeMap({ heatmapSrc, alt, markers, caption, bounds }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<MlMap | null>(null)
  const markerObjsRef = useRef<MlMarker[]>([])
  // Index of the marker whose detail card is open (null = none).
  const [openIdx, setOpenIdx] = useState<number | null>(null)
  // Latest open-handler for the once-bound marker clicks (avoid stale closure).
  const openRef = useRef<(i: number | null) => void>(() => {})
  useEffect(() => {
    openRef.current = (i) => setOpenIdx((cur) => (cur === i ? null : i))
  })

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
        // Centre on the heatmap until `load` fits the bounds.
        center: [(bounds.west + bounds.east) / 2, (bounds.south + bounds.north) / 2],
        zoom: 18,
      })
      mapRef.current = map
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right')

      map.on('load', () => {
        if (!map) return
        // Georeferenced flux heatmap as a raster image source. Corner order
        // is [TL, TR, BR, BL] = [[w,n],[e,n],[e,s],[w,s]].
        map.addSource('flux', {
          type: 'image',
          url: heatmapSrc,
          coordinates: [
            [bounds.west, bounds.north],
            [bounds.east, bounds.north],
            [bounds.east, bounds.south],
            [bounds.west, bounds.south],
          ],
        })
        map.addLayer({
          id: 'flux',
          type: 'raster',
          source: 'flux',
          paint: { 'raster-opacity': 0.85, 'raster-resampling': 'nearest' },
        })

        // Frame the heatmap.
        map.fitBounds(
          [
            [bounds.west, bounds.south],
            [bounds.east, bounds.north],
          ],
          { padding: 40, maxZoom: 21, duration: 0 },
        )

        // Sun-score markers at their real lat/lng (inverse-projected).
        markers.forEach((m, i) => {
          const el = makeMarkerEl(m)
          el.addEventListener('click', (e) => {
            e.stopPropagation()
            openRef.current(i)
          })
          const marker = new maplibregl.Marker({ element: el })
            .setLngLat(pctToLngLat(m.x_pct, m.y_pct, bounds))
            .addTo(map!)
          markerObjsRef.current.push(marker)
        })
      })

      // Tap the map (not a marker) closes any open detail card.
      map.on('click', () => openRef.current(null))
    })()

    return () => {
      cancelled = true
      for (const mk of markerObjsRef.current) mk.remove()
      markerObjsRef.current = []
      mapRef.current?.remove()
      mapRef.current = null
    }
    // Create once — props are stable for this view-only map.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Escape closes the detail card.
  useEffect(() => {
    if (openIdx === null) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenIdx(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [openIdx])

  const open = openIdx !== null ? markers[openIdx] : null

  return (
    <div className="mt-5 border border-ink-line bg-ink-card">
      <div className="relative">
        <div ref={containerRef} className="h-112 w-full sm:h-128" data-testid="sun-shade-map" />

        {/* Detail card for the tapped dot — fixed in the figure corner so it
            never drifts as the map pans. Mirrors the static overlay popover. */}
        {open && (
          <div
            role="dialog"
            aria-label={`${open.orientation} face sun score`}
            className="absolute left-3 top-3 z-10 w-48 border bg-ink-deep/95 px-3 py-2.5 shadow-xl backdrop-blur-sm"
            style={{ borderColor: SUN_SCORE_MARKER_COLOR[open.score_label] }}
          >
            <div className="flex items-center gap-1.5">
              {open.is_best && (
                <span className="text-xs leading-none text-accent" aria-hidden="true">
                  ★
                </span>
              )}
              <span className="font-mono text-[0.66rem] font-bold uppercase tracking-[0.1em] text-text-pri">
                {open.is_best ? 'Best spot · ' : ''}
                {open.orientation} face
              </span>
            </div>
            <div className="mt-1.5 flex items-center gap-1.5">
              <span
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: SUN_SCORE_MARKER_COLOR[open.score_label] }}
                aria-hidden="true"
              />
              <span className="font-mono text-[0.62rem] uppercase tracking-[0.08em] text-text-sec">
                {open.score_copy}
              </span>
            </div>
            <dl className="mt-2 space-y-1 font-mono text-[0.6rem] text-text-dim">
              <div className="flex items-baseline justify-between gap-3">
                <dt>Roof area</dt>
                <dd className="tabular-nums text-text-sec">
                  {open.area_m2.toLocaleString('en-AU')} m²
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <dt>Sun vs best</dt>
                <dd className="tabular-nums text-text-sec">{open.relative_pct}%</dd>
              </div>
            </dl>
          </div>
        )}
      </div>

      {/* Traffic-light legend — always agrees with the dot colours. */}
      {markers.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-ink-line px-4 py-3">
          <span className="font-mono text-[0.6rem] font-semibold uppercase tracking-[0.14em] text-text-dim">
            Sun score
          </span>
          {SUN_SCORE_ORDER.map((label) => (
            <span key={label} className="inline-flex items-center gap-1.5">
              <span
                className="h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: SUN_SCORE_MARKER_COLOR[label] }}
                aria-hidden="true"
              />
              <span className="font-mono text-[0.62rem] text-text-sec">{SUN_SCORE_COPY[label]}</span>
            </span>
          ))}
          <span className="inline-flex items-center gap-1.5">
            <span className="text-xs leading-none text-accent" aria-hidden="true">
              ★
            </span>
            <span className="font-mono text-[0.62rem] text-text-sec">Best spot</span>
          </span>
        </div>
      )}

      {caption && (
        <div className="border-t border-ink-line px-5 py-3 text-xs leading-relaxed text-text-dim">
          {markers.length > 0
            ? 'Drag to move · scroll or pinch to zoom · tap a dot to see each roof face’s sun score — the starred dot is the best place for panels. '
            : 'Drag to move · scroll or pinch to zoom. '}
          {caption}
          <span className="sr-only">{alt}</span>
        </div>
      )}
    </div>
  )
}
