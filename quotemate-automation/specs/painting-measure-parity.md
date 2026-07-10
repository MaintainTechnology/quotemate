# Painting measure flow parity with roofing: progress modal + imagery on /p/[token]

## Goal

When a tradie runs a paint estimate, a centred blocking progress modal shows until the
estimate is saved and its `/p/[estimate_token]` page opens; that page then shows the property's
Google Street View photo and a cached AI repaint image alongside an action row whose primary
"Open customer quote" button matches the roofing `/m/[token]` page — so the painting measure
experience is functionally and visually indistinguishable from roofing's.

Why: the tradie currently stares at a small button spinner for the full estimate+save round-trip,
and the `/p` review page has zero imagery, so they can't sanity-check the property before sending.

## Role

Principal engineer for this repo. Reason before acting; take real action with tools; read files
before describing them; parallel independent calls, sequential dependent ones; never guess params.

## Context (all grounded in code read on 2026-07-10)

**What already exists — do NOT rebuild:**

- The unique-URL flow is DONE. `app/dashboard/painting/page.tsx` `runEstimateCore` (:102–158)
  POSTs `/api/painting/estimate`; an auto-save effect (:224–228, guard
  `resp?.ok === true && saveState === 'idle' && !busy`) POSTs `/api/painting/save`, which mints
  `public_token` + `estimate_token` (`lib/painting/save-row.ts:104–105`,
  `randomBytes(16).toString('hex')`) and inserts into `painting_measurements` (migration 089;
  `estimate_token` from migration 151; `released_at` from 157 — stamped at save time for
  dashboard saves, i.e. dashboard rows are always released). On success the page does
  `router.push('/p/' + json.estimate_token)` (:197–204) — same-tab, exactly like roofing's
  `router.push('/m/' + measure_token)` (`app/dashboard/roofing/measure/page.tsx:387–392`).
