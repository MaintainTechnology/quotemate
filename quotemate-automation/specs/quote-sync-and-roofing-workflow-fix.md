# Quote sync + roofing workflow fix

> Consolidates the residual gaps left after specs/quotes-tab-sync.md,
> specs/dashboard-overview-quotes-sync.md,
> specs/quote-report-booking-calendar-sync.md and
> specs/tradie-onsite-quote-editing.md were built. Those specs' work is in the
> tree and passing; this spec covers what still diverges.

## Data-flow map (as built, 2026-07-09)

Two independent quote feeds back every dashboard view:

- **`GET /api/tenant/me`** — the `quotes` table (newest 100, tenant-scoped,
  all statuses, trade joined from `intakes`). Feeds the Quotes tab
  (client-side status filters all/review/sent/paid/inspect), the trade hubs,
  and the Overview KPIs/Recent-quotes merge. Refreshed at mount, after
  settings PATCH, and on return (focus/visibility/tab-switch, 15 s throttle
  via `shouldRefresh`); `key={tab}` remounts refetch on every tab switch.
- **`GET /api/tenant/trade-jobs`** — measure-tool jobs OUTSIDE the quotes
  table (`roofing_measurements`, `solar_estimates`, `painting_measurements`,
  `paint_runs`, `aircon_recommendations`). Feeds `SavedJobsSection` (Quotes
  tab + hubs) and the Overview merge (`mergeRecentActivity`).

Roofing workflow: measurement (`roofing_measurements`, `measure_token` /
`public_token`) → `/m/[token]` review → `POST /api/roofing/save-as-quote`
promotes it to an `intakes` + `quotes` row (status `draft`), stamping
`quote_id`/`quote_share_token` back on the measurement (migration 168) →
tradie edits at `/dashboard/quote/[share_token]`, customer accepts at
`/q/[share_token]` → `/r/[token]/[tier]` routes book-first
(`payRedirectTarget`) → `/q/[token]/book` records the slot
(`booking_state='reserved'`) → Stripe webhook / `/paid` page fallback run
`finalisePaidQuote` (atomic `paid_at IS NULL` claim) → calendar feed
(`GET /api/tenant/calendar`) shows the visit.

## The gaps this spec closes

- **R1 — Promoted roofing jobs double-render.** After save-as-quote, the same
  job exists in both feeds: a `quotes` card AND a saved-jobs measurement card
  (and twice in the Overview merge). Neither is marked as the other.
