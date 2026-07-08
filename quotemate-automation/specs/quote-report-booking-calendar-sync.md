# Quote report viewer, booking funnel, and calendar sync — fix Jon's three breakages

## Title

Restore the styled quote report for all five trades, make the accept → book → pay → confirmation
journey land the slot on the tradie calendar, and make the Calendar tab show every
customer-scheduled booking (including roofing/painting trade-surface bookings).

## Goal

A tradie opens any roofing / solar / painting / commercial-painting / electrical quote from the
dashboard and sees the styled full report without errors; a customer who accepts a quote picks a
slot, pays, lands on a confirmation that shows the booked time, and that booking appears on the
tradie's Calendar tab — measured by the acceptance tests and a live Playwright drive of both flows.
Why: Jon (pilot tradie, tenant `829702af` Atomic Electrical) is testing the platform right now and
all three surfaces fail for him; live rows prove it (3 paid inspections with no slot synced,
roofing/painting bookings invisible to the calendar).

## Role

Principal engineer on QuoteMate. Act directly on reversible edits; smallest root-cause diff that
holds; no new abstractions. Confirm before destructive/hard-to-reverse actions. TDD each
requirement (Red → Green), then verify the real flows.

## Context (all claims grounded in code opened during investigation)

**App**: `quotemate-automation/` — Next.js 16 App Router. Gates: `npm test` (vitest),
`npm run typecheck` (tsc --noEmit; there is NO `npm run check`), `npm run test:e2e` (playwright).
Live Supabase is prod — verification scripts must be read-only or create-then-delete their own rows,
and must never trigger SMS sends (only the Stripe webhook path sends SMS).

**Problem 1 — report viewer (all five trades).** `FULL_QUOTE_DOC=true` (.env.local) makes the
committed HEAD of `app/dashboard/quote/[token]/QuoteReportViewerClient.tsx` mount the TipTap
`QuoteDocumentWorkspace` for every owner-editable trade (`showWorkspace = !!docEditorEnabled && canEdit`),
replacing the styled report with a hollow, unstyled document (its `qm-*` CSS exists only in the dev
harness `app/dev/doc-editor/page.tsx:63-90`). An **uncommitted working-tree fix already exists**:
`lib/quote/report-adapters/types.ts` widens `EditorKind` with `'block-doc'`,
`page.tsx:90` passes `adapter.editorKind`, the client gates
`showWorkspace = !!docEditorEnabled && canEdit && editorKind === 'block-doc'`
(QuoteReportViewerClient.tsx:123), no adapter returns `'block-doc'`
(`lib/quote/report-adapters/registry.ts:44`), and `registry.test.ts:34-42` pins that. All 10
touched tests pass. `quotes.report_doc` is NULL on all 216 live quotes, so `lib/quote/pdf.ts:290`'s
flag branch never fires — customer PDFs were never corrupted. This fix is part of this task's
deliverable (it must be kept, covered by tests, and committed with the rest).

**Problem 2 — booking funnel.** Core quotes flow is book-first / pay-last (`lib/quote/booking.ts`):
`/q/[token]` CTAs → `/r/[token]/[tier]` → `payRedirectTarget()` → `/q/[token]/book` (SlotPicker
POSTs `{slot, tier}` to `/api/q/[token]/book`, which writes `quotes.scheduled_at`,
`scheduled_window`, `booking_state='reserved'` at route.ts:181-195) → back through `/r` → Stripe.
The webhook (`app/api/stripe/webhook/route.ts:218-227`) claims `paid_at` (conditional on
`paid_at IS NULL`), then finalises `booking_state='booked'` + `status='accepted'` when a slot exists
(:281-290). **Two defects:**
- The `'inspection'` tier bypasses book-first: `payRedirectTarget` returns `'stripe'` for it
  (booking.ts:50), so the $99 inspection payer pays with no slot; Jon's §6 workflow explicitly
  wants slot-selection before payment ("selects a time slot… enters payment information").
  Live evidence: quotes paid 2026-07-04/07/08, `paid_tier='inspection'`, `scheduled_at NULL`,
  `booking_state='reserved'`.
