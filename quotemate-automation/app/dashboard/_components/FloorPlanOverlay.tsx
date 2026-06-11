'use client'

// Floor-plan design overlay — renders the uploaded plan (pdf.js page or
// image) with the deterministic AC layout drawn over it: room polygons
// colour-coded by zone, duct runs / split heads, return air and outdoor
// unit, plus a volumetric label per conditioned room
// ("BED 2 · 12.8 m² × 2.4 m = 30.7 m³ → 1.6 kW").
//
// Geometry comes from lib/aircon/design.ts (pure code, page-percent
// space) — the overlay is SVG + positioned divs, never a generated
// image. Follows PlanOverlay.tsx (estimator) rendering patterns.

import { useEffect, useMemo, useRef, useState } from 'react'
import { polygonCentroid } from '@/lib/aircon/design'
import type {
  AcPlanDesign,
  AcResolvedRoom,
  AcSystemType,
  RoomLoad,
} from '@/lib/aircon/types'

type Props = {
  file: File
  rooms: AcResolvedRoom[]
  /** Per-room loads from sizing (plan path: names match `rooms`). */
  loads: RoomLoad[]
  design: AcPlanDesign
  ceilingHeightM: number
}

const ZONE_FILL: Record<'living' | 'bedroom', string> = {
  living: 'rgba(255, 107, 53, 0.16)', // accent-ish
  bedroom: 'rgba(46, 196, 182, 0.16)', // teal
}
const ZONE_STROKE: Record<'living' | 'bedroom', string> = {
  living: '#ff6b35',
  bedroom: '#2ec4b6',
}

function pointsAttr(polygon: AcResolvedRoom['polygon']): string {
  return polygon.map((p) => `${p.x},${p.y}`).join(' ')
}

/** Small absolutely-positioned marker (SVG circles would distort under
 *  the stretched 0–100 viewBox, so markers are divs). */
function Marker({
  x,
  y,
  label,
  colour,
  square,
}: {
  x: number
  y: number
  label: string
  colour: string
  square?: boolean
}) {
  return (
    <div
      className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2"
      style={{ left: `${x}%`, top: `${y}%` }}
    >
      <div
        className={`mx-auto border-2 ${square ? '' : 'rounded-full'}`}
        style={{ width: 14, height: 14, borderColor: colour, backgroundColor: `${colour}40` }}
      />
      <span
        className="mt-0.5 block whitespace-nowrap px-1 font-mono text-[0.55rem] font-bold uppercase tracking-wide"
        style={{ color: colour, backgroundColor: 'rgba(10, 15, 30, 0.75)' }}
      >
        {label}
      </span>
    </div>
  )
}

