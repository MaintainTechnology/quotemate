'use client'

// Roof layout map figure — the aerial + colour-coded zone overlay with
// TRUE zoom controls (spec quote-visual-parity R6, zoom follow-up).
//
// Shared by the tradie /m page (RoofLayoutSection) and the customer
// /q/roof page. "+ / −" re-fetch the Google Static image at the new zoom
// level via the token-gated ?fit=1&z= proxy AND re-project the overlay at
// the same centre/zoom client-side, so the zone borders stay glued to the
// roof at every level. Default = the fit-to-geometry view that frames all
// structures; zooming in reveals detail around the shared centre.

import { useState } from 'react'
import {
  layoutOverlayImageSrc,
  type LayoutMapView,
  type LayoutOverlayStructure,
} from '@/lib/roofing/layout-overlay-svg'
import type { LayoutZone } from '@/lib/roofing/layout-plan'

const MIN_ZOOM = 15
const MAX_ZOOM = 21

type Props = {
  publicToken: string
  zones: LayoutZone[]
  structures: LayoutOverlayStructure[]
  /** Fit-to-geometry view (layoutMapView) — the default zoom level. */
  view: LayoutMapView
  address?: string | null
}

export function RoofLayoutMapFigure({ publicToken, zones, structures, view, address }: Props) {
  const [zoom, setZoom] = useState(view.zoom)

  const overlaySrc = layoutOverlayImageSrc({
    zones,
    structures,
    center: view.center,
    zoom,
    width: 640,
    height: 480,
  })
  const aerialSrc = `/api/roofing/q/${publicToken}/static-map?fit=1${
    zoom !== view.zoom ? `&z=${zoom}` : ''
  }`

  const zoomButton = (label: '+' | '−', disabled: boolean, onClick: () => void) => (
    <button
      type="button"
      aria-label={label === '+' ? 'Zoom in' : 'Zoom out'}
      disabled={disabled}
      onClick={onClick}
      className="flex h-9 w-9 items-center justify-center font-mono text-lg font-bold text-text-sec transition-colors hover:text-accent disabled:opacity-35 disabled:hover:text-text-sec"
    >
      {label}
    </button>
  )

  return (
    <div style={{ position: 'relative', width: '100%', aspectRatio: '4 / 3' }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={aerialSrc}
        alt={`Satellite view of the roof${address ? ` at ${address}` : ''}`}
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
      />
      {overlaySrc ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={overlaySrc}
          alt="Colour-coded work zones"
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
        />
      ) : null}

      {/* Zoom controls — Command Centre chip, bottom-right so the label
          callouts (top corners) stay clear. */}
      <div className="absolute bottom-3 right-3 z-10 flex flex-col divide-y divide-ink-line border border-ink-line bg-ink-deep/95 backdrop-blur">
        {zoomButton('+', zoom >= MAX_ZOOM, () => setZoom((z) => Math.min(MAX_ZOOM, z + 1)))}
        {zoomButton('−', zoom <= MIN_ZOOM, () => setZoom((z) => Math.max(MIN_ZOOM, z - 1)))}
      </div>
    </div>
  )
}
