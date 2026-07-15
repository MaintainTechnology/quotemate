# Attach customer to tool-created roofing quotes + capture roofing $/m² in onboarding — Spec

> Contract for `/build` and `/review`. Grounded in code opened for this spec.
> pnpm repo: gates `pnpm test` (vitest), `pnpm run typecheck` (`tsc --noEmit`),
> `pnpm test:e2e` (playwright). The pasted template's `src/...` paths are
> placeholders and do NOT exist — the real files are below.

## Title
A tool-committed roofing quote records the customer, the tradie sees that name on the dashboard/job, and a roofing tradie can set their own $/m² during onboarding.

## Goal
(1) When a tradie commits a measured roof to a quote, the quote carries a customer name (+ optional phone), so the dashboard queue and review stop showing "—". (2) A roofing tradie sets their per-material $/m² (and margin) in the onboarding wizard, feeding the same rate-card overlay the dashboard editor and pricer already use — so estimates reflect their real rates. Why: quotes are unidentifiable today, and default $/m² makes estimates feel low.

## Context (grounded)
### Customer (Issue A)
- The `quotes` table has **no** customer column. The dashboard customer name comes **only** from `intake.caller.name` via `app/api/tenant/me/route.ts:457` → `customer_full_name` (:474-475); empty → "—".
- `app/api/roofing/save-as-quote/route.ts` already forwards `customer?.name` into `intake.caller` (:187-191) — but the schema `customer` block (`lib/roofing/save-as-quote-schema.ts:68-74`) is **never populated**: the measure UI `onSendAsQuote` POST body (`app/dashboard/roofing/measure/page.tsx:303-334`) sends only address/inputs/metrics/price, and the `/m` promotion `buildSaveAsQuoteRequest` (`lib/roofing/save-as-quote-helpers.ts:109-163`) **drops** customer.
- **`roofing_measurements.customer_name` / `customer_phone` already exist** (migration 081) and `app/api/roofing/save/route.ts:103-104,157-158` already persists them from `lib/roofing/request-schema.ts:98-99` — but the measure UI never sends them.
- Reusable customer model: `findOrCreateCustomer(phone, 'voice'|'sms'|'web', tenantId)` (`lib/customers/lookup.ts:57`), keyed on phone (returns null without one). The SMS path attaches via this + `intake.customer_id` (`app/api/intake/structure/route.ts:337-338,482`).

### Onboarding rate (Issue B)
- `app/onboard/page.tsx` is a 3-step wizard; Step 2 = pricing. **Painting** has a full rate capture persisted on activate (`buildPaintingOverlayFromInputs` → `overlays.painting_rate_card`); **roofing is prose-only** (a deliberate note says "edit later on the dashboard"), so a roofing tradie can't set rates at onboarding — the exact gap.
- Estimates are driven by `DEFAULT_ROOFING_RATE_CARD.reroof_rate_per_m2` (`lib/roofing/pricing.ts:130-139`): a **per-material** record (`calculateRoofingPrice` selects `reroof_rate_per_m2[inputs.material]` at :473). A single scalar "$/m²" is not meaningful — the quoted roof's material picks the row.
- Overlay is fully shared: `RoofRatesEditor` → `PATCH /api/tenant/roofing-rates` → `buildOverlayFromInputs` (`lib/roofing/rate-card-overlay.ts:266`) → `overlays.roofing_rate_card`; read at price time by `measure-all` `loadRoofingOverlay` → `effectiveRateCardFromOverlay` → `mergeRoofingRateCard` (per-key merge, each rate `0 < x ≤ 500`). Loadings (`complexity_loading_pct` etc.) go through the same builder.

