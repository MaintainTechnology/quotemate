# Onboarding wizard refresh — code-gate breadcrumb, optional trade-step inputs, per-trade pricing incl. roofing rate card

## Title
A tradie completes signup → code → trade → pricing → review → activate with all brand/licence inputs blank, sees the funnel breadcrumb on the invitation-code gate, and (when roofing is selected) can tune the seven $/m² roofing material rates in the wizard, persisted to `pricing_book.overlays.roofing_rate_card`.

## Goal
Activation succeeds with every optional trade-step input (logo, contact name, website, business address, ABN, licence) left blank, and a roofing tenant's wizard-entered per-m² rates land in `pricing_book.overlays.roofing_rate_card` exactly as the dashboard Roof-rates editor would write them. Why: the deployed wizard demands inputs it doesn't need (logo marked required, mobile re-asked) and gives roofing tenants no pricing control at all until they find the dashboard tab.

## Role
Principal engineer for this repo. Reason before acting, take real action with tools, parallelise independent calls, never guess a parameter — read the file or run the check first.

## Context
All claims below verified by reading the files in this session (branch `ralph/roofing-3d-capture-upgrades`):

- **`app/onboard/page.tsx`** — the wizard: a Step-0 invitation-code gate (`!codeAccepted`) plus 3 steps, all rendered inside `FunnelShell` with `currentNum` from `STEP_META` (`'02' | '03' | '04'`). The code gate already passes `currentNum='02'`, so the desktop `Stepper` rail and `MobileStepper` (breadcrumb, image 3) render on it *in this codebase* — the screenshots showing no breadcrumb are the older deployed build. Logo (`LogoUpload`, hint "Optional · shows on every quote"), contact name, website, and business address are already optional with the business-initials monogram as the letterhead default. The Mobile field renders **always**, read-only when carried from signup (`mobileLocked`), duplicating step 01. `canContinueStep1` requires `owner_mobile && trades.length > 0 && state`. Step 2 shows: labour rates (required only when electrical/plumbing selected), painting rate card, a roofing **text blurb only** (no inputs), GST checkbox, and the "Booking availability (optional)" `AvailabilityEditor` — this is the existing Scheduling section. `STEP_META[1].subtitle` reads "Three required fields…", which is wrong for painting/roofing-only tenants.
- **`app/_components/funnel-shell.tsx`** — `STEPS` 01–04, `Stepper` (desktop, `hidden lg:block` rail) + `MobileStepper`. Code gate shows Account=done, 02=active — matches image 3.
- **`lib/onboard/schema.ts`** — `OnboardActivateSchema`: `owner_mobile` (AU mobile) and `state` required; brand fields all optional; painting rates are flat `optionalNumber(...)` string-coerced fields; `superRefine` requires the three labour rates only when a labour trade is selected. `defaultsForTrade('roofing')` exists.
- **`app/api/onboard/activate/route.ts`** — inserts one `pricing_book` row per trade. Painting builds `overlays.painting_rate_card` via `buildPaintingOverlayFromInputs` (invalid → `{}` fallback). Roofing currently writes **no overlay** — comment says defaults apply until the dashboard edit. Labour columns for painting/roofing fall back to harmless placeholders (110/150/0).
- **`lib/roofing/rate-card-overlay.ts`** — `EDITABLE_MATERIALS` (7 keys), `buildOverlayFromInputs({ reroof_rate_per_m2: {...} })` → validated overlay, bounds `MIN_RATE_PER_M2=0` (exclusive) / `MAX_RATE_PER_M2=500`. Already unit-tested in `lib/roofing/rate-card-overlay.test.ts`.
- **`lib/roofing/pricing.ts`** — `DEFAULT_ROOFING_RATE_CARD.reroof_rate_per_m2`: corrugated 90, trimdek 95, spandek 105, kliplok 115, concrete 95, terracotta 130, cement_sheet 0 ("never auto-quoted") — exactly the defaults in image 5.
- **`app/dashboard/_components/RoofRatesEditor.tsx`** — `MATERIALS` label list to mirror ("Colorbond Corrugated", …, "Cement sheet (asbestos-suspect)"). This dashboard tab (image 5) stays untouched; the wizard section is a subset (the 7 $/m² rates only).
- **Tests** — `lib/onboard/schema.test.ts` (vitest, `npm test`); `tests/e2e/activation.spec.ts` + `playwright.config.ts` (`npm run test:e2e`, boots `next dev` on :3100, no real Twilio/Vapi; use Playwright route interception for `/api/onboard/*` when driving the wizard client-side). Typecheck gate is **`npm run typecheck`** (`tsc --noEmit`) — this repo has no `npm run check`.

