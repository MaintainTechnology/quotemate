# Quotes tab — Saved Jobs redesign + sort + delete (2026-07-02)

## Problem

The Quotes tab's "Saved jobs · roofing · solar · painting" strip (old inline
`TradeJobsSection` in `app/dashboard/page.tsx`) rendered an unsorted 2-column
grid mixing four trades with no hierarchy, no categorisation, no way to remove
stale drafts, and it pushed the main quote list below the fold. The main
quote list had status filters but no sort control and no delete.

## Design

### 1. `app/dashboard/_components/SavedJobsSection.tsx` (new)

Extracted + redesigned replacement for the inline strip. Same data contract
(`GET /api/tenant/trade-jobs`, bearer token, renders nothing until ≥1 job):

- **Category pills with live counts** — All · Roofing · Solar · Painting ·
  Commercial paint (only trades that actually have jobs).
- **Sort select** — Newest first / Oldest first / Address A–Z / Needs action
  (drafts → inspection → confirmed).
- **Trade-grouped single-column list** — mono uppercase group headers with
  counts; each group previews 5 rows with a "Show all N" toggle.
- **Row anatomy** — trade badge · address · headline · status pill · date ·
  "View →" (customer page, new tab) · trash icon.
- **Two-step inline delete** — trash arms the row ("Delete this job?" +
  Delete/Cancel), optimistic removal, error banner on failure.

### 2. `DELETE /api/tenant/trade-jobs` (route extended)

- Body `{ trade, id }`; trade validated against a fixed allowlist map
  (roofing → `roofing_measurements`, solar → `solar_estimates`, painting →
  `painting_measurements`, commercial-painting → `paint_runs`) — table names
  are never built from input.
- Bearer → user → `tenants.owner_user_id` lookup (same ladder as GET).
- Tenant-scoped **hard delete** (`.eq('id').eq('tenant_id')`); safe because no
  FK references any of the four tables (checked init.sql + migrations
  081/089/100/107). `.select('id')` distinguishes 404 (no matching row —
  cross-tenant or stale) from success.
- GET per-table limit raised 20 → 100 so the tab shows all saved jobs.

### 3. `DELETE /api/quote/[id]` (new route)

Mirrors `POST /api/quote/[id]/edit`'s auth ladder: 401 no/invalid bearer,
404 unknown quote, 403 `tenant_id IS NULL` (legacy unscoped), **409 paid**
(`paid_at` set — immutable, same as edit), 403 non-owner. Hard delete is safe:
every FK on `quotes` is `on delete cascade` (payments, quote_followup_events)
or `set null` (`solar_estimates.quote_id`).

### 4. `QuotesTab` in `app/dashboard/page.tsx`

- **Sort select** in the filter rail — Newest / Oldest / Highest value /
  Lowest value (`compareQuotes`; unpriced/inspection quotes sink on value
  sorts). Changing sort resets pagination.
- **Delete on each quote card** — `DeleteQuoteButton` (two-step confirm) in
  the expanded actions row, hidden once a deposit is paid. `QuotesTab` tracks
  a local `deletedIds` set so the card, the stat band, and the filter counts
  all update without re-fetching `/api/tenant/me`.
- Card action links now gate individually on `url` so Delete is available
  even for quotes with no share token.

## Tests

- `app/api/tenant/trade-jobs/route.test.ts` — 10 tests: GET auth gating +
  summary mapping; DELETE auth, allowlist, id/tenant_id filtering, 404 on
  cross-tenant.
- `app/api/quote/[id]/route.test.ts` — 7 tests: the full auth ladder + the
  happy path asserting the delete is filtered by id AND tenant_id.
- Mock strategy: `@supabase/supabase-js` mocked at the module boundary with a
  chainable recording builder (same spirit as
  `app/api/tenant/historical-quotes/routes-isolation.test.ts`).

## Non-goals

- No new tables/migrations (deletes are hard deletes against existing rows).
- Signage/aircon/estimator artifacts stay on their own tabs — they are tools,
  not customer quote jobs; the four trade-job tables + the quotes table cover
  every customer-facing quote.
- No change to `/api/tenant/me` or the quote pipeline.