## Resolved decisions (from your words + grounding)
- **Customer entry** — capture on the measure flow ("add the customer when we commit via the tool"): a **name (required) + phone (optional)** input; persist to the existing `roofing_measurements.customer_name/phone` so **both** the direct `save-as-quote` and the `/m` promotion carry it.
- **Name-only allowed** — a name alone shows on the dashboard immediately (no phone needed). When a phone is given, also `findOrCreateCustomer(phone,'web',tenant.id)` and stamp `intake.customer_id` (reusable record, mirrors SMS).
- **Onboarding pricing** — capture per-material $/m² for the **common AU re-roof materials** (colorbond corrugated, colorbond trimdek, concrete tile, terracotta tile) — per-key merge leaves the rest at default. Also capture a **complexity/margin loading %** in the same block, because that is the one lever that raises *every* tier (the most direct fix for "estimates feel low"); both flow through the existing `buildOverlayFromInputs`.

## Task
1. **Customer capture (measure UI).** Add a customer **Name** (required to send) + **Phone** (optional) input to the measure page's send-as-quote area (`app/dashboard/roofing/measure/page.tsx`), include it in the `onSave` body so it persists to `roofing_measurements.customer_name/phone` (columns exist; extend the send-schema only if it doesn't already carry them), and in `onSendAsQuote` include `customer:{name,phone}`.
2. **Thread through promotion.** Extend `StoredMeasurementRow` + `buildSaveAsQuoteRequest` (`save-as-quote-helpers.ts`) to select `customer_name`/`customer_phone` and emit a `customer:{name,phone}` field, so `/m`-promoted quotes carry the name too.
3. **Link a record.** In `save-as-quote/route.ts`, when `customer.phone` is present, `findOrCreateCustomer(phone,'web',tenant.id)` and add `customer_id` to the intake insert; always forward `customer.name` (already wired) so the dashboard name (`me/route.ts:457`) is non-empty.
4. **Onboarding $/m² (Issue B).** Mirror painting in four spots: FormState defaults pre-filled from `DEFAULT_ROOFING_RATE_CARD.reroof_rate_per_m2` (`app/onboard/page.tsx`); a Step-2 `hasRoofing` grid of `$/m²` inputs (+ margin %) reusing the existing `PrefixedInput`; optional bounded fields in `lib/onboard/schema.ts` (`.positive().max(500)`); an `if (t === 'roofing')` branch in `app/api/onboard/activate/route.ts` calling `buildOverlayFromInputs({ reroof_rate_per_m2:{…}, complexity_loading_pct })` → `overlays.roofing_rate_card`.

## Constraints
- Minimal; no pricing-model redesign. Do **not** add a customer column to `quotes` (dashboard reads the intake). Reuse the existing overlay builder/validator + `findOrCreateCustomer` — no new persistence.
- Roofing stays review-required; no auto-send. No LLM on money.
- Onboarding overlay only written when the roofing branch runs (mirror painting); per-key merge keeps un-set materials at default.

## Acceptance criteria & gates
- **TA (customer):** `save-as-quote-helpers.test.ts` — `buildSaveAsQuoteRequest` on a row with `customer_name`/`customer_phone` emits `customer:{name,phone}` (and null-safe when absent). A route/unit test that a `customer.name` flows to `intake.caller.name`.
- **TB (onboarding):** `lib/onboard/schema.test.ts` (or the activate builder test) — roofing rate inputs validate/bound, and `buildOverlayFromInputs` produces a `roofing_rate_card` overlay from the wizard fields (per-material $/m² + complexity loading), falling back to defaults when blank.
- **UI:** `/playwright-cli` (or authed browser) — measure page captures a customer name and the dashboard quote shows it (not "—"); the onboarding wizard shows + persists roofing $/m².
- **Gates each iteration:** `pnpm test`, `pnpm run typecheck`; UI verified live; `/review` + `/code-review` clean of blocker/major.

## Examples
<example>The **painting** onboarding path (`app/onboard/page.tsx` FormState 184-190 + `buildPaintingOverlayFromInputs` in the activate route) is the exact pattern the roofing branch must mirror.</example>
<example>The **SMS** attach path (`app/api/intake/structure/route.ts:337-338,482`: `findOrCreateCustomer` + `intake.customer_id` + `caller.name`) is the reference for how a roofing quote should link a customer.</example>
