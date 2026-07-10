# Painting materials + labour take-off (litres, packs, hours, margin) — deterministic, tradie-only

## Goal

Every painting estimate additionally computes, per tier, a deterministic materials take-off
(litres per product → AU pack counts → cost) and a labour estimate (hours → crew-days → cost),
with a tradie-only margin strip — while every customer-facing quoted number stays byte-identical.
Why: the tradie currently sees a price but not what the job consumes, so they can't sanity-check
margin or order paint from the estimate.

## Role

Principal engineer for this repo. Reason before acting; read before describing; parallel
independent calls; never guess parameters. TDD everything money-adjacent.

## Context (grounded in code opened 2026-07-10)

- **The engine is pure and deterministic** — `lib/painting/pricing.ts`: no LLM anywhere in the
  money path. `calculatePaintingPrice` (:294) prices `measurement.surfaces[]`
  (walls/ceilings/exterior m², trim lm — each with `quantity`/`quantity_low`/`quantity_high`,
  `lib/painting/types.ts` PaintSurfaceArea) via `effectiveRatePerUnit` × `jobMultiplier` (:182 —
  coats × condition × colour) × exterior double-storey loading (:243-251); tiers = Better ×
  fraction (good `good_refresh_fraction`, best `1 + premium_uplift_pct`), GST, call-out floor,
  `breakdown` (:346-361).
- **Labour knobs already exist**: `PaintingRateCard.production_rate_per_unit` (m²/hr, lm/hr;
  defaults `DEFAULT_PAINTING_PRODUCTION_RATES` walls 3 / ceilings 4 / trim 7 / exterior 2,
  pricing.ts:74-79) and `hourly_rate` (default 85, :70) — today only consulted in
  `pricing_model: 'hourly'`. The take-off REUSES these for hours regardless of pricing model.
- **PaintingRateCard** (`types.ts:187-222`) is merged from
  `pricing_book.overlays.painting_rate_card` by `lib/painting/rate-card-overlay.ts`
  (`PaintingRateOverlaySchema` :55, `mergePaintingRateCard` :108,
  `buildPaintingOverlayFromInputs` :175, clamp constants :31-39), edited in
  `app/dashboard/_components/PaintRatesEditor.tsx` (309 lines; grouped numeric fields), served
  by `app/api/tenant/painting-rates/route.ts` (GET/PATCH through those helpers).
