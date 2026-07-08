# Tradie on-site quote viewing + editing for roofing and painting

## Goal

A signed-in tradie doing a site inspection can open the detailed tradie view of a roofing or
painting job from the dashboard or from the customer quote page, edit the quote's prices/scope,
and send the updated quote to the customer — restoring the workflow Jon described for
"126 Greens Road". Why: today those jobs dead-end on read-only customer pages, so the on-site
review-edit-resend loop is impossible.

## Role

Principal engineer on QuoteMate. Act autonomously; smallest diffs that reuse existing machinery
(the /p and /m tradie pages, the save-as-quote bridge, the dashboard quote viewer). Do not
redesign surfaces; restore reachability and unlock the guards that block Jon's flow.

## Context (grounded in code as of 2026-07-08 ~17:15)

**Painting** — full tradie surface exists but is unreachable and locked:
- `app/p/[token]/page.tsx` (tradie review page, keyed by `painting_measurements.estimate_token`)
  renders the full breakdown (`PaintResultView`), `EditQuotePanel`, and `SendToCustomerButton`.
  `EditQuotePanel` only renders when `!inspection && !released && editableTiers.length > 0`
  (page.tsx:127).
- `app/api/painting/save/route.ts` stamps `released_at` at insert (:68-71) for dashboard saves, and
  `app/api/painting/edit/[token]/route.ts` refuses released rows with 409 `already_sent`
  (:95-107) — so a dashboard-authored painting job is **never** editable.
- `estimate_token` is never surfaced in any list: `GET /api/tenant/trade-jobs` builds the painting
  href from `public_token` only (`/q/paint/…`, route.ts painting block), so dashboard cards open
  the read-only customer page. Once the tradie leaves /p there is no way back.
- `app/api/painting/release/[token]/route.ts` is idempotent and never re-texts (:70-71); first
  release sends via `sendPaintingQuoteToCustomer` in `after()` (:66). Eligibility comes from the
  pure `paintingReleaseEligibility` in `lib/painting/publish-gate.ts` (tested in
  `publish-gate.test.ts`).
- The painting PDF route renders on demand — no `pdf_path` cache exists under painting code
  (verified by grep), so edits need no PDF invalidation.
- Customer page `/q/paint/[public_token]` and customer SMS read `estimate.price.tiers` straight
  from the jsonb, so an in-place edit flows through automatically. A priced edit already re-mints
  the per-tier Stripe sessions (`edit/[token]/route.ts`:129-146).

**Roofing** — no tradie edit surface exists for the mainline flow:
- The measure flow auto-saves to `roofing_measurements` (NOT `quotes`) with two tokens:
  `public_token` (customer `/q/roof/[token]`, explicitly read-only) and `measure_token` (tradie
  `/m/[token]` — `MeasurementReview.tsx`, whose only mutations are structure include/exclude and a
  solar rescan via `PATCH /api/roofing/measurement/[token]`).
- `GET /api/tenant/trade-jobs` selects only `public_token` for roofing; `measure_token` is never
  returned, so dashboard cards open the read-only customer page.
- `POST /api/roofing/save-as-quote/route.ts` already converts a measurement payload into real
  `intakes` + `quotes` rows (share_token, good/better/best with line_items via `buildTierObjects`,
  tenant-scoped via `resolveTenantRequest`) and returns `/q/[share_token]`. It is only invoked from
  the measure page's optional button (`app/dashboard/roofing/measure/page.tsx` `onSendAsQuote`,
  ~:277-350, which flattens the multi-structure quote to combined tiers + primary structure). The
  created quote is NOT linked back to the measurement row (no linking column exists).
- The dashboard viewer `/dashboard/quote/[token]` + `QuoteReportViewerClient` already fully support
  roofing quotes rows: `getReportAdapter('roofing')` returns `manualEdit`/`aiEdit` true,
  `editorKind 'line-items'`, `groundingMode 'tradie-authored'`
  (`lib/quote/report-adapters/registry.ts`:14,35-47), and the viewer toolbar has Edit / Edit with
  AI / Download / Send to Customer.

