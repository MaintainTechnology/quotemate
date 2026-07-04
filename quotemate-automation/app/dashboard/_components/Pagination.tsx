'use client'

// ════════════════════════════════════════════════════════════════════
// Dashboard pagination — React hook + control.
//
// `usePagination` slices an already-fetched array into pages of 10 and
// (optionally) mirrors the current page into the URL via history.replaceState
// so it survives refresh and is shareable, without a Suspense boundary or a
// full-route re-render. `<PaginationControls>` renders the numbered control
// and self-hides on a single-page list. Pure page math lives in
// lib/dashboard/pagination.ts (unit tested).
// ════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  PAGE_SIZE,
  clampPage,
  getPageWindow,
  pageBounds,
  pageCount,
} from '@/lib/dashboard/pagination'

function readPageParam(key: string): number {
  if (typeof window === 'undefined') return 1
  const raw = new URLSearchParams(window.location.search).get(key)
  if (!raw) return 1
  const n = Number.parseInt(raw, 10)
  return Number.isFinite(n) && n > 0 ? n : 1
}

function writePageParam(key: string, page: number): void {
  if (typeof window === 'undefined') return
  const url = new URL(window.location.href)
  if (page <= 1) url.searchParams.delete(key)
  else url.searchParams.set(key, String(page))
  // replaceState (not push) — no history spam; back/forward is unaffected.
  window.history.replaceState(window.history.state, '', url)
}

export type UsePaginationResult<T> = {
  page: number
  setPage: (next: number) => void
  totalPages: number
  pageItems: T[]
  startIndex: number
  endIndex: number
  total: number
  pageSize: number
}

/**
 * Client-side pagination over an in-memory array.
 *
 * @param items    the full (already filtered/sorted) list
 * @param urlKey   query-param name to persist the page under (per-list, so
 *                 tab-switching never carries a stale page across lists)
 * @param pageSize items per page (default 10)
 * @param resetKey when this value changes the page resets to 1 — pass the
 *                 filter/search/sort inputs so narrowing the list starts over
 */
export function usePagination<T>(
  items: readonly T[],
  opts: { urlKey?: string; pageSize?: number; resetKey?: unknown } = {},
): UsePaginationResult<T> {
  const pageSize = opts.pageSize ?? PAGE_SIZE
  const { urlKey, resetKey } = opts

  const [page, setPageState] = useState<number>(() =>
    urlKey ? readPageParam(urlKey) : 1,
  )

  const total = items.length
  const totalPages = pageCount(total, pageSize)

  const setPage = useCallback(
    (next: number) => {
      const clamped = clampPage(next, pageCount(items.length, pageSize))
      setPageState(clamped)
      if (urlKey) writePageParam(urlKey, clamped)
    },
    [items.length, pageSize, urlKey],
  )

  // Reset to page 1 when the filter/search key changes — skipping first mount
  // so a deep-linked ?<urlKey>= page is preserved on load.
  const firstReset = useRef(true)
  useEffect(() => {
    if (firstReset.current) {
      firstReset.current = false
      return
    }
    setPage(1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey])

  // Once real data has loaded, clamp a now-out-of-range page (e.g. the last
  // row on the last page was actioned away). Guarded on total>0 so an async
  // fetch that starts empty doesn't wipe a deep-linked page before it arrives.
  useEffect(() => {
    if (total > 0 && page > totalPages) setPage(totalPages)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [total, totalPages])

  const safePage = clampPage(page, totalPages)
  const pageItems = useMemo(() => {
    const start = (safePage - 1) * pageSize
    return items.slice(start, start + pageSize) as T[]
  }, [items, safePage, pageSize])

  const { startIndex, endIndex } = pageBounds(safePage, pageSize, total)

  return {
    page: safePage,
    setPage,
    totalPages,
    pageItems,
    startIndex,
    endIndex,
    total,
    pageSize,
  }
}

const NAV_BTN =
  'inline-flex items-center justify-center min-h-[44px] min-w-[44px] px-3 border border-ink-line bg-ink-card text-text-sec font-mono text-[0.7rem] uppercase tracking-[0.14em] font-bold transition-colors hover:bg-ink-deep hover:text-text-pri disabled:opacity-40 disabled:pointer-events-none cursor-pointer'

const ACTIVE_BTN =
  'inline-flex items-center justify-center min-h-[44px] min-w-[44px] px-3 border border-accent bg-accent text-white font-mono text-[0.7rem] uppercase tracking-[0.14em] font-bold cursor-default'

/**
 * Numbered pagination control (Prev · 1 … 4 5 6 … 12 · Next) plus an
 * "X–Y of N" count. Renders nothing when everything fits on one page, so it
 * is a safe no-op on short lists.
 */
export function PaginationControls({
  page,
  totalPages,
  onPageChange,
  startIndex,
  endIndex,
  total,
  unit = 'items',
  className = '',
}: {
  page: number
  totalPages: number
  onPageChange: (page: number) => void
  startIndex: number
  endIndex: number
  total: number
  unit?: string
  className?: string
}) {
  if (totalPages <= 1) return null
  const pageList = getPageWindow(page, totalPages)

  return (
    <nav
      aria-label="Pagination"
      className={`mt-6 flex flex-col-reverse items-center justify-between gap-3 sm:flex-row ${className}`}
    >
      <p className="font-mono text-[0.65rem] uppercase tracking-[0.16em] text-text-dim tabular-nums">
        {total === 0 ? `0 ${unit}` : `${startIndex}–${endIndex} of ${total} ${unit}`}
      </p>
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          className={NAV_BTN}
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
          aria-label="Previous page"
        >
          Prev
        </button>
        {pageList.map((p, i) =>
          p === '…' ? (
            <span
              key={`gap-${i}`}
              aria-hidden="true"
              className="select-none px-1 font-mono text-[0.7rem] text-text-dim"
            >
              {'…'}
            </span>
          ) : (
            <button
              key={p}
              type="button"
              onClick={() => onPageChange(p)}
              aria-current={p === page ? 'page' : undefined}
              className={p === page ? ACTIVE_BTN : NAV_BTN}
              disabled={p === page}
            >
              {p}
            </button>
          ),
        )}
        <button
          type="button"
          className={NAV_BTN}
          onClick={() => onPageChange(page + 1)}
          disabled={page >= totalPages}
          aria-label="Next page"
        >
          Next
        </button>
      </div>
    </nav>
  )
}
