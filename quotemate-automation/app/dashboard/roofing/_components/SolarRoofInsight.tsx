'use client'

// Google Solar — aerial roof insight on /dashboard/roofing/measure.
// Reads the selected structure's centroid and shows the Solar API's
// per-segment roof breakdown (planes, area, measured pitch, facing) so the
// tradie has an aerial-derived view of the roof for estimation. Purely
// informational — independent of the priced ROOFING_SOLAR_ENRICHMENT path.
// Fails soft: no coverage → a quiet note, never an error.

import { useEffect, useState } from 'react'
import { polygonCentroid } from '@/lib/roofing/map-utils'
import type { RoofMetrics } from '@/lib/roofing/types'

type Segment = { area: number; pitch: number; azimuth: number | null }
type Insight = {
  segmentCount: number
  totalSegmentAreaM2: number
  weightedMeanPitchDegrees: number
  imageryQuality: 'HIGH' | 'MEDIUM' | 'LOW'
  imageryDate: string | null
  segments: Segment[]
}

function compass(az: number | null): string {
  if (az === null) return '—'
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
  return dirs[Math.round(((az % 360) + 360) % 360 / 45) % 8]
}

export function SolarRoofInsight({ accessToken, metrics }: { accessToken: string | null; metrics: RoofMetrics | null }) {
  const [state, setState] = useState<'idle' | 'loading' | 'ready' | 'none'>('idle')
  const [insight, setInsight] = useState<Insight | null>(null)

  const centroid = metrics?.polygon_geojson ? polygonCentroid(metrics.polygon_geojson) : null
  const lat = centroid ? centroid[1] : null
  const lng = centroid ? centroid[0] : null

  useEffect(() => {
    if (!accessToken || lat === null || lng === null) {
      setState('idle')
      return
    }
    let cancelled = false
    setState('loading')
    fetch(`/api/roofing/solar-insight?lat=${lat}&lng=${lng}`, { headers: { Authorization: `Bearer ${accessToken}` } })
      .then((r) => r.json())
      .then((j) => {
        if (cancelled) return
        if (j.ok) {
          setInsight(j.insight)
          setState('ready')
        } else setState('none')
      })
      .catch(() => !cancelled && setState('none'))
    return () => {
      cancelled = true
    }
  }, [accessToken, lat, lng])

  if (state === 'idle') return null

  return (
    <div className="rounded-card mt-6 border border-ink-line bg-ink-card p-6 sm:p-7">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div className="font-mono text-[0.78rem] font-semibold uppercase tracking-[0.16em] text-accent">
          Google Solar · aerial roof insight
        </div>
        {state === 'ready' && insight && (
          <span className="font-mono text-[0.7rem] uppercase tracking-[0.14em] text-text-dim">
            imagery {insight.imageryQuality.toLowerCase()}{insight.imageryDate ? ` · ${insight.imageryDate}` : ''}
          </span>
        )}
      </div>

      {state === 'loading' && <p className="mt-3 text-base text-text-dim">Reading roof geometry from aerial imagery…</p>}
      {state === 'none' && (
        <p className="mt-3 text-base text-text-sec">
          No Google Solar coverage for this roof — the measurement above uses the Geoscape footprint + declared pitch.
        </p>
      )}

      {state === 'ready' && insight && (
        <>
          <div className="mt-5 grid gap-4 sm:grid-cols-3">
            <Stat label="Measured pitch" value={`${insight.weightedMeanPitchDegrees}°`} hint="area-weighted, from aerial" />
            <Stat label="Roof planes" value={String(insight.segmentCount)} hint="distinct facets" />
            <Stat label="Roof area (aerial)" value={`${insight.totalSegmentAreaM2} m²`} hint="sum of segments" />
          </div>

          <div className="mt-5">
            <div className="mb-2 font-mono text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-text-dim">
              Roof planes ({insight.segments.length})
            </div>
            <div className="grid gap-1.5">
              {insight.segments.slice(0, 12).map((s, i) => (
                <div key={i} className="rounded-card flex items-center justify-between border border-ink-line bg-ink-deep px-3 py-2 font-mono text-xs">
                  <span className="text-text-sec">Plane {String(i + 1).padStart(2, '0')}</span>
                  <span className="flex gap-4 text-text-pri">
                    <span>{s.area} m²</span>
                    <span>{s.pitch}°</span>
                    <span className="text-text-dim">faces {compass(s.azimuth)}</span>
                  </span>
                </div>
              ))}
              {insight.segments.length > 12 && (
                <p className="text-xs text-text-dim">+{insight.segments.length - 12} smaller planes…</p>
              )}
            </div>
          </div>
          <p className="mt-3 text-[0.7rem] leading-relaxed text-text-dim">
            Aerial-derived insight for estimation — confirm on site. The priced area above stays the Geoscape measurement.
          </p>
        </>
      )}
    </div>
  )
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-card border border-ink-line bg-ink-deep p-4">
      <div className="font-mono text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-text-dim">{label}</div>
      <div className="mt-2 font-mono text-2xl font-bold tabular-nums text-accent">{value}</div>
      {hint && <div className="mt-1 text-xs text-text-dim">{hint}</div>}
    </div>
  )
}