**The "banner"**: `app/q/[token]/TradieEditor.tsx` renders a floating owner-only pill on the
pipeline customer page `/q/[share_token]` — it was never removed. Roofing/painting mainline jobs
never reach `/q/[share_token]`; their customer pages `/q/roof/[token]` and `/q/paint/[token]` have
**no** tradie affordance, which is why editing appears "removed" to Jon.

**Concurrent sessions (hard constraint)**: two other Ralph loops are live in this working tree:
- `0a499f2c` (repo-root state file) building `specs/quote-send-sms-email.md` — owns
  `app/dashboard/quote/[token]/SendQuotePanel.tsx`, `app/api/quote/[id]/send/**`,
  `app/api/quote/[id]/approve/**`, `lib/quote/send-customer.*`, `lib/email/resend.*`.
- `596eda44` (quotemate-automation state file) building
  `specs/quote-report-booking-calendar-sync.md` R1-R7 — owns `app/api/tenant/calendar/**`,
  `app/dashboard/_components/CalendarTab.tsx`, `lib/quote/booking.ts`, `app/q/[token]/paid/**`,
  `app/q/[token]/TradieEditor.tsx`, `app/dashboard/quote/[token]/QuoteReportViewerClient.tsx`,
  `lib/quote/report-adapters/**`, the Stripe webhook claim helper.
This spec must not modify any file in either list, must not edit either
`.claude/ralph-loop.local.md`, and full-suite test failures rooted in those files must be
attributed, not chased.

## Task

1. **R1 — trade-jobs API returns a tradie detail link.** In
   `app/api/tenant/trade-jobs/route.ts`: roofing block additionally selects `measure_token` and
   emits `tradieHref: '/m/' + measure_token` (null when absent); painting block additionally
   selects `estimate_token` and emits `tradieHref: '/p/' + estimate_token`. Other trades emit
   `tradieHref: null`. Extend the `TradeJobSummary` shape wherever it is typed. TDD: extend
   `app/api/tenant/trade-jobs/route.test.ts` (red first).
2. **R2 — SavedJobsSection renders it.** In
   `app/dashboard/_components/SavedJobsSection.tsx` row actions (existing "View →" anchor,
   ~:420-431), when `job.tradieHref` is present render an additional "Review & edit →" link
   (same styling family, target `_blank` not required — same tab is fine for a tradie action).
   Verified via browser (no component-test rig exists).
3. **R3 — tradie banner on the roofing/painting customer pages.** New route
   `GET /api/tenant/trade-jobs/owner-link` (query: `trade` = `roofing|painting`, `token` = the page's
   `public_token`; bearer auth via `resolveTenantRequest` like save-as-quote). It loads the
   measurement row by `public_token`, and only when `row.tenant_id` matches the resolved tenant
   returns `{ owner: true, tradieHref }` (`/m/[measure_token]` or `/p/[estimate_token]`);
   otherwise `{ owner: false, tradieHref: null }` (also for signed-out, unknown token, NULL
   tenant_id). Never expose the tradie token to non-owners. New client component
   `TradieJobBanner` (pattern: TradieEditor's floating pill, `fixed top-16 right-3 z-40`,
   portal not required if the page has no competing stacking context — check) mounted on
   `app/q/roof/[token]/page.tsx` and `app/q/paint/[token]/page.tsx`, showing
   "Tradie · Review & edit →" linking `tradieHref`. Auth token via `lib/auth/client-token`
   `getAuthToken()`. TDD: route test for owner-link (owner, wrong tenant, anonymous, unknown
   token, both trades).
