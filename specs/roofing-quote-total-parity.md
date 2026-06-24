# Roofing Quote Total Parity — Spec

## Objective
Every roofing total a tradie or customer sees must reflect **exactly the structures the tradie included** — never the full set of detected structures. Today the downloadable PDF over-counts: it sums the main roof plus every detected secondary structure (sheds/garages), while the Estimation surfaces narrow to the tradie's selection. This spec makes the **PDF, the customer quote page, the dashboard pre-save preview, and the saved quote** all compute the headline total from one canonical rule, lists excluded structures without totaling them, handles inspection-routed structures consistently, and changes the default so only the main roof is included until the tradie opts secondary structures in.

This is a **roofing-only** change. A cross-trade audit (Solar, Aircon, residential Painting, Commercial Painting, electrical, plumbing) confirmed those trades render a single pre-computed total with no include/exclude concept, so their PDF and Estimation totals cannot diverge. Do not modify them.

## Context / background
Key facts established by a code audit (file:line references are the source of truth for the build):

- **Detected structures** live in `MultiRoofQuote.structures: RoofStructurePrice[]` (`lib/roofing/types.ts:249-277`), persisted as jsonb in `roofing_measurements.quote` (written at `app/api/roofing/save/route.ts:113`). Each structure has `role: 'primary' | 'secondary'` (primary = main dwelling/roof; secondary = detected sheds/garages/granny flats), its own `price.tiers[3]`, and `price.routing` (which can route a structure to inspection rather than a price).
- **Authoritative selection** is `roofing_measurements.included_indices int[]` — a **1-based** list of included structure indices (migration 140, `sql/migrations/140_roofing_measurement_selection.sql`). `NULL`/empty means "all structures" (back-compat). Written all-included at save time today (`app/api/roofing/save/route.ts:89,116`); updated by the tradie via `PATCH /api/roofing/measurement/[token]` (`route.ts:71-82`), which also nulls `pdf_path`.
- **Shared narrowing helpers:** `resolveEffectiveIndices({ included, confirmedStructure, paramIndices }, count)` (`lib/roofing/selection.ts:57-78`) only ever *narrows* the persisted set (a customer single-pick `confirmed_structure` or legacy `?s=` link intersects, never widens; empty intersection is ignored). `narrowQuoteToStructures(quote, indices1Based)` (`lib/sms/roofing-compose.ts:218-270`) re-aggregates `combined.tiers` over the included **quotable** subset, summing inspection-routed structures *out* of the total (`roofing-compose.ts:229`), and currently returns `structures: chosen` (it **drops** excluded structures from the rendered list).
- **The bug:** the committed PDF route `app/api/q/roof/[token]/pdf/route.ts` called `ensureRoofQuotePdf(token)` with no selection. Inside `lib/quote/pdf.ts:275`, `const quote = opts.quote ?? row.quote` falls back to the **full** stored quote, whose `combined.tiers` were summed across every structure. `lib/roofing/report-html.ts:45,82` renders `q.combined.tiers` verbatim. Result: PDF total ≥ Estimation total by the sum of excluded structures' prices.
- **Working-tree fix (uncommitted):** `app/api/q/roof/[token]/pdf/route.ts` has already been edited to read `included_indices`/`confirmed_structure`, call `resolveEffectiveIndices` + `narrowQuoteToStructures`, and pass `ensureRoofQuotePdf(token, { quote: narrowed })`. `lib/quote/pdf.ts:273` bypasses the cached `pdf_path` whenever `opts.quote` is set. This spec treats that fix as a starting point to verify, harden (caller audit + "list excluded" behavior), regression-test, and commit — not as finished.
- **Estimation surfaces that already narrow:** customer page `app/q/roof/[token]/page.tsx:130-142`; dashboard `combinedIncludedTotals` (`app/dashboard/roofing/measure/page.tsx:945-969`, skips excluded but does **not** drop inspection-routed structures from the total — an inconsistency to fix); saved Measurement Review `combine` (`app/m/[token]/MeasurementReview.tsx:37-61`).
- **Secondary divergences flagged by the audit (in scope here):** the dashboard *pre-save preview* (`combinedIncludedTotals`) and the *save-as-quote* payload (`measure/page.tsx:269,303`, which sends the full `resp.quote.combined.tiers` rather than narrowing by the local include toggles) are a separate code path from `narrowQuoteToStructures` and can disagree with the customer page / PDF.

