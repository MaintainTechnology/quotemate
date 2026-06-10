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
}

// Distinct, plan-friendly pin colours (cycled by item index).
const PIN_COLOURS = ['#ff6b35', '#2ec4b6', '#e71d73', '#3a86ff', '#ffbe0b', '#8338ec', '#06d6a0', '#ef476f']

export function PlanOverlay({ file, items, selectedIdx, onSelect }: Props) {
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

  useEffect(() => {
    if (page === null && pinnedPages.length > 0) setPage(pinnedPages[0])
  }, [page, pinnedPages])

  // Render the selected page to the canvas. pdf.js is loaded lazily so the
  // dashboard bundle doesn't carry it until the viewer is actually shown.
  useEffect(() => {
    if (page === null) return
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
        setPageCount(doc.numPages)
        const pdfPage = await doc.getPage(Math.min(page, doc.numPages))
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
  }, [file, page])

  const pinsOnPage = useMemo(
    () =>
      items.flatMap((item, idx) =>
        (item.locations ?? [])
          .filter((l) => l.page === page)
          .map((l) => ({ idx, type: item.type, x: l.x, y: l.y })),
      ),
    [items, page],
  )

  if (pinnedPages.length === 0) {
    return (
      <p className="mt-4 border border-ink-line bg-ink-deep px-4 py-3 text-sm text-text-dim">
        No pin locations in this take-off — run the analysis again (newer runs include per-symbol pins) or use
        “Refine dense items”.
      </p>
    )
  }

  return (
    <div className="mt-5 border border-ink-line bg-ink-deep">
      <div className="flex flex-wrap items-center gap-3 border-b border-ink-line px-4 py-2.5">
        <span className="font-mono text-[0.66rem] font-semibold uppercase tracking-[0.14em] text-accent">
          Plan viewer
        </span>
        <label className="flex items-center gap-2 font-mono text-xs text-text-dim">
          Page
          <select
            value={page ?? ''}
            onChange={(e) => setPage(Number(e.target.value))}
            aria-label="PDF page"
            className="border border-ink-line bg-ink-card px-2 py-1 font-mono text-xs text-text-pri focus:border-accent focus:outline-none"
          >
            {pinnedPages.map((p) => (
              <option key={p} value={p}>
                {p}{pageCount ? ` / ${pageCount}` : ''}
              </option>
            ))}
          </select>
        </label>
        <span className="font-mono text-xs text-text-dim">
          {pinsOnPage.length} pin{pinsOnPage.length === 1 ? '' : 's'} on this page
          {selectedIdx !== null ? ` · showing: ${items[selectedIdx]?.type ?? ''}` : ' · click a row to highlight its pins'}
        </span>
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
            const colour = PIN_COLOURS[pin.idx % PIN_COLOURS.length]
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
