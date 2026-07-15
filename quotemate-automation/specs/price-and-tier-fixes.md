# Price, tier-label & measurement-review fixes (Issues 4–9) — Spec

> Contract for `/build` and `/review`. Grounded in code opened for this spec.
> Repo uses **pnpm**: test gate `pnpm test` (vitest), type gate `pnpm run typecheck`
> (`tsc --noEmit`) — there is **no `check` script**; e2e `pnpm test:e2e` (playwright).

## Title
Carry the solar allowance to better/best tiers, de-dupe roofing tier labels, make roof-form/storeys legible, deep-link the edit flow, and make edge-protection additive across structures.

## Goal
Five independent, verified fixes so a promoted roofing quote (a) includes the priced solar detach/reinstate on Re-roof + Upgrade only, (b) shows the renamed tier labels on every on-screen surface, (c) shows roof form and storeys as two labelled, provenance-hinted stats, (d) lands the tradie in the editor for non-inspection quotes, and (e) prices edge protection off the summed real perimeter, not a multi-structure square approximation. Why: correct customer-facing dollars + a legible, trustworthy review surface.

## Role
Principal engineer; act directly on these reversible edits + tests. No pricing-model redesign, no PDF/stored-label changes.

## Context (grounded)
- **Issue 4 — solar dropped on promotion.** `lib/sms/roofing-compose.ts:258` `narrowQuoteToStructures` returns `combined: { area_m2, tiers }` (`:306`) and **omits `quote.solar`**. `SolarAllowance` = `{ applies, arrays, ex_gst, inc_gst }` (`lib/roofing/solar.ts:58-65`); `SolarQuoteAddon.allowance` is nullable (`:83-85`). Today the allowance is added **to all three tiers** at `app/q/roof/[token]/page.tsx:417-418` (`t.inc_gst + solarIncGst`, `t.ex_gst + solarExGst`; `solar = fullQuote?.solar` `:306`), the SMS (`composeEstimateMessage` `:96-121`) omits it entirely, and `save-as-quote-helpers.ts:158` promotes `narrowed.combined.tiers` (no solar).
- **Issue 5 — tier labels duplicated.** Roofing labels `{ good:'Patch / repair', better:'Re-roof', best:'Upgrade' }` are hard-coded in **five** display maps: `lib/quote/trade-format.ts:213` (`TIER_LABELS_BY_TRADE.roofing`, the hub via `tierLabelsForTrade` `:229`), `app/q/[token]/TradeTiers.tsx:55` (`ROOF_TIER_LABEL`, the customer-page default for the `labels` prop `:95`), `app/q/roof/[token]/page.tsx:128` (`TIER_NAME`) + heading `:726` (`'Patch · Re-roof · Upgrade'`), `app/m/[token]/MeasurementReview.tsx:50` (`TIER_NAME`), `lib/sms/roofing-compose.ts:85` (`ROOF_TIER_LABEL_BY_KEY`, SMS text). The **stored** label producers (`narrowQuoteToStructures` `labelWord` `:275`/`:340`, `pricing.ts`, PDF `report-html.ts`) are **out of scope** — on-screen surfaces ignore the stored label, and touching them breaks money-adjacent "honest copy" tests.
- **Issue 6 — roof form/storeys opaque.** `MeasurementReview.tsx:603` renders ONE MiniStat: `value={formLabel(m.form)} hint={m.storeys!=null ? `${m.storeys}-storey` : ''}` in a `sm:grid-cols-4` grid (`:597`). `formLabel` default is `'To confirm'` (`:46`). Provenance exists: `RoofMetrics.field_sources?` (`types.ts:184`, `RoofFieldSources`) is set by `merge-metrics.ts` but never shown. Storeys ≥ 2 adds a 20% loading (`pricing.ts` `applicableLoadings`); ≥ 3 forces inspection.
- **Issue 7 — Edit & send lands read-only.** `MeasurementReview.tsx` navigates to `/dashboard/quote/${shareToken}` at the promote push (`:149`) and the already-promoted `<a href>` (`:343`) **without `?edit=1`**; the viewer's `TradieEditor` auto-opens on `?edit=1` only for unpaid non-inspection owners. `inspection = routing === 'inspection_required'` (`:228`).
- **Issue 8 — edge-protection collapses on multi-structure.** `combinedLayoutMetrics` (`lib/roofing/layout-plan.ts:363`) sets `polygon_geojson: structures.length===1 ? … : null` (`:391`), so `perimeterM` (`:312`) falls back to `4×√(Σfootprint)` for 2+ structures; `layoutMaterials` uses `perimeterM(metrics)` for the "Edge protection" line (`:499-509`).
- **Issue 9 — button gating.** `RoofLayoutSection.tsx` "Generate layout map" is a billed vision call; **keep as-is** (verified not-a-bug). No code change.

