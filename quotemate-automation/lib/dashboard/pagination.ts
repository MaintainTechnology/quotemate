// ════════════════════════════════════════════════════════════════════
// Dashboard pagination — pure page math.
//
// Every long-list dashboard tab (Follow-ups, Quotes, Chats, Historical
// Quotes, Files, the trade hubs …) slices its already-fetched array into
// pages of PAGE_SIZE and renders one page at a time. The arithmetic lives
// here, DOM-free, so it is unit tested (pagination.test.ts) without a
// browser. The React hook + control in
// app/dashboard/_components/Pagination.tsx wrap these.
// ════════════════════════════════════════════════════════════════════

/** Items shown per page across every paginated dashboard list. */
export const PAGE_SIZE = 10

/** Number of pages needed for `total` items — never below 1 (an empty list
 *  still has a page 1 that renders the empty state). */
export function pageCount(total: number, pageSize: number = PAGE_SIZE): number {
  if (pageSize <= 0) return 1
  return Math.max(1, Math.ceil(Math.max(0, total) / pageSize))
}

/** Coerce an arbitrary page number into the valid `[1, totalPages]` range. */
export function clampPage(page: number, totalPages: number): number {
  const hi = Math.max(1, Math.floor(totalPages))
  if (!Number.isFinite(page)) return 1
  return Math.min(hi, Math.max(1, Math.floor(page)))
}

/** The slice of `items` belonging to `page` (1-based). */
export function pageSlice<T>(
  items: readonly T[],
  page: number,
  pageSize: number = PAGE_SIZE,
): T[] {
  const total = items.length
  const p = clampPage(page, pageCount(total, pageSize))
  const start = (p - 1) * pageSize
  return items.slice(start, start + pageSize) as T[]
}

/** 1-based inclusive "X–Y of N" bounds for the current page. When the list
 *  is empty both indices are 0 so the caller can render "0 of 0". */
export function pageBounds(
  page: number,
  pageSize: number,
  total: number,
): { startIndex: number; endIndex: number } {
  if (total <= 0) return { startIndex: 0, endIndex: 0 }
  const p = clampPage(page, pageCount(total, pageSize))
  const startIndex = (p - 1) * pageSize + 1
  const endIndex = Math.min(p * pageSize, total)
  return { startIndex, endIndex }
}

/** Up to this many pages are all shown as numbers; beyond it the control
 *  ellipsizes around the current page. */
const WINDOW_FULL_THRESHOLD = 7

/** Page numbers to render in the control, with '…' gaps. Lists every page
 *  when there are few of them; once past WINDOW_FULL_THRESHOLD it keeps the
 *  first, last, current and one neighbour each side, collapsing the rest to
 *  '…' (a lone hidden page is shown as its number instead).
 *
 *  e.g. getPageWindow(5, 12) → [1, '…', 4, 5, 6, '…', 12]
 *       getPageWindow(1, 5)  → [1, 2, 3, 4, 5] */
export function getPageWindow(
  page: number,
  totalPages: number,
): Array<number | '…'> {
  const last = Math.max(1, Math.floor(totalPages))
  if (last <= 1) return [1]
  if (last <= WINDOW_FULL_THRESHOLD) {
    return Array.from({ length: last }, (_, i) => i + 1)
  }
  const current = clampPage(page, last)
  const wanted = new Set<number>([1, last, current, current - 1, current + 1])
  const sorted = [...wanted].filter((p) => p >= 1 && p <= last).sort((a, b) => a - b)

  const out: Array<number | '…'> = []
  let prev = 0
  for (const p of sorted) {
    if (prev) {
      const gap = p - prev
      if (gap === 2) out.push(prev + 1) // a single hidden page → show it
      else if (gap > 2) out.push('…')
    }
    out.push(p)
    prev = p
  }
  return out
}