- `/p/[token]` (`app/p/[token]/page.tsx`, 181 lines, server component, capability-token auth,
  `.eq('estimate_token', token)`) already has: "← Dashboard" link, title block, `PaintResultView`,
  `EditQuotePanel` (edit tiers) + `SendToCustomerButton` (send/resend = painting's "edit & send"),
  "Preview customer quote"/"Open customer quote" link (`:143–150`, outlined, `target="_blank"`,
  → `/q/paint/${public_token}`), "Download PDF" (`:151–160`, outlined, `target="_blank"`,
  → `/api/q/paint/${public_token}/pdf`, hidden for inspection routing), "New estimate", accent
  footer strip. Dark ink/accent token design matching `/m`.
- Roofing's modal `MeasureProgressModal` (`app/dashboard/roofing/measure/page.tsx:1087–1162`):
  rendered with `open={busy || (resp?.ok === true && saveState !== 'error')}` (:533–536); overlay
  `fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-6 outline-none
  backdrop-blur-sm`, card `rounded-card w-full max-w-lg border border-ink-line border-l-4
  border-l-accent bg-ink-card p-7 sm:p-9`, accent square spinner, `role="dialog"`
  `aria-modal="true"` `aria-busy="true"`, body-scroll lock + focus + Tab swallow, entrance
  keyframes with `prefers-reduced-motion` opt-out. Copy switches on `busy`.
- Roofing's tradie-page image (`app/m/[token]/page.tsx:212–222`): ONE plain `<img>` to the
  token-scoped proxy `/api/roofing/q/${row.public_token}/static-map` inside
  `border border-ink-line bg-ink-card` with a mono-caption strip.
- Roofing's action row (`app/m/[token]/MeasurementReview.tsx:283–319`): "Open customer quote" =
  FILLED accent (`bg-accent px-4 py-2.5 font-mono text-[0.72rem] font-semibold uppercase
  tracking-[0.14em] text-white hover:bg-accent-press`, `target="_blank"`), "Download PDF" +
  "Edit & send quote" = outlined (`border border-ink-line … text-text-sec hover:border-accent
  hover:text-accent`).
- Token-scoped image proxy pattern: `app/api/roofing/q/[token]/static-map/route.ts` (service-role
  client, `token.length < 8` → 400, `.eq('public_token', token).maybeSingle()` → 404, fetch
  Google server-side, stream bytes, `Cache-Control: public, max-age=86400, immutable`).
- Cached AI-image pattern: `app/api/roofing/q/[token]/after-image/route.ts` (`maxDuration = 60`;
  serve `preview_image_path` from bucket `intake-photos` when `preview_status === 'ready'`;
  billing gate — no Gemini render for unconfirmed rows; else generate via
  `lib/roofing/roof-after.ts` `generateRoofAfterImage`: CAS-claim `preview_status='generating'`,
  upload `roofing/<row.id>/after-<ts>.<ext>` to `intake-photos`, update
  `{preview_image_path, preview_status:'ready'}`, failure → `'failed'`; every error path falls
  back to a plain satellite image so the `<img>` never breaks).
- Painting image building blocks: `lib/painting/streetview.ts` (PURE:
  `buildStreetViewUrl`, `buildStreetViewMetadataUrl` — free existence check,
  `parseStreetViewMetadata`, `clampSize`, `redactKey`); `lib/painting/repaint-prompt.ts`
  (`buildRepaintPrompt({colour, scopes})`); `lib/ig-engine/providers/gemini.ts`
  (`geminiProvider.renderImage({system, user, sourceImage, aspectRatio})`). The bearer-authed
  `/api/painting/preview` is STATELESS (data URLs, no persistence) and cannot be used from the
  public `/p` page.
- `painting_measurements` has NO image columns today. Next migration number: **169**
  (168 = latest; DB changes = `sql/migrations/169_*.sql` + `scripts/run-migration-169.mjs`,
  pattern of `scripts/run-migration-168.mjs`).
- Dashboard queue detail `JobQueueDetail` (`app/dashboard/page.tsx`, pinned action bar): the
  primary CTA `{jobTradieCtaLabel(job)} →` links `job.tradieHref` (→ `/p/...` for painting)
  currently same-tab.
- Gates: `npm test` = `vitest run --testTimeout=20000` (node env, colocated
  `lib/**/*.test.ts`, explicit imports, fake-object/DI style — see `lib/quote/dedicated-page.test.ts`
  fake Supabase chain and `lib/painting/release.test.ts` DI+`vi.stubEnv`). `npm run typecheck` =
  `tsc --noEmit` (there is NO `npm run check`). `npm run test:e2e` = `playwright test`
  (`tests/e2e/`, public pages only, port 3100, seeded-row pattern with service-role insert in
  `beforeAll` + `test.skip(!seedable, …)` — see `tests/e2e/roofing-quote-workflow.spec.ts`).
  Authed-dashboard verification uses the `verify` skill (Clerk sign-in ticket + throwaway
  Playwright script), NOT the e2e suite.
- Next.js 16: read `node_modules/next/dist/docs/` before writing route/page code;
  `params` is a `Promise` in route handlers and pages.

**Explicit scope decisions (the dictation was ambiguous):**

- "Opens in a new tab": roofing navigates SAME-TAB after the modal (`router.push`), and painting
  already mirrors that. Keep same-tab (a `window.open` from an async effect is popup-blocked).
  The new-tab experience is delivered where it is user-initiated: the `/p` action-row links
  already `target="_blank"`, and R5 adds `target="_blank"` to the dashboard queue's primary
  "Estimate results →" CTA.
- "Google Images" = the Street View front-of-property photo (the natural painting analogue of
  roofing's satellite map; it is also the AI repaint's source frame). "AIG images" = the Gemini
  repaint "after" image, cached per row like roofing's after-image.
- Painting's "Edit and Send Quote" control is the existing in-page `EditQuotePanel` +
  `SendToCustomerButton` — richer than roofing's link-out. Keep them; do not link to the quotes
  editor.

## Task

1. **R1 — Progress modal on the painting estimate page.** Add a pure helper module
   `lib/painting/progress.ts` exporting `paintProgressOpen(args: {busy: boolean; respOk: boolean;
   saveState: 'idle'|'saving'|'saved'|'error'}): boolean` (true iff `busy || (respOk && saveState
   !== 'error')`) and `paintProgressTitle(busy: boolean): string` ("Estimating paintable area…" /
   "Saving estimate & opening its page…"). In `app/dashboard/painting/page.tsx`, add a
   `PaintProgressModal` component that is a painting-copy mirror of roofing's
   `MeasureProgressModal` (same overlay/card classes, a11y attrs, scroll lock, focus, Tab
   swallow, keyframes, reduced-motion), rendered with `open={paintProgressOpen(...)}` near the
   form. Description copy: "We're measuring the paintable area at this property and saving the
   estimate as its own job. You'll be taken to its results page to review and send the quote."
2. **R2 — Migration 169.** `sql/migrations/169_painting_preview_image.sql`:
   `alter table public.painting_measurements add column if not exists preview_image_path text,
   add column if not exists preview_status text;` plus `scripts/run-migration-169.mjs` following
   `scripts/run-migration-168.mjs`. Apply it to the live DB with
   `node --env-file=.env.local scripts/run-migration-169.mjs`. Keep `sql/init.sql` representative.
3. **R3 — Token-scoped Street View proxy.**
   `app/api/painting/q/[token]/street-view/route.ts` (GET): mirror
   `app/api/roofing/q/[token]/static-map/route.ts` — service-role client, `dynamic =
   'force-dynamic'`, `token.length < 8` → 400, resolve
   `painting_measurements.select('address, postcode, state').eq('public_token', token)` → 404
   when missing, 503 when `GOOGLE_MAPS_API_KEY` unset, free metadata pre-check
   (`buildStreetViewMetadataUrl` + `parseStreetViewMetadata` from `lib/painting/streetview.ts`,
   compose location as `"<address>, <postcode> <state>, Australia"`) → 404 `{code:'no_streetview'}`
   when no pano, else fetch `buildStreetViewUrl` and stream with
   `Cache-Control: public, max-age=86400, immutable`.
4. **R4 — Cached AI repaint image.**
   a. `lib/painting/paint-after.ts` mirroring `lib/roofing/roof-after.ts`:
   `generatePaintAfterImage(publicToken)` — read row (id, address, postcode, state, scopes,
   preview_image_path, preview_status), CAS-claim `preview_status='generating'` (update guarded
   on current status null/'failed'), fetch the Street View source server-side, build the prompt
   with `buildRepaintPrompt({colour: null, scopes: row.scopes})`, `geminiProvider.renderImage`
   with `sourceImage` + `aspectRatio:'4:3'`, upload to bucket `intake-photos` at
   `painting/<row.id>/after-<Date.now()>.<ext>`, update `{preview_image_path,
   preview_status:'ready'}`; any failure → `preview_status='failed'` and rethrow/return null.
   b. `app/api/painting/q/[token]/after-image/route.ts` (GET, `maxDuration = 60`): serve the
   stored image when `preview_status === 'ready' && preview_image_path` (download from
   `intake-photos`, `max-age=86400, immutable`); billing gate — when `released_at` is null, do
   NOT invoke Gemini (mirror roofing's confirmed_at gate; dashboard saves are always released):
   redirect/stream the Street View image instead with `max-age=60`; else call
   `generatePaintAfterImage` and stream the stored result; every failure path falls back to the
   Street View image (or 404 `{code:'no_streetview'}` if there is no pano at all) so the page
   `<img>` never renders broken. SCOPE GATE (review finding, 2026-07-10): the repaint prompt
   recolours the exterior, so `generatePaintAfterImage` returns
   `{ok:false, status:'skipped', error:'interior_only'}` when the row's `scopes` lacks
   `'exterior'` — no render is billed for interior-only jobs, and R5's `/p` page hides the AI
   figure for them (Street View only).
5. **R5 — Imagery + action-row parity on `/p/[token]`.** In `app/p/[token]/page.tsx`:
   a. Between the title block and `<PaintResultView/>`, add an image section mirroring
   `/m`'s (`app/m/[token]/page.tsx:212–222`): run the FREE Street View metadata check
   server-side at render; when a pano exists render a two-up grid (stack on mobile):
   `<img src={'/api/painting/q/' + row.public_token + '/street-view'}>` captioned
   "Front of the property · Google Street View" and
   `<img src={'/api/painting/q/' + row.public_token + '/after-image'}>` captioned
   "Fresh repaint · AI preview", each inside `border border-ink-line bg-ink-card` with the mono
   caption strip; when no pano exists render nothing (no broken frames).
   b. Change the customer-quote link (:143–150) to the FILLED accent style and fixed label
   "Open customer quote" matching `MeasurementReview.tsx:283–290`
   (`bg-accent … text-white hover:bg-accent-press`, keep `target="_blank"`); keep Download PDF /
   EditQuotePanel / SendToCustomerButton / New estimate as they are.
   c. In `app/dashboard/page.tsx` `JobQueueDetail`'s pinned action bar, add `target="_blank"` to
   the primary `{jobTradieCtaLabel(job)} →` link so queue → results opens in a new tab.
6. **Tests (write FIRST, per TDD).**
   a. `lib/painting/progress.test.ts` — truth table for `paintProgressOpen` (busy true → open;
   respOk+saveState 'idle'/'saving'/'saved' → open; respOk+'error' → closed; all-false → closed)
   and `paintProgressTitle` copy.
   b. `lib/painting/paint-after.test.ts` — with an injected fake Supabase client (pattern:
   `lib/quote/dedicated-page.test.ts`) and injected fetch/provider fns: ready-path short-circuits
   (no generate), CAS failure (row already 'generating') does not double-generate, generation
   failure marks `preview_status='failed'`.
   c. `tests/e2e/painting-estimate-page.spec.ts` — seeded-row pattern
   (`test.skip(!seedable, …)`, service-role insert of a `painting_measurements` row with a
   minimal valid `estimate` jsonb fixture, both tokens, `released_at` set,
   `preview_status: 'generating'` so the CAS claim refuses and the after-image route serves the
   fast fallback and the test never waits on or bills Gemini — note `'failed'` would NOT work,
   it is deliberately CAS-retryable; `afterAll` delete): `goto('/p/<estimate_token>')`, assert h1
   "Estimate results", the "Open customer quote" link (filled accent, href `/q/paint/<public_token>`),
   "Download PDF" link, send control present, and that the image section markup is present or
   absent consistently with the metadata check (assert on element presence/src attributes, NOT
   on upstream Google image bytes).
7. **Verify (authed surfaces).** Use the `verify` skill (Clerk ticket + throwaway Playwright
   script, dev server on 3000): run a real estimate from `/dashboard/painting` for
   "28 Greens Rd, Coorparoo" QLD 4151 and confirm (i) the centred modal appears immediately on
   submit with "Estimating paintable area…", (ii) it stays up through save, (iii) the browser
   lands on `/p/<estimate_token>`, (iv) the page shows the Street View image and the AI
   after-image (or its street-view fallback), and the action row renders the filled
   "Open customer quote". Screenshot as proof. Delete throwaway scripts.

## Constraints

- Do not modify the roofing measure page, `/m/[token]`, or any roofing lib — this is painting-side
  parity, not a shared-abstraction refactor.
- Do not remove or weaken anything on `/p`: `EditQuotePanel`, `SendToCustomerButton`,
  `PaintResultView`, released gating, New estimate link all stay.
- Keep same-tab `router.push` navigation after save (roofing parity; documented decision above).
- Gemini renders are billable: after-image must be CAS-guarded, cached in `preview_image_path`,
  gated on `released_at`, and at most one render per row; e2e must never trigger a render.
- `GOOGLE_MAPS_API_KEY` and `GEMINI_API_KEY` stay server-side; the client and the /p page only
  ever see `/api/painting/q/[token]/*` URLs.
- Follow the repo's migration convention (169 + runner script, applied to prod Supabase, init.sql
  kept representative). No other schema changes.
- House test style: node-env vitest, explicit imports, DI/fake objects over `vi.mock`; e2e only
  on public pages with the seeded-row skip pattern.
- Read `node_modules/next/dist/docs/` guidance before writing new route handlers (Next 16
  promise-params etc.).

## Acceptance criteria & gates

1. `npm test` passes, including the new `lib/painting/progress.test.ts` and
   `lib/painting/paint-after.test.ts`.
2. `npm run typecheck` passes.
3. `npm run test:e2e` passes, including `tests/e2e/painting-estimate-page.spec.ts` (skips cleanly
   when Supabase env is absent).
4. /verify evidence (screenshots via the verify skill): centred modal during estimate → landing
   on `/p/<token>` → Street View + AI images visible → filled "Open customer quote",
   "Download PDF", send control present.
5. `/review` confirms every R1–R5 item; `/code-review` reports no blocker/major findings.

## Examples

<example>
Modal to mirror: `MeasureProgressModal`, app/dashboard/roofing/measure/page.tsx:1087–1162, and its
render condition at :533–536 (`open={busy || (resp?.ok === true && saveState !== 'error')}`).
Painting page state names are identical (`busy`, `resp`, `saveState`), so the condition maps 1:1
via `paintProgressOpen`.
</example>

<example>
Token-scoped Google proxy to mirror: app/api/roofing/q/[token]/static-map/route.ts (guard → row by
public_token → Google fetch → stream + immutable cache). Swap the table to
`painting_measurements` and the URL builder to `buildStreetViewUrl` from lib/painting/streetview.ts.
</example>

<example>
Cached AI image to mirror: app/api/roofing/q/[token]/after-image/route.ts +
lib/roofing/roof-after.ts (CAS on preview_status, upload to intake-photos, serve-stored-first,
graceful fallback image on every failure). Painting's fallback is the Street View photo instead of
the satellite map; the billing gate reads `released_at` instead of `confirmed_at`.
</example>

<example>
E2E to imitate: tests/e2e/roofing-quote-workflow.spec.ts — `test.skip(!seedable, …)`, service-role
seed in beforeAll, `test.describe.configure({ mode: 'serial' })` if a test mutates the row,
afterAll cleanup. Assert on rendered HTML/attributes only.
</example>
