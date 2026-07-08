# Dashboard Overview + Quotes tabs: show all tenant quote activity, honest chat states, refresh-on-return

## Goal

Every quote or job the signed-in tradie generates — SMS/voice pipeline quotes in the `quotes` table AND measure-tool jobs saved by the trade tabs (roofing / solar / painting / commercial painting) — is visible on the Overview tab (Recent quotes, Needs your attention) and on the Quotes tab within one tab-switch, and the Recent-chats widget either shows the tenant's real conversations or an explicit retryable error — never a false "No conversations yet". Why: the pilot tradie (tenant "Sparky", 110 quotes + 12 recent measure-tool jobs) currently sees at most 20 quotes and zero measure-tool jobs on Overview, and an empty chats widget despite 30 conversations in the DB.

## Role

Principal engineer for this repo. Reason before acting; act with tools (don't just suggest); minimal diffs in the existing style of the file being touched; parallel independent tool calls. This spec is the contract for /build and /review — do not re-engineer it mid-run.

## Context (every claim verified against code / live DB on 2026-07-08)

- The tradie dashboard is one client component: `app/dashboard/page.tsx` (15,329 lines) with tabs (Overview, Quotes, Chats, trade hubs, …). All primary data comes from `GET /api/tenant/me`, fetched once at mount (`page.tsx:613-627`, `setData(json)`).
- **RC1 — 20-quote cap:** `/api/tenant/me` selects the newest **20** quotes (`app/api/tenant/me/route.ts:168-175`, `.limit(20)`). Live DB: tenant Sparky (`6dca084c…`, owns the screenshot number +61 468 048 422) has **110** quotes; the newest 20 are solar 7 / plumbing 7 / electrical 3 / comm-paint 2 / roofing 1. Consequence: trade hubs filter `data.quotes` by trade (`page.tsx:7899-7901`), so painting/aircon/signage/fencing hubs render **zero** quotes even though older ones exist; Overview "View all 20" undercounts.
- **RC2 — measure-tool jobs invisible outside their hub:** trade-tab tools persist OUTSIDE `quotes`: `roofing_measurements` (47 rows), `solar_estimates` (34), `painting_measurements` (13), `paint_runs` (9) — all correctly `tenant_id`-stamped (0 NULLs). They are served only by `GET /api/tenant/trade-jobs` (`app/api/tenant/trade-jobs/route.ts`, returns `TradeJobSummary { id, trade, address, headline, status: 'confirmed'|'inspection'|'draft', href, createdAt }`) and rendered ONLY inside the four matching trade hubs: `{savedJobsKey && <SavedJobsSection only={savedJobsKey}/>}` (`page.tsx:8159-8161`). The Overview tab and the cross-trade Quotes workspace (no `tradeFilter`) never fetch or render them. Aircon (`aircon_recommendations`: 0 rows), estimator (`plan_uploads`), signage and fencing have no saved-job summaries in `/api/tenant/trade-jobs` — out of scope (no data / no table).
- **RC3 — chats widget lies on failure:** OverviewTab lazily fetches `/api/tenant/chats` (`page.tsx:2570-2602`); any non-OK response or thrown fetch collapses to `[]`, which renders "No conversations yet." (`page.tsx:2954-2968`). Live DB check: the exact route query returns **30 conversations for Sparky**, and `lib/tenant/current.ts:112-124` email-fallback covers the dual-Clerk-instance case — so the route and data are healthy; an empty widget in production is a swallowed fetch failure (or stale deploy), not missing data. `SavedJobsSection.tsx:165` has the same silent-hide (`if (!res.ok) return`).
- **RC4 — staleness:** nothing refetches `/api/tenant/me` after mount — no window-focus or tab-switch refresh. (OverviewTab itself unmounts/remounts per tab switch, so its own lazy fetches do re-run; the parent-owned `data.quotes` does not.)
- Auth: dual Clerk/Supabase bearer resolved by `resolveTenantRequest` (`lib/tenant/from-request.ts`); client tokens minted fresh per request via `getAuthToken()` (`lib/auth/client-token.ts`).
- Tests: vitest (`pnpm test`), typecheck (`pnpm typecheck` = `tsc --noEmit`). Route tests mock supabase-js with a chainable builder recorded per query — imitate `app/api/tenant/calendar/route.test.ts`. Playwright e2e (`pnpm test:e2e`, port 3100) covers only unauthenticated pages; there is no Clerk storage-state. Best-effort authed e2e: mint a Clerk sign-in token via the backend API for Sparky's user and redeem with `signIn.create({ strategy: 'ticket' })`; if the env's Clerk instance doesn't own that user id, fall back to route-level verification.
- Design: reuse the exact class vocabulary already in the touched sections (font-mono uppercase labels, `border-ink-line bg-ink-card`, `overviewQuotePill` tones). Australian English, no emoji.

## Task

1. **Raise the quotes cap** in `GET /api/tenant/me`: `.limit(20)` → `.limit(100)` (`app/api/tenant/me/route.ts:175`). Add `// ponytail: 100-quote cap — server pagination when a tenant outgrows it`. (The per-conversation 60-message cap already bounds payload.)
2. **Overview shows measure-tool jobs.** In `OverviewTab`, lazily fetch `/api/tenant/trade-jobs` on mount (same pattern as the chats fetch at `page.tsx:2570-2602`). Merge trade jobs with `data.quotes` into the "Recent quotes" table feed: newest-first by `created_at`/`createdAt`, top 5. Implement the merge as a pure exported helper (new small module, e.g. `lib/dashboard/recent-activity.ts`) so it is unit-testable: quote rows keep their existing rendering; trade-job rows render trade badge (reuse `TRADE_LABEL`/`TRADE_BADGE` semantics), address or headline as the job label, channel column shows the trade tool (not SMS), value column shows the headline when it is a money figure else the headline text, status pill maps `confirmed → Accepted-tone`, `inspection → Site visit-tone`, `draft → Awaiting you-tone`, and the row links to `job.href` (new tab) when present.
3. **Needs your attention fallback.** When no `quotes`-table candidate matches (`page.tsx:2660-2664`), fall back to the newest trade job with `status === 'draft'`; its CTA links to `job.href`. Pure helper + test.
4. **Quotes workspace shows saved jobs.** In `QuotesTab` when `tradeFilter` is unset, render `<SavedJobsSection accessToken={accessToken} />` (all-trades mode) below the queue — extend the existing conditional at `page.tsx:8159-8161`.
5. **Honest error states.** In OverviewTab: track fetch failure separately from empty for BOTH the chats fetch and the new trade-jobs fetch. On failure render "Couldn't load — Retry" (a button that re-runs the fetch) instead of "No conversations yet." / silence. Do NOT touch `/api/tenant/chats` route logic (verified correct).
6. **Refresh on return.** In the dashboard parent, refetch `/api/tenant/me` in the background (no loading flash, keep old data until the new payload lands) on (a) window `focus`/`visibilitychange` and (b) switching the active tab to `overview` or `quotes` — throttled to at most once per 15 s. Extract the throttle decision as a pure helper for the test.
7. **Tests first (TDD)** per acceptance criteria below; then implement; run all gates each iteration.

## Constraints

- KPI money math stays `quotes`-table-based — measure-tool headlines mix units (m² vs $); do not fold them into Quoted/Converted/Conversion/Avg figures.
- Do not normalise trade tables into `quotes`, add migrations, or change `/api/tenant/trade-jobs` and `/api/tenant/chats` response shapes (additive columns on trade-jobs are allowed only if a task above requires them — none does).
- No new dependencies. No refactor of `page.tsx` beyond the sections named. Match surrounding comment/style conventions.
- Overview Recent-chats stays a preview (3 rows) — "all recent chats" lives in the Chats tab via "Open →" (already wired).
- Out of scope (flagged, do not fix): the 2026-07-08 03:35 conversation is stamped tenant Atomic (`829702af`) while the 03:56 quote it apparently produced is stamped Sparky (`6dca084c`) — possible cross-tenant stamping bug in the SMS pipeline; `viewed`-status quotes render as "Awaiting you" (pill vocabulary choice); signage/aircon/fencing/estimator persistence surfaces.
- Delete any scratch/diagnostic files created during the run.

## Acceptance criteria & gates

- **A1** Route test (`app/api/tenant/me/route.test.ts`, chainable-builder mock per calendar pattern): the quotes query is issued with `limit(100)` and stays `tenant_id`-scoped + `created_at` descending.
- **A2** Unit tests for the recent-activity merge helper: (i) quotes and trade jobs interleave strictly newest-first; (ii) result slices to 5; (iii) a trade job maps to {label from address/headline, tone from status per Task 2, href passthrough}; (iv) empty trade-jobs input reproduces today's quotes-only feed.
- **A3** Unit test: attention candidate = first in-review `quotes` row when one exists; else newest `draft` trade job; else null.
- **A4** Unit test for the chats/trade-jobs widget state helper: (loading, error, rows) → `loading` / `error` / `empty` / `list`; a fetch failure yields `error`, never `empty`.
- **A5** Test that the Quotes workspace (no `tradeFilter`) renders the all-trades SavedJobsSection and a trade hub still renders only its own (`only`) section — via the render-decision helper or component test.
- **A6** Unit test for the refresh throttle helper: second trigger within 15 s is suppressed; after 15 s it fires.
- **Gates (every iteration, run — never assume):** `pnpm test` passes; `pnpm typecheck` passes; /verify drives the changed flow end-to-end against `next dev` (Playwright: authed drive via Clerk sign-in token if the env's instance owns Sparky's user, else route-level verification with real HTTP + mocked bearer where feasible) and confirms: Overview Recent-quotes contains a measure-tool job row, Quotes workspace shows Saved jobs, chats widget shows rows or an explicit error state.
- **Completion bar:** all gates green + /review passes every requirement + /code-review reports no blocker/major findings.

## Examples

- <example>Lazy authed fetch pattern to copy for the trade-jobs fetch: OverviewTab's chats effect at `app/dashboard/page.tsx:2575-2602` (fresh `getAuthToken()` per request, `cancelled` guard, loading flag).</example>
- <example>Supabase route-test mock to imitate for A1: `app/api/tenant/calendar/route.test.ts:10-45` (vi.hoisted chainable builder recording `{op, args}` per table, `vi.mock('@supabase/supabase-js')`).</example>
- <example>All-trades saved-jobs rendering already exists: `SavedJobsSection` with `only` undefined groups by trade with pills (`app/dashboard/_components/SavedJobsSection.tsx:231-262`) — Task 4 just mounts it in the workspace branch.</example>
- <example>Status-pill vocabulary to reuse for trade-job rows: `overviewQuotePill` at `app/dashboard/page.tsx:2404-2416` (Accepted / Sent / Site visit / Awaiting you).</example>
