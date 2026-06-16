'use client'

// Multi-roof building picker (2026-06-16). A property can carry several
// structures (house + shed + garage); this lets the customer/tradie pick
// WHICH building the estimate is for, on the real satellite photo with
// every detected building drawn as a tappable outline.
//
// MIRRORS SunShadeOverlay's overlay technique: an absolutely-positioned
// SVG sits over the static-map <img>, and each building.footprint is
// projected (lib/solar/project-latlng) into the image's percentage space
// and drawn as an SVG <polygon> in a 0–100 viewBox. The selected building
// gets a solid orange outline + fill + label chip; the others are dashed,
// dimmed and tappable ("Tap to estimate"); no-coverage buildings are muted
// and not selectable.
//
// Two modes:
//   'select' — tapping a building calls onSelect (the page POSTs
//              select-building, then refreshes). Async: shows a spinner and
//              surfaces the route's 409 / 422 error inline.
//   'local'  — tapping just records the choice locally (no network); the
//              address form reads it back into the estimate payload.
//
// Renders null below 2 buildings (single-roof path is unchanged). When
// `disabled` (released/confirmed estimate), the picker is read-only — the
// selected building is shown, nothing is tappable.
//
// Maintain design system: deep navy, vibrant orange accent, all-caps mono.

import { useRef, useState } from 'react'
import type { DetectedBuilding, LatLng } from '@/lib/solar/types'
import {
  polygonToImagePctPath,
  projectLatLngToImagePct,
  imagePctToLatLng,
  type StaticMapParams,
} from '@/lib/solar/project-latlng'

type Props = {
  buildings: DetectedBuilding[]
  selectedBuildingId: string | null
  /** The framing the `imageUrl` was rendered with — drives the projection. */
  mapParams: StaticMapParams
  /** Satellite image the outlines are drawn over. */
  imageUrl: string
  /** 'select' = onSelect POSTs + refreshes; 'local' = no network. */
  mode: 'select' | 'local'
  onSelect: (buildingId: string) => Promise<void> | void
  /**
   * Free-click (address-form, 2026-06-16): when true the map renders even
   * with <2 detected buildings, and tapping anywhere on the satellite image
   * resolves to a lat/lng via onFreePick — so the customer can estimate a
   * roof Geoscape didn't auto-detect (a shed/granny flat). The chosen point
   * is shown as a pin via `freePick`.
   */
  allowFreeClick?: boolean
  /** The current free-clicked point, drawn as a pin. Null = none. */
  freePick?: LatLng | null
  /** Fired with the resolved coordinate when the user free-taps the image. */
  onFreePick?: (centroid: LatLng) => void
  /** Read-only (released/confirmed estimate) — shows the selection only. */
  disabled?: boolean
}

const ACCENT = '#FF5F00' // Maintain orange — matches the rest of the page.

