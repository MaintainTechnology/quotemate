# Quote Tier Modes — Per-Feature Single-Option / GBB Settings — Spec

## Objective
Give each tradie a per-feature **Settings** control over how a customer quote presents pricing: the current three-tier Good / Better / Best (GBB), a **single price** (auto = the estimator's recommended tier), or a **single forced tier** (Good only / Better only / Best only). The new platform-wide default is **single price** for every tenant, replacing today's always-three-tier default. The control is per-feature (electrical, plumbing, roofing, solar, residential painting, commercial painting), so a tradie can run, say, three-tier painting and single-price solar at the same time. This lets tradies who want a clean lump-sum read stop showing line-by-line tiers, without losing the ability to keep tiers where they want them.

## Context / background
Multi-tenant Next.js 16 App Router + Supabase app in `quotemate-automation/`. Findings from a full-codebase sweep (kept here so the build doesn't re-derive them):

- **Tiers are stored, not just shown.** GBB features persist `quotes.good / better / best` (jsonb) plus `quotes.selected_tier` (`'good'|'better'|'best'|'inspection'|null`, default `'better'`). The customer pages already render only the **non-null** tiers and compute a `tierCount` (1/2/3) that drives headings ("Your option" / "Your three options"). So a single-tier render path **already works** when only one tier is populated — there is just no setting that triggers it.
- **`selected_tier` is the existing "recommended tier".** Set by the estimator + reconcile (`lib/estimate/run.ts`, `lib/estimate/reconcile.ts`), persisted at insert in `app/api/estimate/draft/route.ts` (fallback order `better → good → best`), and already read by the quote page + SMS to mark "(recommended)". This is the basis for single-price mode.
- **Existing settings pattern to mirror:** a `pricing_book` column (one row per tenant per trade) added by an idempotent migration (e.g. `071_pricing_book_quote_display.sql`, `078_review_policy.sql`, `079_followup_2h.sql`), validated in `lib/tenant/update-schema.ts`, written via `PATCH /api/tenant/me`, and edited in a dashboard "Card" component (`QuoteDisplayCard` in `app/dashboard/page.tsx`). `quote_display` is fanned out to **all** of a tenant's pricing_book rows; the new mode must instead be **per-row (per-feature)**.
- **`quote_display` ('itemised' | 'summary') is a different axis** — it controls line-item detail *within* a tier, not how many tiers show. The new mode is orthogonal and combinable with it.
- **Per-feature surface map (what produces tiers and where it renders):**

  | Feature | Tiers today | Generation | Customer render | "Recommended" source |
  |---|---|---|---|---|
  | Electrical / Plumbing quote | GBB | `lib/estimate/run.ts`, `app/api/estimate/draft/route.ts` | `app/q/[token]/page.tsx` (TierCard) | `selected_tier` (def. `better`) |
  | Roofing | GBB | `lib/roofing/pricing.ts`, `app/api/roofing/save-as-quote/route.ts` | `app/q/[token]/page.tsx` → `TradeTiers.tsx` (+ `RoofingTiers.tsx`) | `selected_tier` (`better>best>good`) |
  | Residential painting | GBB (price ranges; 1-coat/2-coat/premium) | `lib/painting/pricing.ts`, `app/api/painting/estimate/route.ts` | `app/q/paint/[token]/page.tsx` | none — needs a defined default |
  | Commercial painting | one price duplicated into good=better=best | `lib/commercial-painting/price.ts`, `…/save-quote-helpers.ts` | `app/q/[token]/page.tsx` → `TradeTiers.tsx` | `selected_tier` hardcoded `'better'` |
  | Solar | 2–3 system-size tiers | `lib/solar/*`, `app/api/solar/[tenantSlug]/estimate/route.ts` | `app/q/solar/[token]/page.tsx` (`lib/solar/tier-cards.ts`) | implicit: largest/headline tier (no `selected_tier` field) |
  | Electrical plan estimator | already a single price | `lib/estimation/price.ts` | `app/q/plan/[token]/page.tsx` | n/a |
  | Aircon | 2 options (ducted vs split) recommender | `lib/aircon/recommend.ts` | `app/dashboard/aircon/page.tsx` (no customer quote page) | `best_fit` flag |
  | Signage | none (compliance report) | — | — | — |

- **SMS/PDF touchpoints that embed tier prices:** `lib/sms/templates.ts` (`buildQuoteSms`, `buildQuoteUpdatedSms`), `lib/sms/roofing-compose.ts`, `lib/quote/report-html.ts`, `lib/quote/pdf.ts`. Tradie-facing notifications already send totals only (no per-tier breakdown) and need no change.

## Requirements

### Data model
1. Add a `pricing_book.quote_tier_mode` text column, one value per (tenant, trade) row. Allowed values: `'good_better_best'`, `'single'`, `'good'`, `'better'`, `'best'`. `NOT NULL`. Created by a new idempotent migration following the `071`/`078` pattern (`ADD COLUMN IF NOT EXISTS` + guarded `CHECK`), with a matching `NNN_down.sql` and `scripts/run-migration-NNN.mjs`; `sql/init.sql` updated to stay representative.
2. The migration **backfills every existing `pricing_book` row to `'single'`** (the new default for all tenants), and the column default for new rows is `'single'`. (This is the explicit "all tenants default to single" decision — see Edge cases for customer-visible impact.)
3. Semantics of each mode (a pure resolver, never re-priced):
   - `good_better_best` → show all non-null tiers (today's behaviour).
   - `single` → show exactly one tier = the recommended tier (`selected_tier`), falling back `better → good → best` to the nearest non-null tier.
   - `good` / `better` / `best` → show exactly that one tier; if that tier is null, fall back to the recommended tier, then `better → good → best`, so the customer never sees zero tiers when priced tiers exist.

### Shared resolver (single source of truth)
4. Add `lib/quote/tier-visibility.ts` (pure, DB-free, unit-tested), mirroring `lib/quote/display.ts`. It exports:
   - `type QuoteTierMode` and `QUOTE_TIER_MODES`.
   - `asQuoteTierMode(v, fallback='single')` — sanitiser for unknown inputs.
   - `resolveVisibleTiers({ mode, present: {good,better,best}, selectedTier })` → an **ordered** array of visible tier keys (`('good'|'better'|'best')[]`), applying requirement 3 including all fallbacks. Empty array only when no tiers are present.
5. Every surface that renders customer-facing tiers derives its visible set from `resolveVisibleTiers(...)` — no surface re-implements the mode logic.

### Tenant settings (storage + API)
6. Extend `lib/tenant/update-schema.ts`: accept a per-trade `quote_tier_mode` on the `/api/tenant/me` PATCH payload, keyed by trade (so a tenant can set different modes per feature). It is validated against the enum.
7. `app/api/tenant/me` PATCH writes `quote_tier_mode` to the **specific** pricing_book row(s) named in the payload (per-trade), not fanned out to all rows. `GET /api/tenant/me` returns each pricing_book row's `quote_tier_mode`.

### Settings UI
8. Add a dashboard "Quote pricing options" Card (sibling to `QuoteDisplayCard` in `app/dashboard/page.tsx`), rendering **one mode selector per feature/trade the tenant has** (label by feature: Electrical, Plumbing, Roofing, Solar, Painting, Commercial painting). Each selector offers the five modes with plain-language labels (e.g. "Single price (recommended option)", "Good / Better / Best", "Good only", "Better only", "Best only"). Saving calls the existing PATCH pattern. The control is visually separate from, and combinable with, the itemised/summary control.

### Customer-facing rendering (apply the mode)
9. `app/q/[token]/page.tsx` (electrical/plumbing TierCard grid **and** the roofing/commercial-painting `TradeTiers.tsx` / `RoofingTiers.tsx` path) renders only the tiers returned by `resolveVisibleTiers(...)` for the quote's resolved mode. When exactly one tier shows, no "(recommended)" badge is rendered (it is the only option), and the existing `tierCount===1` copy ("Your option") is used.
10. `app/q/paint/[token]/page.tsx` (residential painting, price ranges) applies the same resolver. Residential painting has no `selected_tier`; its recommended tier for `single` mode is **`better`** (the 2-coat baseline) — define this constant where the painting quote is built/rendered.
11. `app/q/solar/[token]/page.tsx` applies the mode to its tier cards: `single` (and `good_better_best`'s collapse to one) shows only the **headline (largest) tier**; forced `good/better/best` map to the corresponding sized tier when present, else fall back to the headline tier. Solar's "recommended" stays the largest tier (no `selected_tier` column required).
12. `lib/quote/report-html.ts` and `lib/quote/pdf.ts` (PDF/HTML quote) render only the visible tiers per the resolved mode.

### Notifications
13. `lib/sms/templates.ts` (`buildQuoteSms`, `buildQuoteUpdatedSms`) and `lib/sms/roofing-compose.ts` embed only the visible tiers from `resolveVisibleTiers(...)`. The existing tier-count heading logic ("Your option" vs "Your three options") then reflects the reduced set automatically. Tradie-facing notifications (`buildTradieDraftNotification`, `buildTradieReviewNotification`) are unchanged (totals only).
14. Solar (`lib/solar/notify.ts`) and commercial painting (`lib/commercial-painting/notify.ts`) already send a single headline/total price — verify they remain correct under all modes; no behavioural change expected.

### Cross-cutting
15. The tradie dashboard quote views and the audit/edit path always show **all** persisted tiers regardless of mode — the mode is a customer-view gate only. Tiers are never deleted or nulled by this feature.
16. The mode is resolved at render time from the quote's pricing_book row; changing the setting later changes how **already-sent** quotes display when re-opened (consistent with how `quote_display` behaves). No re-pricing, no re-send.

## Non-goals
- **No per-quote override** of tier mode in v1 (the analogue of `quotes.display_mode`). Mode is tenant + feature level only. (Possible Phase 2.)
- **No change to tier generation, pricing, grounding, recipes, or `selected_tier` computation.** All three tiers are still generated and persisted; only customer-facing visibility changes.
- **Aircon and signage are out of scope.** Aircon is a 2-option recommender (ducted/split) with no GBB shape and no customer quote page; signage is a compliance report with no pricing. Neither gets a mode selector in v1 (see Open questions for aircon).
- **Electrical plan estimator** already emits a single price; it gets no selector and no change (effectively always single).
- No change to the itemised/summary (`quote_display`) feature, the review-policy hold, early-bird discounts, or deposit/Stripe logic.
- No admin-console control; this is a tradie self-serve setting.

## Constraints
- Next.js 16 App Router; follow `quotemate-automation/AGENTS.md` (read `node_modules/next/dist/docs/` before writing Next code).
- DB change = new `sql/migrations/NNN_*.sql` (next free number, ≈142) + `NNN_down.sql` + `scripts/run-migration-NNN.mjs`, idempotent, applied to prod Supabase; keep `sql/init.sql` representative. Mirror the `071`/`078`/`079` column-add pattern.
- Money-path untouched: no LLM/free-form pricing is introduced; the resolver is pure presentation.
- Server routes use the service-role key; tenancy enforced in the app layer (filter by `tenant_id`).
- Reuse existing helpers/patterns: `lib/quote/display.ts` as the template for `tier-visibility.ts`; `QuoteDisplayCard` as the template for the new Settings card; the `quote_display` PATCH/fan-out plumbing (adapted to per-row writes).
- AU/NZ formatting; currency stored ex-GST, displayed inc-GST.

## Edge cases to handle
- Inspection-required quote (all tiers null, `needs_inspection=true`) → mode is ignored; the existing $99 inspection block / `buildInspectionQuoteSms` path is unchanged.
- `single`/forced mode but only one tier was ever produced (WP9 product-picker collapse, or a feature that emits <3 tiers) → resolver returns that one tier; no error, no empty render.
- Forced `best` (or `good`) but that tier is null → fall back to recommended tier, then nearest non-null; never render zero tiers when priced tiers exist.
- `good_better_best` mode but only 1–2 tiers present → render exactly the present tiers (today's behaviour preserved).
- Commercial painting (good=better=best identical) under `single` → shows one price (the `better` duplicate); no visible difference from a customer's view, which is the desired clean single-price read.
- Existing live tenant after migration → flips to `single` and their **already-sent** quotes re-render as single price when re-opened. This is the intended "all tenants default to single" behaviour; flag it in the rollout note so it is a conscious change, not a surprise regression.
- Tenant with multiple trades sets different modes per feature → each pricing_book row holds its own value; the resolver reads the row matching the quote's trade. No cross-feature bleed.
- Solar quote (separate `solar_estimates` table / `app/q/solar/[token]`) → mode read from the tenant's solar pricing_book row (see Open questions on config home); single = headline tier.
- Unknown/legacy mode value in DB → `asQuoteTierMode` coerces to `'single'`.

## Definition of done
- [ ] Migration adds `pricing_book.quote_tier_mode` (NOT NULL, CHECK over the 5 values, default `'single'`), backfills all existing rows to `'single'`; `NNN_down.sql` + `scripts/run-migration-NNN.mjs` exist; `sql/init.sql` updated; migration is idempotent (re-run is a no-op).
- [ ] `lib/quote/tier-visibility.ts` exports `QuoteTierMode`, `QUOTE_TIER_MODES`, `asQuoteTierMode`, `resolveVisibleTiers`; unit tests cover: all five modes, recommended-tier fallback chain, forced-tier-null fallback, ≤2 tiers present, and empty/null input.
- [ ] `lib/tenant/update-schema.ts` validates per-trade `quote_tier_mode`; `PATCH /api/tenant/me` writes it to the named pricing_book row(s) only; `GET` returns it per row. Unit test on the schema parse.
- [ ] Dashboard "Quote pricing options" Card renders one selector per feature/trade, reads current values, and saves via PATCH; verified the itemised/summary control still works independently.
- [ ] `app/q/[token]/page.tsx` (TierCard + TradeTiers/RoofingTiers), `app/q/paint/[token]/page.tsx`, and `app/q/solar/[token]/page.tsx` each render only the tiers from `resolveVisibleTiers`; verified by setting each mode and observing 1 vs 3 tiers for an electrical, a roofing, a residential-painting, and a solar quote.
- [ ] `lib/sms/templates.ts` + `lib/sms/roofing-compose.ts` embed only visible tiers; SMS heading reflects the reduced count; verified a single-mode quote SMS shows one price and "Your option".
- [ ] PDF/HTML quote (`lib/quote/report-html.ts`, `lib/quote/pdf.ts`) renders only visible tiers.
- [ ] Tradie dashboard + quote-edit views still show all three persisted tiers under every mode (audit path unaffected).
- [ ] Inspection-required quotes, ≤2-tier quotes, and forced-tier-null cases all render without error (matches Edge cases).
- [ ] Project typecheck/build passes; existing tests pass; new unit tests pass.

## Open questions
- **Solar config home:** does a `pricing_book` row exist per tenant for the `solar` trade to hang `quote_tier_mode` on, or should solar read its mode from solar's own config / `tenants`? Recommended default: reuse the `pricing_book(solar)` row for consistency; confirm such a row is created at onboarding for solar tenants.
- **Residential painting recommended tier:** confirm `better` (2-coat baseline) is the right "single" choice, or whether painting should gain a real `selected_tier`.
- **Aircon (deferred):** if a single-option presentation is later wanted for aircon, define the mapping (e.g. `single` → `best_fit` option; GBB doesn't apply since there are only two options and no middle tier). Out of scope for v1.
- **Settings labelling:** confirm the customer-facing intent of "single price" — purely hide the other tiers (this spec), vs. ever renaming the shown tier to a neutral "Your price". This spec keeps the tier's own label.