## Task
1. **Issue 4 — solar to better/best.** Add pure `applySolarToTiers(tiers, solar)` in `roofing-compose.ts`: when `solar.allowance.applies && inc_gst > 0`, add `ex_gst`/`inc_gst` to the **better + best** tiers only (never `good`); if a tier carries `line_items`, append one `each` "Solar detach & reinstate" line so `Σ line_items.total_ex_gst === ex_gst` still holds; otherwise adjust the totals only. Carry `solar: quote.solar` through `narrowQuoteToStructures`'s return. Apply the helper in `save-as-quote-helpers.ts` (`price.tiers`) and `composeEstimateMessage` (before building tier lines). In `app/q/roof/[token]/page.tsx`, replace the unconditional `+ solarIncGst`/`+ solarExGst` (all tiers) with the helper's per-tier totals (one code path = double-count guard); show "Includes solar detach & reinstate" only on tiers that received it.
2. **Issue 5 — relabel + de-dupe.** Set the roofing labels to `{ good:'Patch', better:'Full roof replacement', best:'Upgraded roof replacement' }` in `trade-format.ts:213`. De-dupe the customer page: import `tierLabelsForTrade` in `TradeTiers.tsx` and default `labels = tierLabelsForTrade('roofing')` (remove `ROOF_TIER_LABEL`). Align the sibling display maps to the same three strings: `app/q/roof/[token]/page.tsx` `TIER_NAME` + the `:726` heading, `MeasurementReview.tsx:50` `TIER_NAME`, `roofing-compose.ts:85` `ROOF_TIER_LABEL_BY_KEY`. Update `trade-format.test.ts:85-89` only. Do **not** touch pricing.ts, the PDF, or the `narrowQuoteToStructures` stored `labelWord`.
3. **Issue 6 — split form/storeys + provenance (Part 1 only).** In `MeasurementReview.tsx`: widen the stat grid `sm:grid-cols-4 → sm:grid-cols-5`; keep a "Roof form" MiniStat (value `formLabel(m.form)`, hint from `m.field_sources?.form`); add a separate "Storeys" MiniStat (value `m.storeys ?? '—'`, hint from `m.field_sources?.storeys`). Change `formLabel`'s default from `'To confirm'` to `'Not classified'`. Compute hints inline; no new component and no `.test.tsx` (no harness). **Part 2** (storeys/form override that re-prices) is out of scope.
4. **Issue 7 — deep-link the editor.** Append `?edit=1` gated on non-inspection at both call-sites: the promote `router.push` (`:149`, use `routing === 'inspection_required' ? '' : '?edit=1'`, add `routing` to the `promote()` deps) and the already-promoted `<a href>` (`:343`, use the `inspection` flag). Do not touch the shared editor or the dashboard list link.
5. **Issue 8 — additive edge protection.** Add `perimeter_m?: number | null` to `LayoutMaterialMetrics`; in `combinedLayoutMetrics` compute it as the **sum of each structure's own `perimeterM`** (`.metres`); in `layoutMaterials` prefer `metrics.perimeter_m` for the Edge-protection line over the single-polygon `perimeterM`.
6. **Issue 9 — no change** (documented not-a-bug).

## Constraints
- No pricing-model redesign; solar is additive to better/best only, everything else bundled as today.
- Minimal: no new files beyond this spec + tests, no unrelated refactors, no PDF/stored-label edits.
- Solar money invariant: `Σ line_items.total_ex_gst === ex_gst` per tier wherever `line_items` exist.
- `roofing-compose.ts` (incl. `applySolarToTiers`) + `layout-plan.ts` helpers stay **pure**.

## Acceptance criteria & gates
- **T4 (Issue 4)** `roofing-compose` test: `applySolarToTiers` adds `allowance.ex_gst`/`inc_gst` to better+best, leaves good untouched, no-ops when `applies===false`/`inc_gst===0`, and (with `line_items` present) keeps `Σ line_items === ex_gst`; `narrowQuoteToStructures` preserves `quote.solar`.
- **T5 (Issue 5)** `trade-format.test.ts:85-89` asserts the new roofing labels; suite green (no other test asserts the old strings on-screen).
- **T8 (Issue 8)** `layout-plan` test: `combinedLayoutMetrics([main, shed]).perimeter_m === perimeterM(main).metres + perimeterM(shed).metres`, and the Edge-protection lm for `[main, shed]` equals main-alone + shed-alone (additive; no `4×√Σfootprint` collapse).
- **UI (Issues 5,6,7)** `/playwright-cli` (or the authed browser) on `/m/[token]`: renders the new tier labels, a separate provenance-hinted Storeys stat, and an `?edit=1` link for a non-inspection quote; `/q/[token]` shows the renamed labels.
- **Gates each iteration:** `pnpm test`, `pnpm run typecheck`; UI changes verified live; `/review` + `/code-review` clean of blocker/major.

## Examples
<example>
Item 2 (this run's earlier fix) already made `buildTierObjects` keep `Σ line_items === ex_gst` per tier — `applySolarToTiers`' appended solar line follows the same invariant.
</example>
<example>
`tierLabelsForTrade('roofing')` (trade-format.ts) is the existing single-source hub the edit-report tabs already use — `TradeTiers.tsx` should consume it instead of its private `ROOF_TIER_LABEL` copy.
</example>