### Canonical total rule (the single definition every surface must obey)
For display, each detected structure is in exactly one state:
1. **Included & priced** → shown with its price; **counted** in the headline/combined total.
2. **Included but inspection-routed** → shown labeled "Price on inspection"; **not counted** in the headline total.
3. **Excluded by tradie** (index not in the effective selection) → shown labeled "Not included in this quote"; **not counted** in any total.

**Headline/combined total = sum of tier prices over state-1 structures only.** This identical rule must drive the dashboard pre-save preview, the saved quote total, the customer quote page, and the PDF.

## Requirements
1. **One shared canonical-total helper.** Introduce (or extend an existing) single function that, given the full `MultiRoofQuote` + effective 1-based included indices, returns: the list of all structures annotated with their display state (priced / on-inspection / excluded) **and** the combined tier totals computed over state-1 structures only. Every surface (PDF, customer page, dashboard preview, saved-quote payload) must derive its total from this one helper so they cannot drift. Preserve the existing `narrowQuoteToStructures` aggregation math (`roofing-compose.ts:239-240`) for state-1 structures.
2. **PDF narrows to the selection.** `app/api/q/roof/[token]/pdf/route.ts` reads `quote`, `included_indices`, `confirmed_structure`; computes effective indices via `resolveEffectiveIndices`; and renders the headline total over included-and-quotable structures only. For an identical token, **PDF total == customer-page total**.
3. **Caller audit of `ensureRoofQuotePdf`.** Enumerate every call site (e.g. SMS send, tradie notify, archive-on-download, the download route). Each must either pass the narrowed/selection-aware quote or rely on `pdf_path` being nulled on selection change so this route regenerates. No call site may render `row.quote` (the full quote) when a non-trivial selection exists. The `opts.quote ?? row.quote` fallback at `lib/quote/pdf.ts:275` must never produce an over-counted total for a measurement that has an effective selection.
4. **Excluded structures are listed but not totaled.** On both the PDF (`lib/roofing/report-html.ts`) and the customer quote page (`app/q/roof/[token]/page.tsx`), structures the tradie excluded appear as informational line items labeled to make clear they are not part of this quote (e.g. "Not included in this quote"), and contribute **zero** to every tier total. This requires the renderers to receive the full structure list plus the included subset (not the today-narrowed list that drops excluded structures).
5. **Inspection-routed structures handled consistently.** A structure that is included but inspection-routed is shown labeled "Price on inspection" and excluded from the headline total on **all** surfaces: dashboard pre-save preview, customer page, and PDF. Fix `combinedIncludedTotals` so it drops inspection-routed structures from the total the same way `narrowQuoteToStructures` does.
6. **Dashboard pre-save preview parity.** The dashboard measure page's preview total (`combinedIncludedTotals`, `app/dashboard/roofing/measure/page.tsx:945-969`) must apply the canonical rule (exclude both tradie-excluded and inspection-routed structures) so the preview equals what the customer page and PDF will show for the same selection.
7. **Save-as-quote respects local toggles.** The dashboard save-as-quote flow (`measure/page.tsx:269,303`) must persist `included_indices` reflecting the tradie's local include toggles and must not save a total computed over all structures. The saved quote's stored/denormalized total must equal the canonical total for the persisted selection.
8. **Default inclusion = roof-only.** On initial measurement save (`app/api/roofing/save/route.ts`), `included_indices` defaults to the **primary structure only** (the main roof), not all structures. The dashboard measure page's initial include state must initialize to roof-only as well (secondary structures start unchecked / opt-in). Secondary structures are included only when the tradie opts them in.
9. **Selection change invalidates the cached PDF.** Changing `included_indices` continues to null `pdf_path` (`app/api/roofing/measurement/[token]/route.ts:78-81`) so the next PDF regenerates from the new selection. Verify this is retained and also nulled by the save-as-quote path if it writes a new selection.
10. **Back-compat preserved.** `included_indices` NULL/empty continues to mean "all structures" for already-saved measurements (no backfill). Only new saves write an explicit roof-only selection. Legacy customer-pick (`confirmed_structure`) and `?s=` narrowing behavior is unchanged (intersect, never widen).