- **PaintingEstimate** (`types.ts:293-299`) = `{provider, facts, measurement, price, warnings}`,
  persisted VERBATIM as `painting_measurements.estimate` jsonb
  (`lib/painting/save-row.ts`), rendered by the shared
  `app/dashboard/painting/_components/PaintResultView.tsx` (214 lines; sections: Property
  details @49, Paintable quantities @63, "How the price was built" @108, "How this was
  derived" @158) which renders ONLY on tradie surfaces: the dashboard estimate page and
  `/p/[token]` (`app/p/[token]/page.tsx:141`). The customer page `app/q/paint/[token]/page.tsx`
  (520 lines) does NOT import it, and the customer PDF `lib/painting/report-html.ts` builds its
  own HTML.
- **Premise corrections vs the dictated request**: (1) painting tiers have NO timeframe string
  (grep `timeframe` in lib/painting + painting components: zero hits — that's the
  electrical-quotes shape), so there is nothing to replace: the crew-days duration line is an
  ADDITION inside the take-off section, and `PaintingPriceTier` stays unchanged. (2) the
  customer PDF already prints the per-surface rate takeoff (`report-html.ts:53-62`,
  `breakdown.surfaces` incl. `rate_per_unit`) by prior product decision — leave it exactly as
  is; the new materials/labour/margin data must NOT be added to it.
- **AU units**: litres (never gallons), pack sizes 1 L / 4 L / 10 L / 15 L, m²/lm, 7.6-hour
  standard day.
- **Gates**: `npm test` (vitest, node env, colocated `lib/**/*.test.ts`; existing
  `lib/painting/pricing.test.ts` is the style reference), `npm run typecheck`, `npm run
  test:e2e` (Playwright, public pages, seeded-row pattern —
  `tests/e2e/painting-estimate-page.spec.ts` from spec painting-measure-parity). There is no
  `npm run check`. NOTE: a concurrent workstream's untracked WIP
  (`lib/roofing/layout-plan.ts`, `tests/e2e/roofing-layout-map.spec.ts`,
  `tests/e2e/commercial-paint-page.spec.ts`) may fail repo-wide typecheck/e2e; those files are
  out of scope and must not be modified — report their state per gate run.
- Next 16: params are Promises; follow existing file patterns.

## Task

1. **Types** (`lib/painting/types.ts`): add
   `PaintProduct = 'wall_paint' | 'ceiling_paint' | 'trim_enamel' | 'exterior_paint' | 'primer_sealer'`;
   `PaintingTakeoffCard` = `{ coverage_per_litre: Record<PaintProduct, number>` (m²/L; trim
   lm/L), `price_per_litre: Record<PaintProduct, number>` (ex-GST $/L),
   `premium_price_uplift_pct: number` (Best-tier paint premium on materials),
   `sundries_pct: number` (prep consumables % of materials), `crew_size: number`,
   `hours_per_day: number }`; optional `takeoff?: Partial<PaintingTakeoffCard>` on
   `PaintingRateCard`; `PaintingTakeoff` output type = per-tier array of
   `{ tier, products: Array<{ product, litres, litres_low, litres_high, packs: Array<{size_l,
   count}>, cost_ex_gst }>, sundries_ex_gst, materials_ex_gst, labour_hours, labour_ex_gst,
   crew_size, days_on_site, margin_ex_gst, margin_pct }`; optional `takeoff?: PaintingTakeoff`
   on `PaintingEstimate` (older saved rows lack it → UIs must hide the section, not crash).
2. **Engine** (`lib/painting/takeoff.ts`, PURE, mirrors pricing.ts posture): export
   `DEFAULT_PAINTING_TAKEOFF_CARD` (AU defaults — coverage m²/L: wall 16, ceiling 16,
   exterior 14, primer 12; trim 45 lm/L; price $/L ex-GST: wall 14, ceiling 12, trim 20,
   exterior 16, primer 12; premium uplift 0.25; sundries 0.08; crew 2; 7.6 h/day) and
   `computePaintingTakeoff({ measurement, inputs, rateCard })`:
   - Tier coat model (declared, deterministic): good = 1 coat; better and best = `inputs.coats`.
     Quantities are the job's in-scope `measurement.surfaces`.
   - Litres per product per tier: `quantity × tierCoats ÷ coverage` (trim uses lm ÷ lm-per-L);
     `primer_sealer` only when `inputs.condition === 'bare'`, one coat over the in-scope
     surfaces ('minor' patching is covered by sundries, not full priming — state in a comment).
     Low/high litres from `quantity_low`/`quantity_high`.
   - Packs: round litres UP into 15/10/4/1 L packs, greedy largest-first on the point litres:
     while remaining > 10 take 15 L; else if > 4 take one 10 L; else if > 1 take one 4 L; else
     one 1 L. Product cost = TOTAL PACKED litres × price_per_litre (you buy whole packs); Best
     tier multiplies paint (not primer/sundries) prices by `1 + premium_price_uplift_pct`.
   - `sundries_ex_gst` = sundries_pct × Σ product costs; `materials_ex_gst` = products +
     sundries.
   - Labour hours per tier = Σ over in-scope surfaces of `quantity ÷ production_rate` ×
     (tier coats multiplier `rateCard.coats_multiplier[tierCoats]`) × condition multiplier ×
     colour multiplier (reuse `jobMultiplier` semantics — import from pricing.ts, do not
     re-derive) × exterior double-storey loading on the exterior surface only. Production
     rates: `rateCard.production_rate_per_unit ?? DEFAULT_PAINTING_PRODUCTION_RATES`.
   - `labour_ex_gst` = hours × (`rateCard.hourly_rate ?? DEFAULT_PAINTING_HOURLY_RATE`);
     `days_on_site` = `Math.max(1, Math.ceil(hours ÷ (crew_size × hours_per_day)))`.
   - Margin per tier = tier `ex_gst` − materials − labour (needs the computed tiers: accept
     `price: PaintingQuotePrice` as an input); `margin_pct` = margin ÷ tier ex_gst (0 when
     price is 0). Numbers rounded like pricing.ts (`roundTo` 2 dp; litres 1 dp).
3. **Wire into the estimate** (`lib/painting/measure.ts` `estimatePainting`): after
   `calculatePaintingPrice`, attach `takeoff: computePaintingTakeoff(...)` to the returned
   estimate. It persists automatically inside `painting_measurements.estimate` jsonb — no
   migration. THE TIERS THEMSELVES MUST NOT CHANGE: add an invariant test asserting
   `calculatePaintingPrice` output is deep-equal with and without takeoff config present.
4. **Overlay + editor knobs**: extend `PaintingRateOverlaySchema` /
   `mergePaintingRateCard` / `DashboardInputs` / `buildPaintingOverlayFromInputs`
   (`lib/painting/rate-card-overlay.ts`) with the `takeoff` group (validated: coverage
   0<x≤200, price 0<x≤500, sundries 0–0.5, premium 0–1, crew 1–10, hours_per_day 1–12 —
   follow the existing clamp-constant style). Add a "Materials & labour" field group to
   `PaintRatesEditor.tsx` mirroring its existing grouped-numeric-field pattern; the
   `painting-rates` route flows through the extended helpers unchanged unless it enumerates
   fields explicitly (read it; adjust only if needed).
5. **Display** (`PaintResultView.tsx`, after "How the price was built"): new
   "Materials & labour" section — per tier (tab or stacked rows following the existing
   markup idiom): product rows `litres (low–high) → packs (e.g. 1×15 L + 1×4 L) → $`,
   sundries line, materials subtotal, labour `N h → crew_size painters · ~D days on site → $`,
   and a margin strip `margin $ · %` visually marked tradie-only (mono label
   "Margin · tradie only"). Renders only when `estimate.takeoff` exists. This component only
   mounts on tradie surfaces; do NOT touch `app/q/paint/[token]/page.tsx` or
   `lib/painting/report-html.ts` — customer page and PDF stay byte-identical.
6. **Tests (write FIRST, per TDD)** — `lib/painting/takeoff.test.ts`:
   litres maths per product incl. trim lm→L and primer only on 'bare'; pack rounding cases
   (exact 15, 15.1 → 15+1, 3.2 → 4 L, 0.4 → 1 L); low/high band litres; Best premium applies
   to paint but not primer/sundries; labour hours with coats/condition/colour multipliers +
   exterior double-storey; crew-days ceil with minimum 1; margin per tier against a computed
   `PaintingQuotePrice`; determinism (two identical calls deep-equal). Extend
   `lib/painting/rate-card-overlay.test.ts` (or create following its pattern if absent) for
   parse/merge/clamps of the takeoff group. Invariant test from Task 3. Extend
   `tests/e2e/painting-estimate-page.spec.ts`: add `takeoff` to the seeded estimate fixture,
   assert `/p` shows "Materials & labour" (and a litres row), and assert the customer page
   `/q/paint/<public_token>` contains NEITHER "Materials & labour" NOR "Margin".
7. **/verify** (verify skill — Clerk ticket + throwaway Playwright, dev server on 3000): run a
   real estimate from `/dashboard/painting` (21 Greens Rd, Coorparoo, walls+ceilings) and
   screenshot the take-off section on the results surface; confirm litres/packs/hours/margin
   render and that `/q/paint/<public_token>` shows no take-off/margin. Delete throwaway
   scripts.

## Constraints

- PURE functions only for all new maths — no I/O, no LLM, no Date/randomness in the compute
  path (`Date.now` forbidden in takeoff.ts; pack/rounding fully deterministic).
- Quoted numbers are untouchable: `PaintingPriceTier` values, tier labels/scope lines, the
  customer page, the customer PDF, SMS composition — all byte-identical. The invariant test
  enforces the engine side; the e2e negative assertions enforce the surfaces.
- Margin and labour cost are tradie-only: dashboard result + `/p`. Never `/q/paint`, never
  `report-html.ts`, never any SMS template.
- AU units end to end: litres, m², lm, $ ex-GST internally with inc-GST only where the
  existing UI already shows it. No gallons anywhere, including copy.
- Reuse, don't re-derive: `jobMultiplier`, `DEFAULT_PAINTING_PRODUCTION_RATES`,
  `DEFAULT_PAINTING_HOURLY_RATE`, `roundTo` semantics, the overlay merge/clamp pattern, the
  PaintRatesEditor field-group pattern.
- No new tables/migrations (the takeoff card rides `pricing_book.overlays.painting_rate_card`;
  the output rides `estimate` jsonb). No new dependencies.
- Do not modify the concurrent workstream's untracked files (`lib/roofing/layout-plan.ts`,
  `tests/e2e/roofing-layout-map.spec.ts`, `tests/e2e/commercial-paint-page.spec.ts`); report
  repo-wide gate failures they cause instead.
