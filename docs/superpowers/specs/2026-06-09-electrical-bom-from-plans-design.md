# Electrical BOM-from-plans — design spec

> 2026-06-09 · Status: spike validated, design approved, **not yet built into the app**.
> Planning artifact — saved locally, not committed/pushed per the owner's instruction.

## Problem
Estimating a commercial fit-out from a construction plan set is manual, slow, and
expensive: an estimator reads the floor / RCP / services plans + spec, counts materials,
researches pricing, and estimates labour by trade — ~40 hours and ~AUD $3,000 per job, so
a firm can only bid 5–6 jobs a month. We want AI to draft the bill of materials + labour
estimate so the estimator's involvement drops to ~5 hours of review (~87%), at ~80%
line-item accuracy measured against their own take-off.

## Scope (v1 wedge)
- **Trade:** electrical only (the meeting's concrete example: power & data plan → GPOs,
  data points, 15A circuits, fittings, switchboards). Feeds QuoteMate's existing electrical
  estimate engine rather than rebuilding it.
- **Audience:** a **multi-tenant capability for all electrical tradies** on QuoteMate — many
  tradies upload many plan sets from many architects. Scoped by `tenant_id` like the rest of
  the platform; pricing is **per-tenant** (existing `pricing_book` + overlays + `tenant_custom_assemblies`).
- **Out of scope (v1):** other trades, full multi-trade BOM, the electrical engineer's
  circuit/switchboard schedules (often a separate package — see Open items).

## Feasibility evidence (from the 3 sample plan sets)
| Plan set | Text layer | Implication |
|---|---|---|
| Snap (NSW) | vector, ~44k chars, has Power & Data + RCP | high extractability |
| CityCave (QLD) | vector, ~80k chars, full sheet index + schedules | **validation target** |
| Fitstop (QLD) | raster/scanned (13 chars text) | **measured worst-case floor** (below) |

Three baseline spike runs (whole PDF → Claude, no tiling) produced structured, estimator-grade
take-offs (Snap 28 line-items, CityCave 22 captured, Fitstop 17), each **reading that plan's own
legend** — proving the multi-tenant, legend-anchored approach. **The model's own confidence
pattern validates the design:** items anchored to a schedule/legend quantity or text label = high
confidence; **dense graphical symbol fields (GPOs, data points, downlight grids) = medium/low**,
with the model itself blaming the A2/A3-scale render resolution.

**Raster floor (Fitstop, measured 2026-06-09):** even the scanned set with no usable text layer
did not fail — vision read both the RCP and power sheets, identified 16 legend symbols, and
returned 17 line-items in 66 s, **self-flagging its own weak counts** (downlights `low`, "likely
16–20"; DGPO `medium`, dense reception cluster; AC diffusers/exhaust `low`) while nailing the
legend-/label-anchored items (speakers qty 4 from legend text, the three labelled dedicated
circuits, EDB, fans 1–4). So the worst case is **"degraded but structured and honestly
flagged," not "broken"** — which is exactly the signal the Approach-3 human-correction UI routes
on. Raster still wants tiling for the dense fields, but it is a viable path, not a defer.

## Architecture (Approach 1 engine + Approach 3 refinement; Approach 2 = baseline only)
```
PDF ─┬─ A. text-layer parse → sheet index · legend{symbol→meaning} · schedules · notes · dims
     └─ B. targeted raster → render power&data + RCP sheets at high DPI (pdfium/Chromium)
              └─ tile into grid → legend-anchored vision count per tile (Opus)
                   → sum + de-dupe seams → counts{item, qty, confidence}
        merge(A,B) → item counts → map to per-tenant commercial-electrical assembly catalog
                   → quantities → [reuse estimate engine: price + labour from pricing_book]
                   → draft BOM + labour → grounding validator → human refine (Approach 3) → estimate
     eval: counts/BOM ──vs── estimator ground-truth → per-line accuracy + $ variance + time
```
Each arrow is a **verifiable AI sub-task** (clean input/output, independently checkable). The
unbounded "read plans → make an estimate" is deliberately *not* one step.

## Components (new; pure cores + thin IO, mirroring `lib/estimate` + `lib/signage`)
- `lib/estimation/text-parse.ts` — pure: `pdftotext` output → sheet index, legend, schedules.
- `lib/estimation/raster.ts` — thin IO: PDF page → PNG (Playwright/Chromium now; pdfium when hardened).
- `lib/estimation/tile.ts` — pure: image → grid of tiles + overlap math.
- `lib/estimation/vision-count.ts` — pure prompt builder + parser + thin model call (Opus), legend in prompt.
- `lib/estimation/dedupe.ts` — pure: merge tile counts, de-dupe at seams by location.
- `lib/estimation/map-to-bom.ts` — pure/deterministic: item type → assembly → quantity line.
- Reuse `lib/estimate/run.ts` (tool-calling for prices) + `validate.ts` (grounding) for pricing/labour.
- **Built already (spike + eval):** `scripts/estimation-spike.mjs`, `scripts/estimation-eval.mjs`.

## Data model (new migrations, all `tenant_id`-scoped)
- `plan_uploads` — file, detected sheets, vector-vs-raster flag.
- `plan_extractions` — per-item counts, per-tile provenance + confidence, merged result.
- per-tenant **commercial-electrical assemblies + pricing** (seeded from a reference BOM; each
  tenant overlays their own rates).
- `estimation_ground_truth` + `estimation_eval_runs` — held-out set + accuracy history.

## Eval framework (built, proven)
`scripts/estimation-eval.mjs` scores an extraction JSON against a ground-truth BOM JSON:
keyword-aliased item matching, **count accuracy** (1 − Σ|err|/Σtruth), coverage, AI-extras,
$ variance, and the "40 hr vs minutes" line. Target **≥ 80%**. Approach 2 (single-pass) is the
baseline we measure Approach 1's lift against. Ground-truth template:
`estimation-truth/citycave.ground-truth.template.json`.

## Error handling / failure modes
- Raster fails → fallback renderer → else flag sheet for manual.
- Low-confidence count / symbol-not-in-legend → flag for human (never guess).
- Raster-only PDF (scanned) → vision-only path, lower accuracy, clearly flagged.
- Unpriceable item → human review (same safe-fail posture as the inspection fallback).
- 5-hr human loop (Approach 3 correction UI) is the liability shield; every correction is
  labelled training data (self-learning loop).

## Testing
- Pure-function unit tests: tile/overlap math, seam de-dupe, legend parse, map-to-assembly,
  eval matching.
- The **eval harness is the integration test** — run vs ground-truth, assert accuracy ≥ threshold.
- The spike is the feasibility gate before the tested pipeline is built.

## Open items / dependencies
1. **Ground-truth BOM for CityCave** (owner → John → estimator): line-item counts + pricing +
   labour hours. Gates the real accuracy number + the demo. Doubles as the reference pricing seed.
2. **High-DPI rasteriser** for tiling — `pdftoppm`/`qpdf` absent locally; `unpdf` can't render
   without a canvas lib. Use Playwright/Chromium for the spike; add a pdfium dep only when
   hardening (avoid touching the dependency tree while the parallel branch/lockfile work is live).
3. **Electrical engineer's package?** Confirm whether circuit/switchboard schedules exist
   separately — changes what a "complete" estimate means.

## Status / next
- Done: feasibility proven on 2 vector plan sets; eval harness built + demoed; this spec.
- Next (post ground-truth): score CityCave baseline → build Approach-1 tiling targeting the
  measured dense-field gaps → wire into the per-tenant estimate engine → Approach-3 correction UI.
