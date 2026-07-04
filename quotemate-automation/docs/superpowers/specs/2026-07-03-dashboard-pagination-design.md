# Dashboard pagination — design

**Date:** 2026-07-03
**Status:** Approved (build)

## Problem

Several dashboard tabs render long, unbounded lists of cards that require
excessive scrolling. Two tabs (Quotes, Chats) use an ad-hoc "Load more"
reveal (`LIST_PAGE_SIZE = 10`); the rest (Follow-ups, Historical Quotes,
Files, the trade hubs, etc.) render the whole list at once. There is no
consistent paging UX.

## Goal

One consistent **numbered pagination** control (Prev · 1 2 3 · Next),
**10 items per page**, applied to every long-list tab. Replace the existing
"Load more" pattern so the whole dashboard behaves the same way. The current
page is **persisted in the URL** so it survives refresh and is shareable.

## Shared primitive — `app/dashboard/_components/Pagination.tsx`

Pure helpers (unit-tested, no DOM):

- `clampPage(page, totalPages)` → integer in `[1, totalPages]`.
- `pageSlice(items, page, pageSize)` → the current page's items.
- `getPageWindow(page, totalPages)` → array of page numbers / `'…'` ellipses
  for the control (e.g. `[1, '…', 4, 5, 6, '…', 12]`). Always shows first,
  last, current, and one neighbour each side.
- `PAGE_SIZE = 10` constant.

Hook:

- `usePagination(items, { urlKey?, pageSize = 10, resetKey? })` returns
  `{ page, setPage, totalPages, pageItems, startIndex, endIndex, total, pageSize }`.
  - **URL persistence** (when `urlKey` given): initial page read from
    `window.location.search`; `setPage` writes `?<urlKey>=<n>` via
    `window.history.replaceState` (deletes the param on page 1). No Suspense
    boundary, no route re-render. Per-list `urlKey` avoids cross-tab collisions.
  - **Reset** to page 1 when `resetKey` changes (filter/search/sort), skipping
    the first mount so a deep-linked page is not clobbered.
  - **Clamp** down only when `total > 0` and `page > totalPages` (guards the
    load-time `total === 0` window so `?page=3` survives the async fetch).

Control:

- `<PaginationControls page totalPages onPageChange startIndex endIndex total unit? className? />`
  - Renders the "X–Y of N" count + Prev / windowed numbers / Next.
  - Styled with Maintain tokens: `border-ink-line bg-ink-card`,
    active page `bg-accent text-white border-accent`, disabled `opacity-40`,
    `min-h-[44px]` touch targets.
  - **Self-hides when `totalPages ≤ 1`** → safe no-op on short lists.

## Application

10 per page everywhere. Each list gets its own `urlKey`.

| Action | Tab / list variable | urlKey |
|---|---|---|
| Replace "Load more" | Quotes (`filtered`) | `q_page` |
| Replace "Load more" | Chats (`ChatsList` / `chats`) | `chat_page` |
| Replace reveal | Solar (`visibleEstimates` source list) | `solar_page` |
| Add | **Follow-ups** (`ordered`) | `fu_page` |
| Add | Historical Quotes (`quotes`) | `hq_page` |
| Add | Files (`docs`) | `files_page` |
| Add | Estimating (`list`) | `est_page` |
| Add | Roofing hub (`jobs`) | `roof_page` |
| Add | Painting hub (`jobs`) | `paint_page` |
| Add | Commercial-Painting history (`recentRuns`) | `cpaint_page` |
| Add | Estimator-Beta history (`history`) | `estb_page` |

Retire the now-unused `visible`/`setVisible` + `LIST_PAGE_SIZE` "Load more"
state on Quotes and Chats (keep `LIST_PAGE_SIZE` only if still referenced).

## Explicitly excluded (not "long lists of cards")

- **Overview** "latest 5" quotes/chats — deliberate summary, not a browse list.
- **Catalogue** — grouped-by-category reference view; numbered paging would
  break the grouping. Left grouped.
- **Recipes** job-baseline / job-line editors — active editing surfaces.
- Tiny config lists (Pricing books, Account state picker) — self-hide anyway.

## Behavior

- Filter / search change → back to page 1.
- Deleting or actioning the last row on a page → clamp back one page.
- The "X–Y of N" count replaces old "N of M shown" subtitles.
- No new history entries (uses `replaceState`), so back/forward is unaffected —
  matches the "survives refresh + shareable" goal without history spam.

## Testing

- Vitest unit tests for `clampPage`, `pageSlice`, `getPageWindow`.
- Manual verification via the dev-server preview: Follow-ups, Quotes, Chats
  paginate at 10/page; URL updates; filter resets to page 1; deep-link `?fu_page=2`
  loads on page 2.
- `tsc`/build passes.