- Webhook race on `/q/[token]/paid`: the page (paid/page.tsx) gates the booked confirmation
  (`isBooked`, :170) and the "Pick a time" CTA (`showBookCta`, :175) on `quote.paid_at`, which only
  the async webhook writes. It receives `session_id` in searchParams (:116, success_url is
  `/q/${shareToken}/paid?tier=…&session_id={CHECKOUT_SESSION_ID}` — lib/stripe/checkout.ts:146,261,372)
  but never reads it. A customer landing before the webhook sees no CTA/confirmation and leaves.
  Also the "What's booked" card (:255-260) has no date/time row even when booked.

**Problem 3 — Calendar tab.** `GET /api/tenant/calendar` (route.ts:126-186) reads ONLY the `quotes`
table (events = scheduled_at in [now−90d, now+120d]; toSchedule = paid+unscheduled ≤180d;
awaitingBooking = unpaid inspection-routed ≤120d). But roofing/painting bookings live on
**`roofing_measurements` / `painting_measurements`**: the webhook writes their `paid_at` (:34-70
painting, :79-113 roofing, early-return :180-183 never touching quotes) and
`/api/q/book/[trade]/[token]/route.ts:98-101` writes their `scheduled_at`/`scheduled_window`
(table map `lib/quote/trade-booking.ts:15-18`). Live rows the calendar cannot show: roofing 2
scheduled + 3 paid (1 paid+unscheduled), painting 1 scheduled + 1 paid. Both tables have
`tenant_id, customer_name, customer_phone, address, public_token, paid_at, paid_tier, scheduled_at,
scheduled_window` (verified live; migrations 156/165/167). `solar_estimates` has NO
paid/scheduled columns — solar mirrors into `quotes` via `quote_id` with
`share_token = public_token` (`lib/solar/persist-helpers.ts:162`), so solar needs no calendar work.
`CalendarTab.tsx` (872 lines) fetches on mount with a bearer token and renders
events/toSchedule/awaitingBooking; rows link to the quote via shareToken.

**Solar edit defect (part of "all functionality must work correctly").** Solar quotes-row tiers are
`{label, subtotal_ex_gst}` with NO `line_items` (persist-helpers.ts:84-95); the registry grants
solar `manualEdit/aiEdit: true` (registry.ts:14, pinned by registry.test.ts), so Edit opens
`TradieEditor` with zero lines and Save sends `line_items: []`, failing
`TierEditSchema` `.min(1)` (app/api/quote/[id]/edit/route.ts:75) → raw 400 every time.