Decisions filling gaps in the dictated brief (raw request said "lean on your decisions"):
- **Mobile** stays required *data-wise* (welcome SMS + Twilio provisioning + tenant row need it; /signup step 01 already collects and verifies it). The fix is de-duplication: the trade step renders the Mobile input **only when `form.owner_mobile` is empty** (identity carry-over failed); when carried it is not re-asked — the Review step still shows it.
- **State** stays required — it drives `tzForState` (booking timezone), licence-body suggestions, and `pricing_book.licence_state`. One dropdown tap is cheap; a silent default would corrupt bookings.
- **Roofing wizard pricing** covers only the seven per-material $/m² rates (the section image 5 shows). Loadings, accessories, solar allowances remain dashboard-only levers.
- **Scheduling** = the existing availability section; it stays, no new build — just protected by a test.

## Task
1. **Schema (`lib/onboard/schema.ts`)** — add seven flat optional roofing rate fields, string-coerced like the painting ones, bounded to match the overlay validator (`positive`, `.max(500)`): `roofing_corrugated_rate`, `roofing_trimdek_rate`, `roofing_spandek_rate`, `roofing_kliplok_rate`, `roofing_concrete_tile_rate`, `roofing_terracotta_tile_rate`, `roofing_cement_sheet_rate`. Blank/omitted → `undefined`.
2. **Activate route (`app/api/onboard/activate/route.ts`)** — for the roofing `pricing_book` row, build `overlays.roofing_rate_card` from those fields via `buildOverlayFromInputs({ reroof_rate_per_m2: { colorbond_corrugated: form.roofing_corrugated_rate, … } })`; on `ok:false` persist `{}` (mirror the painting fallback) so bad rates can never poison pricing.
3. **Wizard Step 2 (`app/onboard/page.tsx`)** — when `roofing` is selected, replace the text-only blurb with a "Roofing pricing" section: seven `PrefixedInput` `$ …/m²` fields (labels mirroring `RoofRatesEditor.MATERIALS`), pre-filled with the `DEFAULT_ROOFING_RATE_CARD` values except `cement_sheet`, which stays blank with hint "Default $0/m² · never auto-quoted" (a 0 value fails the positive bound by design). All optional — blank falls back to defaults. Keep the review-before-send sentence from the current blurb.
4. **Wizard Step 1 (trade step)** — render the Mobile field only when `form.owner_mobile` is empty; `canContinueStep1` keeps requiring a non-empty `owner_mobile` (carried or typed) + `trades` + `state`. No other required marks on this step besides Trade and State (logo/contact/website/address/ABN/licence already optional — lock, don't change).
5. **Step 3 (review)** — the Roofing row reflects reality: "Custom per-m² rates" when any wizard rate differs from blank, else the existing "Measured per-m² rate card (AU defaults)".
6. **Copy accuracy** — `STEP_META[1].subtitle` ("Three required fields…") becomes trade-agnostic, e.g. "Rates for the trades you picked. Everything has a sensible default."
7. **Tests (TDD — write failing first)** —
   - `lib/onboard/schema.test.ts`: roofing fields blank/omitted → `undefined`; value `'0'` or `'501'` rejected; roofing-only payload with **no** labour rates and **no** brand fields parses (activation-succeeds-without-them contract).
   - New `tests/e2e/onboard-wizard.spec.ts`: (a) `/onboard` code gate shows the funnel breadcrumb (`aria-label="Onboarding progress"`, "Account", "Trade & licence" visible) — the image-3 requirement; (b) with `/api/onboard/validate-code` intercepted to `{ ok: true }` and identity params in the URL (incl. `owner_mobile`), the trade step shows **no** Mobile input and no required logo; a roofing-only selection reaches Step 2 showing the seven rate inputs pre-filled (corrugated "90", kliplok "115", cement sheet blank) **and** the "Booking availability (optional)" scheduling section; (c) intercept `POST /api/onboard/activate`, drive to Activate with brand fields blank and one edited rate (e.g. corrugated → 200), assert the request body carries `roofing_corrugated_rate: '200'` and blank brand fields, fulfill `{ ok: true, tenantId: 't', phoneNumber: '+61400000000' }`, assert redirect to `/onboard/success`.

## Constraints
- Do not touch `RoofRatesEditor.tsx`, the dashboard tabs, painting pricing, the provisioning chain, or `funnel-shell.tsx` step numbering (01–04 stays; the code gate remains step-02 chrome).
- Do not weaken `owner_mobile` or `state` in the schema.
- Follow the painting flat-field precedent; reuse `buildOverlayFromInputs` — no new validation layer.
- Minimal diff, no unrelated refactors, no new abstractions. Australian English, Command Centre tokens, zero emoji.
- Reversible edits only; no git push / destructive ops without confirmation.

## Acceptance criteria & gates
- `npm test` — all vitest suites pass, including the new schema cases.
- `npm run typecheck` — clean.
- `npm run test:e2e` — all Playwright specs pass, including `tests/e2e/onboard-wizard.spec.ts`.
- /verify: drive the wizard in a real browser (playwright-cli against `next dev`) — code-gate breadcrumb visible, roofing-only flow completes to the intercepted success redirect with all optional fields blank.
- /review + /code-review: no blocker- or major-severity findings.

## Addendum — user clarification (2026-07-17, mid-run)
The user corrected the mobile decision: **no input is removed from the trade step — they all stay visible and become optional.** Delta requirements (supersede Task 4's "render only when empty" mechanism):

- **A1 — Mobile field always renders** on the trade step. When the carried-over `owner_mobile` URL param parses as an AU mobile it is prefilled, read-only, hinted "Verified via SMS · locked" (the pre-change presentation); otherwise it is editable, prefilled with whatever arrived, and **optional** (no required marker, no `required` attr). The normalise-on-hydrate and validity-checked lock from the review fixes stay.
- **A2 — `owner_mobile` optional end-to-end**: schema accepts absent/blank (still rejects an invalid non-empty value); activate inserts `null` when absent; migration `176_tenants_owner_mobile_optional.sql` drops the NOT NULL on `tenants.owner_mobile` (+ `scripts/run-migration-176.mjs`, applied); `runProvisioning` skips the welcome SMS when no mobile (its `welcome` result stays undefined — the declared "didn't try" state).
- **A3 — `state` optional**: schema accepts absent/blank; UI drops the required marker; activation stores `null`, availability timezone falls back to Australia/Sydney (`tzForState` already handles null), licence rows store null state. `tenants.state` is already nullable (migration 015).
- **A4 — Trade selection stays required** (min 1) — with zero trades there are no pricing rows, no service offerings, and nothing to quote. `canContinueStep1` now gates on trades only.
- **A5 — Gates**: schema tests for absent mobile/state; run-provisioning test for the skipped welcome SMS; e2e updated — verified mobile shows locked (not hidden), a trade-only selection can continue with mobile/state blank.

## Examples
<example>
Painting's flat optional rate fields in `lib/onboard/schema.ts` (`painting_walls_rate: optionalNumber(z.coerce.number().positive().max(200))`) and their persistence in `app/api/onboard/activate/route.ts` via `buildPaintingOverlayFromInputs` with the `{}` fallback — the exact pattern the roofing fields follow.
</example>
<example>
`buildOverlayFromInputs` legacy-shape test in `lib/roofing/rate-card-overlay.test.ts` — shows the `{ reroof_rate_per_m2: {...} }` input shape and the drop-blank / reject-out-of-range semantics the route mapping relies on.
</example>
<example>
`tests/e2e/activation.spec.ts` — the repo's Playwright idiom: no real Supabase writes, assert rendered HTML + API contracts; extend with `page.route()` interception for the wizard drive.
</example>
<example>
Edge case: cement sheet. Default 0 means "never auto-quoted"; the overlay validator rejects 0 as an override. The wizard therefore pre-fills it blank, not "0" — sending '0' must fail schema validation (covered by a test), and blank must fall back to the default.
</example>