4. **R4 — painting post-release edit.** Delete the `already_sent` 409 block in
   `app/api/painting/edit/[token]/route.ts` (:95-107) and its stale header-comment sentence; keep
   the inspection and `no_estimate` guards. In `app/p/[token]/page.tsx` render `EditQuotePanel`
   when `!inspection && editableTiers.length > 0` (drop `!released`). Confirm `EditQuotePanel`
   refreshes the page data after a successful save (add `router.refresh()` if missing). TDD: new
   `app/api/painting/edit/[token]/route.test.ts` — released row edit succeeds and persists;
   inspection row still 409s; price change still re-mints Stripe links (mock
   `createPaintingCheckoutSessions`).
5. **R5 — painting resend.** Extend `paintingReleaseEligibility` (`lib/painting/publish-gate.ts`)
   to `{ ok, stamp, send }` with an optional `resend` input: first release → stamp+send; already
   released + `resend` → send without stamping; already released without `resend` → current
   no-op. TDD in `lib/painting/publish-gate.test.ts` (red first). `POST
   /api/painting/release/[token]` accepts an optional JSON body `{ resend?: boolean }` (tolerate
   empty/absent body) and fires `sendPaintingQuoteToCustomer` in `after()` whenever
   `eligibility.send`. Verify `sendPaintingQuoteToCustomer` (`lib/painting/release.ts`) is safely
   re-callable on a released row; adjust minimally if it guards on unreleased state.
   `SendToCustomerButton.tsx`: in the released/sent state, show the "✓ Sent to customer" pill
   plus a secondary "Resend updated quote" button that POSTs `{ resend: true }` and shows a
   transient confirmation.