**Known-broken but OUT OF SCOPE (log, don't build):** the `/r/solar/[token]/[tier]` route is dead
code (selects nonexistent `solar_estimates.paid_at/scheduled_at/stripe_links`, filters on
nonexistent `token` column; nothing links to it; `/q/solar/[token]/book|paid` pages don't exist);
viewer fidelity gap (generic G/B/B template vs dedicated roof/solar PDFs); historical orphan
`tenant_id NULL` quotes; non-atomic slot prune; calendar auto-refresh/polling; same-day "Past"
split; residential `painting` never writes quotes rows (its dashboard uses dedicated
`/api/q/paint/[token]/pdf` links — nothing to fix in the viewer).

## Task

1. **R1 — Keep and cover the report-viewer fix.** Preserve the working-tree gating
   (`editorKind === 'block-doc'`) exactly as-is across
   `types.ts` / `registry.ts` / `page.tsx` / `QuoteReportViewerClient.tsx`; keep the registry test
   pinning that no live trade returns `'block-doc'`. Do not revert, do not extend the workspace.
2. **R2 — Calendar reads trade-surface bookings.** ⚠ Scope amendment (2026-07-08 17:05): a
   concurrent session in this working tree owns this via the repo-root spec
   `specs/calendar-trade-booking-sync.md` (a superset: same trade-table union, plus `href`,
   `tenantTz`, and timezone threading). Its failing tests already landed in
   `app/api/tenant/calendar/route.test.ts` (16:57). This run must NOT implement the calendar
   route/CalendarTab — at gate time verify their tests are green (their session implementing);
   only if their tests are still red AND their working tree has gone quiet may this run implement
   to their test contract. Do not modify their in-flight files: `app/dashboard/page.tsx`,
   `SavedJobsSection.tsx`, `saved-jobs-mode.*`, `quotes-refresh.*`, `recent-activity.*`, aircon,
   trade-jobs, quote-send/approve routes, `lib/email/resend.*`, `lib/sms/templates*`,
   `lib/quote/trade-booking.*`, `app/api/tenant/calendar/*`, `CalendarTab.tsx`.
3. **R3 — Inspection joins book-first.** In `lib/quote/booking.ts`, `payRedirectTarget` routes an
   unpaid inspection with no slot to `'book'` (slot → pay → confirmation), keeping `paid` checked
   first (re-charge guard comment at :44-46 stays true). Verify `/q/[token]/book` +
   `/api/q/[token]/book` accept `tier='inspection'` end-to-end (SlotPicker already POSTs the tier);
   fix minimally if any tier guard blocks it. Update `booking.test.ts` pins deliberately —
   this is a requirements change, record it in the test names/comments.
4. **R4 — Close the /paid webhook race.** When `/q/[token]/paid` loads with `session_id` and the
   quote has `paid_at IS NULL`, verify the Checkout Session server-side (Stripe
   `checkout.sessions.retrieve`; `payment_status === 'paid'`) and perform the same idempotent
   claim + finalise the webhook does (extract the webhook's claim/finalise into a shared helper —
   ONE code path, no duplication; the webhook's SMS/slot-prune side effects must not double-fire
   when the webhook lands later — the conditional `paid_at IS NULL` claim is the guard).
5. **R5 — Post-payment navigation.** After R4's authoritative read: paid + no `scheduled_at` →
   server `redirect()` to `/q/[token]/book` (Jon: "automatically navigate to the booking
   section"); paid + scheduled stays on /paid showing the booked confirmation. Add a date/time row
   to the "What's booked" card when `scheduled_at` is set.
6. **R6 — Solar quotes editable without 400.** Root-cause fix at the shared boundary: a tier with
   no `line_items` materialises a single seeded line (label from the tier label, price =
   `subtotal_ex_gst`) so the editor opens non-empty and Save round-trips the same subtotal
   (edit route recomputes subtotal from lines — seed must equal it). Place the seed where all
   editor callers route through (TradieEditor materialise or the viewer's `toDocTier`-equivalent
   boundary — pick the single choke point), not per-page.
7. **R7 — Viewer never dead-ends on inspection quotes.** The Overview list links inspection-routed
   quotes into the viewer (app/dashboard/page.tsx:2502-2508); the toolbar "Download PDF" hits
   `/api/q/[token]/pdf` which 404s JSON for `needs_inspection` (pdf/route.ts:37-42). Hide or
   disable the Download button for inspection quotes (the HTML body already shows a graceful
   placeholder).
8. Run every gate each iteration; commit only when the completion bar is met (single commit of
   working tree including the pre-existing R1 fix is fine — it is part of this deliverable).

## Constraints

- Smallest diff that fixes each root cause; no new tables, no new deps, no refactors beyond the
  shared webhook-claim helper R4 requires.
- Money-path discipline: R4's claim must stay conditional (`paid_at IS NULL`) and idempotent
  against webhook double-fire; never mint or complete Stripe sessions in tests — mock the Stripe
  SDK (existing route tests mock Supabase; follow `app/api/tenant/calendar/route.test.ts` style).
- Live DB is production: tests must not hit it (mock supabase clients as existing tests do);
  manual verification may read freely but only write rows it creates and deletes.
- Do not touch: `/r/solar` dead route, dedicated trade PDF routes, the TipTap workspace internals,
  strategy docs. Do not reintroduce the retired navy/orange design system on any UI touched.
- `quotes.trade` does not exist — trade comes from the intake join (page.tsx:44-47) or the trade
  table itself. Don't select it off `quotes`.
- Next 16: read `node_modules/next/dist/docs/` guidance before touching route handlers/pages
  (`params` is a Promise; `redirect()` from `next/navigation` in server components).
- AU English in all UI copy; no emoji.

## Acceptance criteria & gates

Tests to write first (Red), then make pass (Green):

- **A1 (R1)**: existing `registry.test.ts` guard stays green; viewer client renders the iframe
  (not the workspace) for all five trades when `FULL_QUOTE_DOC=true` — covered by the registry
  editorKind pin (component-level test optional if a cheap render test exists to imitate).
- **A2 (R2)**: satisfied by the concurrent session's tests in
  `app/api/tenant/calendar/route.test.ts` (trade-visits describe block) being green at gate time —
  verify presence + green, do not author.
- **A3 (R3)**: `booking.test.ts` — unpaid inspection + no slot → `'book'`; unpaid inspection +
  slot → `'stripe'`; paid inspection → `'paid'` (re-charge guard).
- **A4 (R4)**: paid-page (or extracted helper) test — session_id present + `payment_status='paid'`
  + `paid_at IS NULL` → claim runs once (conditional update called with `.is('paid_at', null)`);
  webhook arriving second is a no-op on already-claimed rows (existing webhook behaviour, assert
  via the shared helper's conditional).
- **A5 (R5)**: /paid render logic — paid + unscheduled → redirect to `/q/[token]/book`; paid +
  scheduled → stays, shows date/time row in "What's booked".
- **A6 (R6)**: edit path test — tier `{label:'Solar system', subtotal_ex_gst: 12000, line_items: undefined}`
  opens as one seeded line totalling 12000; saving it round-trips subtotal unchanged through
  `TierEditSchema`.
- **A7 (R7)**: viewer toolbar — `needs_inspection` quote renders no active "Download PDF" action.

Gates (every iteration, none reported without running):

```
npm test            # vitest, full suite — must pass (baseline captured before changes)
npm run typecheck   # tsc --noEmit — must pass
```

End-to-end (/verify with playwright-cli against `npm run dev`):
- Dashboard → Calendar tab shows the live roofing/painting bookings (tenant with trade rows) and
  existing quote events; no error banner.
- Dashboard → open a solar and a roofing quote in `/dashboard/quote/[token]` → styled report
  iframe renders, Edit opens with ≥1 line for solar, no console errors.
- Customer flow on a disposable test quote row (created then deleted by the verification script):
  `/r/<token>/inspection` redirects to `/q/<token>/book`; picking a slot returns
  `next=/r/<token>/inspection`; `/q/<token>/paid?tier=inspection` with the row marked paid +
  scheduled shows the booked confirmation with the date/time row; with paid + unscheduled
  redirects to `/book`.

Completion bar: all gates pass + /verify confirms the flows + /review and /code-review report no
blocker/major findings.

## Examples

<example>
`app/api/tenant/calendar/route.test.ts` (mocked-Supabase route-test style to imitate for A2/A4 —
chained-builder mock returning canned `{ data, error }` per query, asserting tenant_id filters).
</example>

<example>
`lib/quote/booking.ts` + its `booking.test.ts` (pure funnel functions with exhaustive table-style
tests — the pattern R3 extends; the ORDERING comment at :44-46 is the invariant A3 re-pins).
</example>

<example>
`app/api/stripe/webhook/route.ts:218-227` (the conditional `.is('paid_at', null)` claim — R4's
shared helper is extracted FROM this code, not written fresh).
</example>

<example>
Migration 167 (`sql/migrations/167_*.sql`, roofing/painting `scheduled_at`+`scheduled_window`) —
the columns R2 reads; no new migration is needed for this task.
</example>
