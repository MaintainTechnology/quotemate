# Commercial Painting Estimator — build report

**Date:** 2026-06-12 · **Spec:** `2026-06-12-commercial-painting-estimator-design.md` · **Status:** Built, all acceptance criteria green

## What shipped

| Phase | Deliverable | Where |
|---|---|---|
| 0 | Strategy gate | `docs/strategy.md` v11 entry (strategy-reviewer ran — no blocking findings; stale v5 banner fixed) |
| 1 | Migration 107 + seed | `paint_runs`, `paint_rates` (24 AU-default rows, `is_default=true`), `trade`/`doc_type`/`paint_run_id` columns — **applied to prod + dev Supabase** |
| 2 | Upload & classification | `/api/tenant/commercial-painting/upload` (+`/[id]` PATCH/DELETE) — multi-file, plan-pdfs bucket, Sonnet 4.6 vision over mupdf-rasterised first pages, filename-heuristic fallback, nothing rejected |
| 3 | Extraction + reconciliation | `lib/commercial-painting/{extract,reconcile}.ts` — Opus 4.8 plan takeoff + Sonnet measurements transcription run concurrently; pure reconciler (delta >10% flagged, nothing silently dropped/preferred) |
| 4 | Confirmation editor | `PaintTakeoffEditor` — grouped by room, source/delta/confidence chips, system/qty/coats/height edits, separate-price + exclude, manual lines; >50% low-confidence banner |
| 5 | Pricer + quote output | `lib/commercial-painting/price.ts` (pure, traced, unmatched-never-guessed) + `save-quote` route → intakes + quotes rows + Gotenberg tender PDF at `quote-pdfs/quotes/<id>.pdf` served by the existing `/api/q/[token]/pdf` |
| 6 | Repaint preview | `/api/tenant/commercial-painting/preview` — Gemini render from the site photo (image-only PDFs rasterised), repaint-only constraints, conversational refine, non-blocking |
| 7 | Acceptance | `scripts/accept-commercial-painting.ts` + `scripts/accept-paint-preview.ts` against the four real IGA documents |

**Tests:** 56 vitest on the painting slice (pricer maths, height bands, litre rounding, equipment triggers, GST, reconciliation matching/deltas/no-silent-drop, parsers, quote payloads, PDF HTML). Full repo suite 2,771 passing; `next build` green; tsc at the pre-existing 9-error baseline; eslint clean on every new file.

## Validated against the IGA Swan Street documents (17/17 + preview)

- **Classification:** plan set / measurements / services layout correct from filenames alone; `IGA 2.pdf` safely lands `other` (vision corrects to `site_photo` in-app).
- **Plan takeoff (Opus 4.8, 63 s):** 19 surface lines + 6 finishes-schedule entries from the 15-page AS73 set.
- **Measurements transcription (Sonnet 4.6, 40 s):** 37 lines vs the painter's 34 numbered items; 1,076 m² total vs ~1,100 m² expected; **"Retail concrete ceiling (thermal panels) 420 m²" found exactly**.
- **Reconciliation:** 8 matched, 29 measurements-only, 11 plan-only, 44 honest flags — nothing dropped; kitchen/bathroom lines carry `semi_gloss` per the painter's notes.
- **Pricing (seeded rates):** 215.9 h labour, crew of 3, ≈10 days; 192 L across 5 products; **scissor-lift line auto-triggered by the 5.2 m surfaces (3 days)**; tender **$21,262.33 inc GST** (≈$19.8/m² — plausible commercial repaint territory); 0 unmatched lines.
- **Preview:** Gemini rendered `IGA 2.pdf` repainted (light-grey walls, charcoal exposed ceiling) with floor, services, hose reel, furniture and structure pixel-faithful. Artifacts: `quotemate-automation/scripts/output/iga-{before,after}.*`.

## Open items (not blockers)

1. **Painter rate validation** — all 24 seed rows are `is_default=true`; every priced quote discloses "seeded AU commercial defaults pending painter validation" in its assumptions until a real painter tunes them (tenant overlay by `code` is live).
2. **Reconciliation match rate** — 8/19 plan lines auto-matched; the painter's naming granularity differs from the drawings (e.g. per-room wall splits). All divergence surfaces as flags the tradie resolves in the editor — correct per spec, but matching heuristics can be tuned with more pilot docs.
3. **Vision classification of photo-named PDFs** — exercised via the heuristic layer in the acceptance script; the Sonnet vision layer runs in-app per upload.
4. **`GOTENBERG_URL`** must be set in the deploy environment for tender PDFs (quote stands without it — PDF is best-effort).
5. **Customer-facing upload portal, duct/services painting scope, multi-scheme previews** — v1.1 candidates per spec §11.