export function FloorPlanOverlay({ file, rooms, loads, design, ceilingHeightM }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [imgSrc, setImgSrc] = useState<string | null>(null)
  const [rendering, setRendering] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [system, setSystem] = useState<AcSystemType>('ducted')

  const isPdf = file.type === 'application/pdf'

  // Image plans: plain object URL.
  useEffect(() => {
    if (isPdf) return
    const url = URL.createObjectURL(file)
    setImgSrc(url)
    return () => URL.revokeObjectURL(url)
  }, [file, isPdf])

  // PDF plans: render the design page via pdf.js (lazy, client only).
  useEffect(() => {
    if (!isPdf) return
    let cancelled = false
    setRendering(true)
    setError(null)
    ;(async () => {
      try {
        const pdfjs = await import('pdfjs-dist')
        pdfjs.GlobalWorkerOptions.workerSrc = new URL(
          'pdfjs-dist/build/pdf.worker.min.mjs',
          import.meta.url,
        ).toString()
        const data = await file.arrayBuffer()
        const doc = await pdfjs.getDocument({ data }).promise
        if (cancelled) return
        const pdfPage = await doc.getPage(Math.min(design.page, doc.numPages))
        const canvas = canvasRef.current
        if (!canvas || cancelled) return
        const base = pdfPage.getViewport({ scale: 1 })
        const scale = 1600 / base.width
        const viewport = pdfPage.getViewport({ scale })
        canvas.width = viewport.width
        canvas.height = viewport.height
        const ctx = canvas.getContext('2d')
        if (!ctx) return
        await pdfPage.render({ canvas, canvasContext: ctx, viewport }).promise
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'could not render the plan page')
      } finally {
        if (!cancelled) setRendering(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [file, isPdf, design.page])

  const loadByName = useMemo(
    () => new Map(loads.filter((l) => l.name).map((l) => [l.name as string, l])),
    [loads],
  )
  const layout = system === 'ducted' ? design.ducted : design.split
  const warnings = layout.warnings

  return (
    <div className="mt-5 border border-ink-line bg-ink-deep">
      <div className="flex flex-wrap items-center gap-3 border-b border-ink-line px-4 py-2.5">
        <span className="font-mono text-[0.66rem] font-semibold uppercase tracking-[0.14em] text-accent">
          Indicative design overlay
        </span>
        <div className="flex gap-0 border border-ink-line">
          {(['ducted', 'split'] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSystem(s)}
              className={`px-3 py-1 font-mono text-xs font-semibold uppercase tracking-[0.12em] transition-colors ${
                system === s ? 'bg-accent text-white' : 'text-text-dim hover:text-text-pri'
              }`}
            >
              {s}
            </button>
          ))}
        </div>
        <span className="font-mono text-xs text-text-dim">
          {system === 'ducted'
            ? `${design.ducted.outlets.length} outlets · ${design.ducted.zones.length} zones`
            : `${design.split.heads.length} indoor heads`}
        </span>
      </div>

      <div className="max-h-136 overflow-auto p-3">
        <div className="relative inline-block">
          {isPdf ? (
            <canvas ref={canvasRef} className="block max-w-none bg-white" aria-label="Floor plan" />
          ) : (
            imgSrc && (
              // eslint-disable-next-line @next/next/no-img-element -- blob URL of a user upload
              <img src={imgSrc} alt="Floor plan" className="block max-w-none bg-white" style={{ width: 1200 }} />
            )
          )}

          {/* Geometry layer — stretched percent space; strokes stay 1:1. */}
          <svg
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            className="absolute inset-0 h-full w-full"
            aria-label={`Indicative ${system} layout over the floor plan`}
            role="img"
          >
            {rooms.map((room) => {
              const zone = room.load_type
              return (
                <polygon
                  key={room.name}
                  points={pointsAttr(room.polygon)}
                  fill={zone ? ZONE_FILL[zone] : 'transparent'}
                  stroke={zone ? ZONE_STROKE[zone] : 'rgba(120,130,150,0.6)'}
                  strokeWidth={zone ? 1.5 : 1}
                  strokeDasharray={zone ? undefined : '3 3'}
                  vectorEffect="non-scaling-stroke"
                />
              )
            })}
            {system === 'ducted' &&
              design.ducted.runs.map((run) => (
                <line
                  key={`run-${run.room}`}
                  x1={run.from.x}
                  y1={run.from.y}
                  x2={run.to.x}
                  y2={run.to.y}
                  stroke="#ff6b35"
                  strokeWidth={2}
                  strokeDasharray="6 4"
                  vectorEffect="non-scaling-stroke"
                  opacity={0.8}
                />
              ))}
          </svg>

          {/* Markers + volumetric labels (positioned divs keep their shape). */}
          {system === 'ducted' ? (
            <>
              {design.ducted.outlets.map((o) => (
                <Marker key={`out-${o.room}`} x={o.at.x} y={o.at.y} label="vent" colour="#ff6b35" />
              ))}
              <Marker
                x={design.ducted.unit.x}
                y={design.ducted.unit.y}
                label="roof unit"
                colour="#ffbe0b"
                square
              />
              <Marker
                x={design.ducted.return_air.x}
                y={design.ducted.return_air.y}
                label="return air"
                colour="#3a86ff"
                square
              />
              <Marker
                x={design.ducted.outdoor.x}
                y={design.ducted.outdoor.y}
                label="outdoor"
                colour="#06d6a0"
                square
              />
            </>
          ) : (
            <>
              {design.split.heads.map((h) => (
                <Marker key={`head-${h.room}`} x={h.at.x} y={h.at.y} label={`${h.kw} kW`} colour="#2ec4b6" square />
              ))}
              <Marker
                x={design.split.outdoor.x}
                y={design.split.outdoor.y}
                label="outdoor"
                colour="#06d6a0"
                square
              />
            </>
          )}

          {/* Per-room volumetric working, anchored at each room centroid. */}
          {rooms
            .filter((r) => r.load_type !== null)
            .map((room) => {
              const c = polygonCentroid(room.polygon)
              const load = loadByName.get(room.name)
              return (
                <div
                  key={`label-${room.name}`}
                  className="pointer-events-none absolute -translate-x-1/2 px-1.5 py-0.5 text-center"
                  style={{
                    left: `${c.x}%`,
                    top: `${Math.min(96, c.y + 5)}%`,
                    backgroundColor: 'rgba(10, 15, 30, 0.78)',
                  }}
                >
                  <span className="block font-mono text-[0.6rem] font-bold uppercase tracking-wide text-white">
                    {room.name}
                  </span>
                  <span className="block whitespace-nowrap font-mono text-[0.55rem] text-white/80">
                    {load
                      ? `${room.area_m2} m² × ${ceilingHeightM} m = ${load.volume_m3} m³ → ${load.kw} kW`
                      : `${room.area_m2} m²`}
                  </span>
                </div>
              )
            })}

          {rendering && (
            <div className="absolute inset-0 flex items-center justify-center bg-ink-deep/60">
              <span
                className="inline-block h-5 w-5 animate-spin border-2 border-white/40 border-t-white"
                aria-hidden="true"
              />
            </div>
          )}
        </div>
        {error && <p className="mt-2 text-sm text-warning">{error}</p>}
      </div>

      <div className="flex flex-col gap-2 border-t border-ink-line px-4 py-3">
        {system === 'ducted' && design.ducted.zones.length > 0 && (
          <p className="font-mono text-xs text-text-dim">
            {design.ducted.zones
              .map((z) => `${z.name}: ${z.rooms.join(', ')}`)
              .join(' · ')}
          </p>
        )}
        {warnings.map((w) => (
          <p key={w} className="text-xs leading-relaxed text-amber-500">
            {w}
          </p>
        ))}
        <p className="text-[0.68rem] leading-snug text-text-dim">
          Indicative layout drawn by deterministic geometry from the plan read — duct routes, vent
          and head positions are confirmed at the site assessment.
        </p>
      </div>
    </div>
  )
}