## Non-goals
- No changes to Solar, Aircon, residential Painting, Commercial Painting, electrical, or plumbing quote/PDF code — the audit confirmed they have no divergence surface.
- **No backfill/migration** of existing measurements' `included_indices`. Existing all-included or NULL rows are left exactly as they are.
- No change to the roofing pricing engine, tier math, or rounding.
- No new database columns or migrations (reuse the existing `included_indices int[]`).
- No redesign of the report/quote visual styling beyond the minimum needed to render an "excluded / on-inspection" line.

## Constraints
- Next.js 16 App Router. Follow `quotemate-automation/AGENTS.md` and read the relevant `node_modules/next/dist/docs/` guide before writing Next code.
- Currency stored ex-GST, displayed inc-GST. Do not change persisted units.
- Prefer extending the existing `lib/roofing/selection.ts` / `lib/sms/roofing-compose.ts` helpers over duplicating aggregation logic. Exactly one place computes the canonical total.
- Tests are vitest (`*.test.ts`). New logic must be unit-testable without a live DB (operate on `MultiRoofQuote` + indices in memory).
- Keep `narrowQuoteToStructures`'s existing callers working (SMS compose, denorm). If its return shape must grow, do it additively or introduce a sibling function rather than breaking current consumers.

## Edge cases to handle
- Multi-structure job, one secondary excluded → total = primary + remaining included secondaries; excluded one listed, not totaled.
- Primary structure itself routed to inspection → primary excluded from headline total and shown "Price on inspection"; total is over the remaining priced included structures (possibly zero priced structures → total renders as on-inspection / "$0 priced", not a crash).
- `included_indices` NULL or empty (legacy row) → all structures included (back-compat), totals over all quotable structures.
- Customer single-pick `confirmed_structure` set → effective indices = intersection of persisted selection and the pick; empty intersection is ignored (never widens). PDF/page reflect the resulting effective set.
- Single detected structure (no secondaries) → behavior unchanged; default roof-only == that one structure.
- Selection changed after a PDF was generated → `pdf_path` nulled, next download regenerates with the new selection.
- No excluded and no inspection-routed structures → no informational lines rendered; output identical to a clean all-priced quote.
- Tradie excludes every structure → headline total is zero/empty state handled gracefully (no NaN, no crash); all structures listed as not included.

## Definition of done
- [ ] For a multi-structure job (primary + 2 secondary) with one secondary excluded, an automated test asserts **PDF total == customer-page total == dashboard narrowed preview total**, and that this equals the sum of (primary + the one included secondary) tier prices.
- [ ] Automated test: an excluded structure is rendered as an informational "not included" line on both the PDF report HTML and the customer page data, and contributes 0 to every tier total.
- [ ] Automated test: an included-but-inspection-routed structure is shown "Price on inspection" and excluded from the headline total on the dashboard preview, customer page, and PDF (all three derive from the shared helper).
- [ ] Automated test: a new measurement save sets `included_indices` to the primary structure index only (roof-only default).
- [ ] Automated test: a measurement with NULL/empty `included_indices` still totals all quotable structures (back-compat).
- [ ] A repo-wide search confirms every `ensureRoofQuotePdf(` call site either passes a narrowed/selection-aware quote or relies on the nulled `pdf_path` + the download route regenerating; documented in the review.
- [ ] `combinedIncludedTotals` and the save-as-quote payload both go through the shared canonical-total helper (no independent summation remains for roofing totals).
- [ ] Typecheck and lint pass; all existing roofing/SMS-compose tests still pass.

## Open questions
Resolved during the interview:
- Excluded structures on the quote/PDF → **listed but not totaled.**
- Default inclusion when structures are detected → **roof-only by default** (secondary structures opt-in).
- Existing saved measurements → **left as-is, no migration/backfill** (light touch).