export function BuildingPicker({
  buildings,
  selectedBuildingId,
  mapParams,
  imageUrl,
  mode,
  onSelect,
  allowFreeClick = false,
  freePick = null,
  onFreePick,
  disabled = false,
}: Props) {
  // Which building is currently resolving an onSelect() call (spinner +
  // disabled), and the most recent inline error (409/422 message).
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)

  // Free-click is live only when explicitly allowed, not read-only, and a
  // handler is wired. When on, the map renders even with <2 buildings.
  const freeClickEnabled = Boolean(allowFreeClick && !disabled && onFreePick)

  // Single-roof path is unchanged UNLESS free-click is on (the address form
  // always wants the map so the customer can tap any roof). The quote page /
  // dashboard pass no allowFreeClick, so they keep the ≥2 gate.
  if (buildings.length < 2 && !freeClickEnabled) return null

  function handleFreeClick(e: React.MouseEvent<HTMLDivElement>) {
    if (!freeClickEnabled || !onFreePick) return
    const el = containerRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return
    const x_pct = ((e.clientX - rect.left) / rect.width) * 100
    const y_pct = ((e.clientY - rect.top) / rect.height) * 100
    onFreePick(imagePctToLatLng({ x_pct, y_pct }, mapParams))
  }

  async function handleSelect(building: DetectedBuilding) {
    if (disabled || pendingId) return
    if (building.solar_status === 'no_coverage') return
    if (building.building_id === selectedBuildingId) return
    setError(null)
    setPendingId(building.building_id)
    try {
      await onSelect(building.building_id)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not switch to this building. Please try again.')
    } finally {
      setPendingId(null)
    }
  }

  return (
    <div className="mt-5 border border-ink-line bg-ink-card">
      <div
        ref={containerRef}
        onClick={freeClickEnabled ? handleFreeClick : undefined}
        className={`relative ${freeClickEnabled ? 'cursor-crosshair' : ''}`}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={imageUrl} alt="Satellite view of the property with each detected building outlined" className="block w-full" />

        {/* Outline overlay — one SVG <polygon> per building, projected into
            the image's percentage space. preserveAspectRatio="none" maps the
            0–100 viewBox onto the image box exactly (pure % positioning). */}
        <svg
          className="pointer-events-none absolute inset-0 h-full w-full"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          {buildings.map((b) => {
            const path = polygonToImagePctPath(b.footprint, mapParams)
            if (path.length < 3) return null
            const isSelected = b.building_id === selectedBuildingId
            const isNoCoverage = b.solar_status === 'no_coverage'
            const isPending = pendingId === b.building_id
            const points = path.map((p) => `${p.x_pct},${p.y_pct}`).join(' ')
            const tappable = !disabled && !isNoCoverage && !isSelected && !pendingId
            return (
              <polygon
                key={b.building_id}
                points={points}
                vectorEffect="non-scaling-stroke"
                onClick={tappable ? (e) => { e.stopPropagation(); void handleSelect(b) } : undefined}
                className={tappable ? 'cursor-pointer' : ''}
                style={{
                  pointerEvents: tappable ? 'auto' : 'none',
                  fill: isSelected ? ACCENT : isNoCoverage ? '#64748b' : ACCENT,
                  fillOpacity: isSelected ? 0.22 : isNoCoverage ? 0.06 : 0.08,
                  stroke: isNoCoverage ? '#64748b' : ACCENT,
                  strokeOpacity: isSelected ? 1 : isNoCoverage ? 0.5 : 0.75,
                  strokeWidth: isSelected ? 2.5 : 1.5,
                  strokeDasharray: isSelected ? undefined : '5 4',
                  opacity: isPending ? 0.55 : 1,
                  transition: 'fill-opacity 150ms, opacity 150ms',
                }}
              />
            )
          })}
        </svg>

        {/* Label chips — absolutely positioned at each building's centroid.
            Outside the SVG so text stays crisp + the buttons own the tap. */}
        {buildings.map((b) => {
          const c = polygonToImagePctPath(b.footprint, mapParams)
          if (c.length < 3) return null
          const cx = c.reduce((s, p) => s + p.x_pct, 0) / c.length
          const cy = c.reduce((s, p) => s + p.y_pct, 0) / c.length
          const isSelected = b.building_id === selectedBuildingId
          const isNoCoverage = b.solar_status === 'no_coverage'
          const isPending = pendingId === b.building_id
          const tappable = !disabled && !isNoCoverage && !isSelected && !pendingId
          return (
            <button
              key={b.building_id}
              type="button"
              disabled={!tappable}
              onClick={tappable ? (e) => { e.stopPropagation(); void handleSelect(b) } : undefined}
              aria-pressed={isSelected}
              aria-label={
                isSelected
                  ? `${b.label} — selected, this estimate is for this building`
                  : isNoCoverage
                    ? `${b.label} — no solar data available`
                    : `${b.label} — tap to estimate this building`
              }
              className={`absolute z-10 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap border px-2.5 py-1 font-mono text-[0.62rem] font-semibold uppercase tracking-[0.12em] backdrop-blur-sm transition-colors ${
                isSelected
                  ? 'border-accent bg-ink-deep/90 text-accent'
                  : isNoCoverage
                    ? 'cursor-not-allowed border-ink-line bg-ink-deep/80 text-text-dim'
                    : 'border-ink-line bg-ink-deep/85 text-text-sec hover:border-accent hover:text-accent'
              } ${tappable ? 'cursor-pointer' : ''}`}
              style={{ left: `${cx}%`, top: `${cy}%` }}
            >
              <span className="flex items-center gap-1.5">
                {b.label}
                {isPending && (
                  <span className="inline-block h-2.5 w-2.5 animate-spin rounded-full border border-accent border-t-transparent" aria-hidden="true" />
                )}
                {!isPending && isSelected && <span aria-hidden="true">●</span>}
                {!isPending && isNoCoverage && (
                  <span className="text-[0.55rem] normal-case tracking-normal text-text-dim">· no solar data</span>
                )}
                {!isPending && !isSelected && !isNoCoverage && (
                  <span className="text-[0.55rem] normal-case tracking-normal text-text-dim">· tap to estimate</span>
                )}
              </span>
            </button>
          )
        })}

        {/* Free-click pin — the roof the customer tapped that Geoscape did
            not outline. Projected back to the image via the same Mercator
            math, so it sits exactly under the tap. */}
        {freePick && freeClickEnabled && (() => {
          const p = projectLatLngToImagePct(freePick, mapParams)
          return (
            <div
              className="pointer-events-none absolute z-20 -translate-x-1/2 -translate-y-1/2"
              style={{ left: `${p.x_pct}%`, top: `${p.y_pct}%` }}
              aria-hidden="true"
            >
              <span className="block h-4 w-4 rounded-full border-2 border-white bg-accent shadow-[0_0_0_4px_rgba(255,95,0,0.25)]" />
            </div>
          )
        })()}
      </div>

      {/* Caption + inline error */}
      <div className="border-t border-ink-line px-5 py-3">
        <p className="font-mono text-[0.66rem] uppercase tracking-[0.14em] text-text-dim">
          {disabled
            ? 'This estimate is for the highlighted building.'
            : freeClickEnabled
              ? buildings.length >= 2
                ? 'Tap a highlighted roof — or tap any building on the map to estimate that one.'
                : 'Tap the roof on the map you want a solar estimate for.'
              : mode === 'local'
                ? 'Several buildings found — tap the one you want a solar estimate for.'
                : 'This property has several buildings — tap another to re-estimate that roof.'}
        </p>
        {error && (
          <p className="mt-2 border border-warning/40 bg-ink-deep px-3 py-2 text-xs text-warning" role="alert">
            {error}
          </p>
        )}
      </div>
    </div>
  )
}