- Old saved estimates (no `takeoff` in jsonb) must render everywhere without the section and
  without errors.

## Acceptance criteria & gates

1. `npm test` passes, including the new `lib/painting/takeoff.test.ts`, the overlay-extension
   tests, and the price-invariance test.
2. `npm run typecheck` passes for all files in this spec's scope (report any residual error in
   the out-of-scope concurrent files explicitly).
3. `npm run test:e2e` — `tests/e2e/painting-estimate-page.spec.ts` passes with the take-off
   assertions (positive on `/p`, negative on `/q/paint`); report the full-suite state incl.
   out-of-scope specs.
4. /verify evidence: screenshot of the Materials & labour section with litres → packs, labour
   hours → crew-days, and the margin strip on a real estimate; customer page shown clean.
5. `/review` confirms every task item; `/code-review` reports no blocker/major findings.

## Examples

<example>
Engine + defaults + test style to imitate: lib/painting/pricing.ts (pure module, exported
DEFAULT_* card, roundTo, __test_only__) and lib/painting/pricing.test.ts. takeoff.ts is a
sibling with the same posture.
</example>

<example>
Litres maths, worked: walls 380 m² (340–420), 2 coats, coverage 16 m²/L → 47.5 L point
(42.5–52.5); packs greedy → 3×15 L + 1×4 L = 49 L packed; cost = 49 × $14 = $686 ex-GST.
Trim 120 lm, 2 coats, 45 lm/L → 5.4 L → 1×10 L (greedy: 5.4 > 4 → one 10 L) = $200 at $20/L.
Encode these exact cases in takeoff.test.ts.
</example>

<example>
Overlay extension to imitate: the hourly-model fields added to PaintingRateOverlaySchema /
mergePaintingRateCard / buildPaintingOverlayFromInputs in lib/painting/rate-card-overlay.ts
(optional group, clamped, backward compatible) and their PaintRatesEditor fields.
</example>

<example>
Tradie-only surface guard to imitate: the margin-free customer page — app/q/paint/[token]/
page.tsx renders tiers from estimate.price.tiers directly and never imports PaintResultView;
the e2e negative assertion mirrors tests/e2e/painting-estimate-page.spec.ts's existing
attribute-level checks.
</example>
