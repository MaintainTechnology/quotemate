'use client'

// Plan overlay viewer — renders one page of the uploaded plan PDF (pdf.js,
// client-side, nothing stored) and draws a pin for every counted symbol so the
// tradie can visually verify each line item against the drawing.
//
// Pins come from ExtractionItem.locations ({ page, x%, y% } from the take-off
// or the tiled refine pass). Selecting a row in the take-off table highlights
// that item's pins; everything else dims.

import { useEffect, useMemo, useRef, useState } from 'react'

export type PinLocation = { page: number; x: number; y: number }
export type PinItem = { type: string; locations?: PinLocation[] }

type Props = {
  file: File
  items: PinItem[]
  /** Index into `items` of the selected row, or null for "show all". */
  selectedIdx: number | null
  onSelect?: (idx: number | null) => void
  /**
   * Electrical take-offs demand pins (default). Document-centric callers
   * (commercial painting) pass false to browse a PDF with no pin data:
   * page navigation covers every page instead of only pinned ones.
   */
  requirePins?: boolean
}

import { vizAt } from '@/lib/dashboard/viz-palette'

// Pin colours cycle by item index off the shared categorical ramp
// (lib/dashboard/viz-palette.ts). The previous set — #3a86ff, #8338ec,
// #e71d73, #ef476f — was a generic bright rainbow that belonged to no design
// system and fought the warm charcoal canvas it sits on.

export function PlanOverlay({ file, items, selectedIdx, onSelect, requirePins = true }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [pageCount, setPageCount] = useState(0)
  const [page, setPage] = useState<number | null>(null)
  const [rendering, setRendering] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Pages that actually have pins, most-pinned first — the natural default view.
  const pinnedPages = useMemo(() => {
    const counts = new Map<number, number>()
    for (const item of items) {
      for (const loc of item.locations ?? []) counts.set(loc.page, (counts.get(loc.page) ?? 0) + 1)
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([p]) => p)
  }, [items])

  // Default page is DERIVED, not synced via an effect: the most-pinned
  // page when pins exist, page 1 for pinless document browsing.
  const effectivePage = page ?? pinnedPages[0] ?? (requirePins ? null : 1)

  // Render the selected page to the canvas. pdf.js is loaded lazily so the
  // dashboard bundle doesn't carry it until the viewer is actually shown.
  useEffect(() => {
    if (effectivePage === null) return
    let cancelled = false
    ;(async () => {
      setRendering(true)
      setError(null)
      try {
        const pdfjs = await import('pdfjs-dist')
        pdfjs.GlobalWorkerOptions.workerSrc = new URL(
          'pdfjs-dist/build/pdf.worker.min.mjs',
          import.meta.url,
        ).toString()
        const data = await file.arrayBuffer()
        const doc = await pdfjs.getDocument({ data }).promise
        if (cancelled) return
        setPageCount(doc.numPages)
        const pdfPage = await doc.getPage(Math.min(effectivePage, doc.numPages))
        const canvas = canvasRef.current
        if (!canvas || cancelled) return
        // Fit ~1600 CSS px wide — sharp enough to read symbols when zoomed.
        const base = pdfPage.getViewport({ scale: 1 })
        const scale = 1600 / base.width
        const viewport = pdfPage.getViewport({ scale })
        canvas.width = viewport.width
        canvas.height = viewport.height
        const ctx = canvas.getContext('2d')
        if (!ctx) return
        await pdfPage.render({ canvas, canvasContext: ctx, viewport }).promise
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'could not render the PDF page')
      } finally {
        if (!cancelled) setRendering(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [file, effectivePage])

  const pinsOnPage = useMemo(
    () =>
      items.flatMap((item, idx) =>
        (item.locations ?? [])
          .filter((l) => l.page === effectivePage)
          .map((l) => ({ idx, type: item.type, x: l.x, y: l.y })),
      ),
    [items, effectivePage],
  )

  if (requirePins && pinnedPages.length === 0) {
    return (
      <p className="rounded-card mt-4 border border-ink-line bg-ink-deep px-4 py-3 text-sm text-text-dim">
        No pin locations in this take-off — run the analysis again (newer runs include per-symbol pins) or use
        “Refine dense items”.
      </p>
    )
  }

  // Pin-driven callers page through pinned sheets; document browsing
  // (requirePins=false) pages through the whole file.
  const pageOptions =
    pinnedPages.length > 0
      ? pinnedPages
      : Array.from({ length: Math.max(pageCount, 1) }, (_, i) => i + 1)

  return (
    <div className="rounded-card mt-5 border border-ink-line bg-ink-deep">
      <div className="flex flex-wrap items-center gap-3 border-b border-ink-line px-4 py-2.5">
        <span className="font-mono text-[0.66rem] font-semibold uppercase tracking-[0.14em] text-accent">
          Plan viewer
        </span>
        <label className="flex items-center gap-2 font-mono text-xs text-text-dim">
          Page
          <select
            value={effectivePage ?? ''}
            onChange={(e) => setPage(Number(e.target.value))}
            aria-label="PDF page"
            className="rounded-ctl border border-ink-line bg-ink-card px-2 py-1 font-mono text-xs text-text-pri focus:border-accent focus:outline-none"
          >
            {pageOptions.map((p) => (
              <option key={p} value={p}>
                {p}{pageCount ? ` / ${pageCount}` : ''}
              </option>
            ))}
          </select>
        </label>
        {items.length > 0 && (
          <span className="font-mono text-xs text-text-dim">
            {pinsOnPage.length} pin{pinsOnPage.length === 1 ? '' : 's'} on this page
            {selectedIdx !== null ? ` · showing: ${items[selectedIdx]?.type ?? ''}` : ' · click a row to highlight its pins'}
          </span>
        )}
        {selectedIdx !== null && (
          <button
            type="button"
            onClick={() => onSelect?.(null)}
            className="font-mono text-xs font-semibold uppercase tracking-[0.12em] text-accent hover:text-accent-press"
          >
            Show all
          </button>
        )}
      </div>

      <div className="max-h-136 overflow-auto p-3">
        <div className="relative inline-block">
          <canvas ref={canvasRef} className="block max-w-none bg-white" aria-label="Plan sheet" />
          {pinsOnPage.map((pin, i) => {
            const colour = vizAt(pin.idx)
            const dimmed = selectedIdx !== null && pin.idx !== selectedIdx
            return (
              <button
                key={i}
                type="button"
                title={pin.type}
                onClick={() => onSelect?.(pin.idx)}
                className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-2 transition-opacity"
                style={{
                  left: `${pin.x}%`,
                  top: `${pin.y}%`,
                  width: dimmed ? 10 : 16,
                  height: dimmed ? 10 : 16,
                  borderColor: colour,
                  backgroundColor: dimmed ? 'transparent' : `${colour}55`,
                  opacity: dimmed ? 0.35 : 1,
                }}
              />
            )
          })}
          {rendering && (
            <div className="absolute inset-0 flex items-center justify-center bg-ink-deep/60">
              <span className="inline-block h-5 w-5 animate-spin border-2 border-white/40 border-t-white" aria-hidden="true" />
            </div>
          )}
        </div>
        {error && <p className="mt-2 text-sm text-warning">{error}</p>}
      </div>
    </div>
  )
}
