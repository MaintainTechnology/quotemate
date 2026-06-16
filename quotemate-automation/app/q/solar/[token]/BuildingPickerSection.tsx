'use client'

// Client wrapper that drives the interactive roof picker on the (server-
// rendered) solar quote page. The server component loads the buildings, the
// selected id and the map centre, then hands them here. We render the same
// pan/zoom MapLibre map the address form uses (SolarRoofMap) so the viewer
// can scroll out and pick ANY structure on the property — including a roof
// Geoscape never outlined (a free-tap, sent as a `centroid`).
//
// Both gestures POST /api/solar/q/[token]/select-building and, on success,
// router.refresh() so the force-dynamic page re-reads the row and the heatmap
// + headline stats re-render for the newly selected roof. The route's non-2xx
// errors (409 released-lock, 422 no_coverage) are surfaced inline.
//
// Read-only (released/confirmed estimate) forwards `readOnly` to the map —
// it still pans/zooms for viewing but does not switch buildings.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { DetectedBuilding, LatLng } from '@/lib/solar/types'
import { SolarRoofMap } from '@/app/solar/[tenantSlug]/_components/SolarRoofMap'

type Props = {
  token: string
  /** Map centre — the page's pickerCenter (resolveSolarOverlayCenter). */
  center: LatLng
  buildings: DetectedBuilding[]
  selectedBuildingId: string | null
  /** True when the estimate is released/confirmed — picker is view-only. */
  readOnly: boolean
}

export function BuildingPickerSection({
  token,
  center,
  buildings,
  selectedBuildingId,
  readOnly,
}: Props) {
  const router = useRouter()
  // Transient: the just-tapped free-pick pin (cleared after refresh) and an
  // in-flight / error state so we can disable further taps while estimating.
  const [freePick, setFreePick] = useState<LatLng | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Shared POST → on ok refresh; on 409/422 surface the mapped message.
  async function select(payload: { building_id: string } | { centroid: LatLng }) {
    if (busy || readOnly) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/solar/q/${token}/select-building`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean
        code?: string
        error?: string
      }
      if (!res.ok || !body.ok) {
        setError(
          body.code === 'no_coverage'
            ? 'No solar data is available for that roof yet.'
            : body.error || 'Could not switch to that roof. Please try again.',
        )
        setFreePick(null)
        setBusy(false)
        return
      }
      // Re-read the row server-side so the heatmap + stats reflect the new
      // roof. The fresh selected_building_id arrives via props; clear the
      // transient pin so it doesn't linger over the re-pointed map.
      setFreePick(null)
      router.refresh()
    } catch {
      setError('Could not switch to that roof. Please try again.')
      setFreePick(null)
      setBusy(false)
    }
  }

  return (
    <div>
      <SolarRoofMap
        center={center}
        buildings={buildings}
        selectedBuildingId={selectedBuildingId}
        freePick={freePick}
        fitToBuildings
        readOnly={readOnly || busy}
        onSelectBuilding={(id) => void select({ building_id: id })}
        onFreePick={(point) => {
          setFreePick(point)
          void select({ centroid: point })
        }}
      />
      {busy && (
        <p
          className="mt-3 font-mono text-[0.66rem] uppercase tracking-[0.14em] text-accent"
          aria-live="polite"
        >
          Estimating that roof…
        </p>
      )}
      {error && (
        <p
          role="alert"
          className="mt-3 border border-red-900/60 bg-red-950/40 px-4 py-3 text-sm text-red-300"
        >
          {error}
        </p>
      )}
    </div>
  )
}