- **R2 — Promotion is not concurrency-safe.** The idempotency check is a
  read-then-insert (route header calls it "an optimisation, not a money
  guard"); two concurrent promotions of one measurement mint two quotes, and
  the unconditional link-back last-write-wins, orphaning one.
- **R3 — Deleting a promoted quote strands the measurement.** Migration 168
  has no FK; once R1 hides promoted measurements, deleting the quote
  (`DELETE /api/quote/[id]`) must un-promote the measurement or the job
  vanishes from every view.
- **R4 — SavedJobsSection staleness + silent-hide.** It fetches once per
  mount; the parent's `returnRefreshSignal` only reaches OverviewTab, so a
  window-focus return on the Quotes tab never refetches. A failed fetch
  renders as "no saved jobs" (`if (!res.ok) return`) — the RC3 silent-hide.
- **R5 — No e2e coverage of the roofing quote surface.** Existing e2e covers
  unauthenticated pages only (solar has a seeded-row pattern).

## Fixes

- **F1 (R1):** `GET /api/tenant/trade-jobs` roofing query adds
  `.is('quote_share_token', null)` — a promoted measurement's single source
  of truth is its `quotes` row (`/api/tenant/me`); the measurement card
  disappears from saved jobs and the Overview merge the moment promotion
  lands.
- **F2 (R2):** save-as-quote pre-generates the share token and **atomically
  claims** the measurement (`UPDATE … SET quote_share_token = <token> WHERE …
  AND quote_share_token IS NULL`, `.select('id')`) before any insert. Losers
  re-read and return the winner's token (`existing: true`); insert failures
  roll the claim back. The winner inserts its quote with the claimed token,
  then stamps `quote_id`.
- **F3 (R3):** `DELETE /api/quote/[id]` clears
  `quote_id`/`quote_share_token` on any roofing measurement linked to the
  deleted quote (matched by `quote_share_token`, best-effort), so the job
  resurfaces as an un-promoted saved job.
- **F4 (R4):** `SavedJobsSection` owns its freshness: a focus/visibility
  listener re-fetches through the same `shouldRefresh` 15 s throttle, and a
  failed initial fetch renders an explicit error card with Retry instead of
  nothing.

## Tests

- `app/api/tenant/trade-jobs/route.test.ts` — roofing query filters
  `quote_share_token IS NULL` (F1).
- `app/api/roofing/save-as-quote/route.test.ts` — claim-before-insert order
  and filters; **concurrency**: a lost claim returns the winner's quote with
  no `intakes`/`quotes` writes (final state = exactly one quote regardless of
  interleaving); claim rollback on insert failure (F2).
- `app/api/quote/[id]/route.test.ts` (new) — delete un-links the roofing
  measurement; unlink failure doesn't fail the delete (F3).
- `tests/e2e/roofing-quote-workflow.spec.ts` (new, seeded-row pattern with a
  throwaway tenant) — a promoted roofing quote renders on `/q/[share_token]`
  with tier pricing; the accept path (`/r/[token]/[tier]`) routes book-first
  to `/q/[token]/book`; the slot picker renders; and booking a slot (the
  same POST the picker fires — browser clicks are blocked in this dev env by
  mismatched Clerk dev-instance keys, which the server logs as an infinite
  handshake redirect loop) flips the quote to `booking_state='reserved'`
  with a `scheduled_at` (R5). Payment finalisation and the calendar feed
  remain covered by the existing vitest suites
  (`lib/quote/paid-confirm.test.ts`, `lib/quote/booking.test.ts`,
  `app/r/[token]/[tier]/route.test.ts`, `app/api/tenant/calendar/route.test.ts`).

## Review fixes (applied after /code-review)

- `releaseClaim()` logs loudly when the rollback itself fails (a stuck claim
  hides the job everywhere and leaves a dead idempotency link).
- Dead `SaveRequestSchema` alias removed.
- The five trade-jobs GET reads now run concurrently (`Promise.all`) — the
  endpoint is refetched on focus-return, so its latency matters.
- Roofing DELETE gained the paid-quote money guard solar/painting already
  had (a promoted measurement whose quote took a deposit is refused, 409).

## Gates

`pnpm test` green, `pnpm typecheck` clean, `pnpm test:e2e` green for the new
spec, `/code-review` + `/review` with no blocker/major findings.

## Out of scope (documented, pre-existing)

- Calendar tab realtime (manual Sync + refresh-on-return by design).
- Stripe `event.id` ledger for the cross-session double-charge window
  (acknowledged in the webhook route header).
- The 100-quote feed cap (ponytail-deferred server pagination).
- Solar `quotes.status` badge stuck at `draft` post-release
  (documented out-of-scope in specs/quotes-tab-sync.md).
- Self-serve booking-request `$0 draft` rows in the Quotes list.
- Solar's promoted-twin double-render (review finding, confirmed): every
  solar estimate creates BOTH a `solar_estimates` row and a token-twinned
  `quotes` row at creation time — there is no promotion step, so filtering
  `quote_id IS NOT NULL` out of trade-jobs would empty the solar hub's
  saved list entirely. Which surface owns solar is a product decision;
  roofing's rule (quotes row wins after promotion) does not transplant.
- Authed-dashboard e2e (no Clerk storage-state harness exists; dashboard
  behaviour is covered by unit/route tests per the prior specs' gates).
- ⚠ Discovered while building R5: the local dev env's Clerk keys are
  mismatched — the dev server logs "Refreshing the session token resulted in
  an infinite redirect loop … your Clerk instance keys do not match", and a
  fresh browser on any customer page bounces through an endless
  accounts.dev handshake, killing client-side interactivity. Fix the
  publishable/secret key pair in `.env.local` (production is unaffected;
  its keys are set in Vercel).