6. **R6 — roofing promote-to-editable-quote from /m.**
   a. Migration (next free `sql/migrations/NNN_*.sql`, additive only):
      `alter table roofing_measurements add column if not exists quote_id uuid; add column if not
      exists quote_share_token text;` plus the matching `scripts/run-migration-NNN.mjs` (copy the
      newest run-migration script's pattern) and apply it.
   b. Pure helper `buildSaveAsQuoteRequest(row)` in `lib/roofing/save-as-quote-helpers.ts` that
      flattens a stored `roofing_measurements` row (address/postcode/state, inputs, structures +
      `quote` jsonb + `included_indices`) into the existing `SaveRequestSchema` body — mirror the
      measure page's `onSendAsQuote` flattening. TDD unit test (red first).
   c. `POST /api/roofing/save-as-quote`: accept optional `measure_token`. If the referenced
      measurement row (matched by `measure_token` AND `tenant_id`) already has
      `quote_share_token`, return it with `{ ok: true, existing: true }` and insert nothing.
      After a fresh insert, best-effort update the measurement row's `quote_id` +
      `quote_share_token`. TDD route test.
   d. `/m/[token]/page.tsx`: select `quote_share_token` best-effort (separate query, tolerate a
      pre-migration DB — same pattern as /p's `released_at` read) and pass it plus the fields the
      payload builder needs into `MeasurementReview`.
   e. `MeasurementReview.tsx`: add an "Edit & send quote →" action. With a `quoteShareToken`
      prop → plain link to `/dashboard/quote/[quoteShareToken]`. Without → POST save-as-quote
      (bearer via `getAuthToken()`, body from `buildSaveAsQuoteRequest` + `measure_token`), then
      navigate to `/dashboard/quote/[shareToken]`. Signed-out/401 → inline "Sign in on the
      dashboard to edit" message.
   From the dashboard viewer, editing and Send to Customer already work for roofing quotes rows —
   do not touch the viewer.
7. Run all gates every iteration (see below); fix regressions before adding scope.

## Constraints

- Do NOT modify the concurrent-loop-owned files listed in Context, either ralph-loop state file,
  or anything under `app/api/tenant/calendar/`. Do not `git commit`, `git push`, or revert
  working-tree changes you did not make.
- Additive DB changes only; no destructive SQL. Migration applied via its script
  (`node --env-file=.env.local scripts/run-migration-NNN.mjs`).
- Keep the inspection-routed painting edit guard (`cannot_edit_inspection_quote`) — inspection
  jobs have no priced tiers; the on-site re-quote flow for them is out of scope.
- Do not add tradieHref for solar / aircon / commercial-painting (out of Jon's scope) beyond the
  `null` default.
- Do not build a roofing per-measurement price editor; promotion + the existing dashboard editor
  is the mechanism. Accepted consequence (document in code comment on the save-as-quote link-back):
  after promotion the quotes row is the canonical artifact the tradie edits and sends;
  `/q/roof/[public_token]` retains the original indicative numbers.
- Next.js 16: route `params` is a Promise; read `node_modules/next/dist/docs/` guidance before
  writing new routes/pages (per AGENTS.md).
- UI: Command Centre design system (charcoal `ink-*` tokens, `accent` yellow, Manrope/mono,
  square corners, uppercase mono labels, Australian English, no emoji).
- Delete any scratch files created along the way.

## Acceptance criteria & gates

Tests (all red-first where new behaviour is asserted):
1. `app/api/tenant/trade-jobs/route.test.ts`: roofing job row includes
   `tradieHref: '/m/<measure_token>'`; painting includes `'/p/<estimate_token>'`; missing tokens →
   `tradieHref: null`.
2. Owner-link route test: owner gets `{owner: true, tradieHref}` for both trades; anonymous /
   wrong-tenant / unknown-token / null-tenant rows get `{owner: false, tradieHref: null}` and no
   token leakage.
3. `app/api/painting/edit/[token]/route.test.ts`: released row edit → 200, estimate updated,
   Stripe links re-minted on price change; inspection row → 409 `cannot_edit_inspection_quote`.
4. `lib/painting/publish-gate.test.ts`: eligibility matrix incl. resend cases.
5. Painting release route test (or extend publish-gate coverage + a route test): body
   `{resend: true}` on a released row triggers a send and does not restamp `released_at`.
6. `lib/roofing/save-as-quote-helpers` unit test: `buildSaveAsQuoteRequest` produces a
   SaveRequestSchema-valid body from a stored row fixture (parse with the schema).
7. save-as-quote route test: `measure_token` link-back updates the measurement row; second call
   returns `existing: true` with the same share token and inserts nothing.

Gate commands (from `quotemate-automation/`), every iteration and at completion:
- `npm test` (vitest) — full suite green; failures rooted in concurrent-loop-owned files are
  attributed in the report, not chased.
- `npm run typecheck` (`tsc --noEmit`) — the repo has no `check` script; this is the equivalent.
- Browser verification via playwright-cli against `npm run dev`: (a) /p of a released painting row
  shows Edit + Resend, an edit round-trips and the customer page reflects it; (b) /m of a roofing
  row shows "Edit & send quote", promotion lands on /dashboard/quote/[token] with Edit enabled;
  (c) /q/paint and /q/roof show the tradie banner for the owner and not for an anonymous window;
  (d) Saved jobs cards show "Review & edit →".

## Examples

<example>
`app/p/[token]/page.tsx:62-75` — the best-effort separate `released_at` query that tolerates a
pre-migration DB; copy this pattern for reading `roofing_measurements.quote_share_token` in
`/m/[token]/page.tsx` (R6d).
</example>
<example>
`lib/painting/publish-gate.ts` `paintingReleaseEligibility` + `publish-gate.test.ts` — the pure
decision-helper-plus-route-consumer pattern R5 extends; keep the route thin and the matrix in the
helper.
</example>
<example>
`app/api/roofing/save-as-quote/route.ts:39-101` — `SaveRequestSchema`, the exact shape
`buildSaveAsQuoteRequest` must emit; `app/dashboard/roofing/measure/page.tsx` `onSendAsQuote`
(~:277-350) — the existing multi-structure → single-payload flattening to mirror.
</example>
<example>
`app/q/[token]/TradieEditor.tsx:456-478` — the owner-only floating tradie pill (visual + gating
reference for `TradieJobBanner`); `app/api/quote/[id]/check-owner/route.ts` — the owner-check
response shape to mirror in `/api/trade-jobs/owner-link`.
</example>
