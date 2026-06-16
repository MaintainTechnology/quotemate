'use client'

// Client wrapper that drives the BuildingPicker on the (server-rendered)
// solar quote page. The server component loads the buildings, the selected
// id, the map framing and the satellite image URL, then hands them here.
//
// onSelect POSTs /api/solar/q/[token]/select-building and, on success,
// router.refresh()es so the force-dynamic page re-reads the row and the
// heatmap + headline stats re-render for the newly selected roof. The
// route's non-2xx errors (409 released-lock, 422 no_coverage) bubble up as
// a thrown Error → the picker shows them inline.
//
// Read-only (released/confirmed estimate) just forwards `disabled` — the
// picker then shows the selected building without switching.

import { useRouter } from 'next/navigation'
import type { DetectedBuilding } from '@/lib/solar/types'
import type { StaticMapParams } from '@/lib/solar/project-latlng'
import { BuildingPicker } from './BuildingPicker'

type Props = {
  token: string
  buildings: DetectedBuilding[]
  selectedBuildingId: string | null
  mapParams: StaticMapParams
  imageUrl: string
  /** True when the estimate is released/confirmed — picker is read-only. */
  readOnly: boolean
}

export function BuildingPickerSection({
  token,
  buildings,
  selectedBuildingId,
  mapParams,
  imageUrl,
  readOnly,
}: Props) {
  const router = useRouter()

  async function onSelect(buildingId: string) {
    const res = await fetch(`/api/solar/q/${token}/select-building`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ building_id: buildingId }),
    })
    const body = (await res.json().catch(() => ({}))) as {
      ok?: boolean
      changed?: boolean
      code?: string
      error?: string
    }
    if (!res.ok || !body.ok) {
      throw new Error(
        body.code === 'no_coverage'
          ? 'No solar data is available for that building yet.'
          : body.error || 'Could not switch to that building. Please try again.',
      )
    }
    // Re-read the row server-side so the heatmap + stats reflect the new roof.
    router.refresh()
  }

  return (
    <BuildingPicker
      buildings={buildings}
      selectedBuildingId={selectedBuildingId}
      mapParams={mapParams}
      imageUrl={imageUrl}
      mode="select"
      onSelect={onSelect}
      disabled={readOnly}
    />
  )
}
