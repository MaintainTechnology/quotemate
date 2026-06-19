# SMS AI Receptionist — Deterministic Pricing & Deploy-Readiness — Spec

> Make QuoteMate's SMS auto-quoter accurate, reliable, and correct enough to deploy and sell, by moving pricing from per-call LLM generation to a deterministic engine, calibrating the catalog to real Australian prices, proving accuracy with an eval harness, and earning auto-send per job-type behind a measurable deploy gate. For the QuoteMate team / tradie tenants.
> Status: Draft (hardened via plan-optimizer) · 2026-06-19
> Builds on (does not replace) [`specs/sms-receptionist-accuracy-overhaul.md`](sms-receptionist-accuracy-overhaul.md) — that spec is built + verified (118/118); this is the deeper architectural layer the adversarial audit + LLM council exposed.

## Objective

The SMS AI Receptionist currently auto-generates Good/Better/Best quotes whose **line-item prices are produced by Claude Opus per call**. An adversarial audit + a 5-member LLM council found the result is **not deployable as an autonomous auto-quoter**: the same job can quote different totals run-to-run (non-deterministic), the prices were never calibrated to real AU costs (unmeasured accuracy), the catalog has integrity gaps, several validation guards ship in observe-only mode, and the dialog over-escalates answerable leads. Spec-conformance (the prior overhaul) is real but measures the wrong thing for real-world money correctness.

This build fixes the root cause: **the LLM stops producing the number.** Its job becomes extraction (turn an SMS thread into a structured job) and scope/recipe selection (which catalog recipe + quantities); a **deterministic engine** computes the price from `recipe × catalogue × pricing_book`; the **grounding validator** becomes a tripwire that should never fire; an **eval harness** proves the dollars are right; and **auto-send is earned per job-type** behind a measurable deploy gate, with the $99 inspection as the safe fallback for everything not yet proven.

Success = for the allowlisted job types, the same intake yields the **same** total every time, that total is within a stated tolerance of real AU prices (measured, not asserted), no silent spec/category/price-invention errors can auto-send, and the system can be honestly sold — autonomous on the proven surface, human-in-the-loop or paid-inspection everywhere else.

## Context / background

- The deterministic machinery largely **already exists but is switched off**: `lib/estimate/deterministic-bom.ts` + `lib/estimate/catalogue.ts` (the engine, gated behind `DETERMINISTIC_BOM`, default OFF), `lib/estimate/spec-guard.ts` (`SPEC_GUARD_MODE`, default `shadow`), `lib/catalogue/category-mapping.ts` `granularToGroundingCategory` (the `sundries`↔`sundry` fold), `lib/estimate/inspection-reason.ts` `sanitizeInspectionReason` (wired this session), and the R24 clarify-cap helpers in `lib/sms/quote-readiness.ts` (added this session). Much of this build is **wire / flip / calibrate**, not greenfield.
- `shared_assembly_bom` is **already seeded (33 rows in prod, migration 118 applied)** — the gap is the path being OFF + labour/prices uncalibrated, not an empty table.
- Top-5 job types ≈ 70% of volume: downlights (43), hot_water (17), power_points (14), ceiling_fans (12), blocked_drain (10) — the realistic initial auto-send surface.
- Live failure modes confirmed in code: `run.ts:~273` (`needs_inspection=true` short-circuits all validation), `run.ts:~299/~322` (`DETERMINISTIC_BOM` gate + silent fallback to Opus pricing), `spec-guard.ts` (shadow default), `validate.ts` (PRICE_TOLERANCE / markup-variant band / loose `categorise()` regex).
- Constraints inherited from the project: money steps stay tool-calling/deterministic — never free-form; grounding validator may be strengthened, never loosened; stored ex-GST, displayed inc-GST; AU/NSW electrical (NECA/AS3000) + QLD plumbing (QBCC/AS3500).

## Requirements

Phased; each requirement is specific and testable. **A behavior is treated as "wrong" only after confirming against docs/code, never against training-data defaults.**

### Sequencing, dependencies & phase gates

Strict ordering — each phase is gated by the one before, and several within-phase dependencies are load-bearing.

- **⓪ gates everything.** R1's coverage number sets the initial `AUTO_SEND_JOBTYPES` and the recipe-authoring backlog; no job-type is allowlisted until its coverage clears the bar (proposed **≥90% deterministic coverage** on its historical intakes — confirm against R1).
- **P0 before any P1 auto-send.** The safety flips (R2–R5) land before `DETERMINISTIC_BOM` is flipped on for any tenant, so a determinism bug can't auto-send.
- **P1 internal order:** R8 (recipe coverage + labour) and R10 (validator as tripwire) precede R6/R7 going live, or the deterministic path emits wrong/ungroundable numbers.
- **P2 integrity → calibration → eval:** R11 (structural data bugs) MUST precede R12/R13 (calibration) — calibrating a catalog with duplicate / NULL-brand / mis-categorised rows calibrates noise. R12/R13 precede a meaningful R15 eval.
- **P3 gates rollout:** no job-type graduates to auto-send (R20/R23) without an R15 eval score for it.
- **P4 is parallelizable** with P2/P3 (it improves conversion, not pricing safety); NOT required for the first pilot auto-send, but required before selling to a new paying tenant.
- **Per-phase exit condition:** a phase is done only when its DoD items are checked, its targeted tests pass, and (data phases) the migration verifies clean on a copy. A phase that can't meet its exit surfaces the blocker (it is not silently skipped).

**Two milestone bars (the founder's checkpoints):**
- **Minimum to auto-send to a PILOT tenant you control:** ⓪ + P0 + P1 + R4 — deterministic, bounded, safe-failing, on the covered job-types only.
- **Minimum to SELL to a NEW paying tenant:** + P2 + P3 + P4 + R14 + R23 — calibrated, measured, conversion-tuned, gated.

**Rough effort (one engineer):** ⓪ ≈ ½ day · P0 ≈ 2–4 days · P1 ≈ 3–5 days · P2 ≈ 1–2 weeks (data-gathering-bound) · P3 ≈ 2–4 days (+ ongoing) · P4 ≈ 3–5 days · P5 ≈ continuous. Critical path to pilot ≈ 1.5 weeks; to sellable ≈ 3–4 weeks.

### Phase ⓪ — Measure first

1. **R1 — Deterministic-coverage probe.** Add `scripts/measure-deterministic-coverage.mjs` that replays all real historical intakes through the deterministic path (read-only) and reports, per job-type, the % that produce a complete priced BOM vs fall back. The result decides the initial auto-send allowlist and which recipes must be authored. Output a per-job-type coverage table; no DB writes.

### Phase P0 — Stop the bleed (make it safe to stay live)

2. **R2 — Auto-send is allowlist-gated.** Auto-send a clean quote only when `intake.job_type ∈ AUTO_SEND_JOBTYPES` (env CSV, default empty) AND the quote came from the deterministic path (R6). Everything else routes to `tradie_review` (quote drafted, prices hidden per the existing publish gate). Implement in `lib/routing/decide.ts` + the dispatch path in `app/api/sms/inbound/route.ts`.

3. **R3 — Close the `needs_inspection` self-declare bypass.** `needs_inspection` from the LLM becomes **advisory input, not control flow** (`run.ts:~273`). Grounding, spec-guard, and the sanity-bounds check always run; tiers are nulled deterministically when routing to inspection (never trust the model to have nulled them); the route-to-inspection decision is made in code (`lib/routing/decide.ts`) from structured signals (ungroundable BOM, risk flags, missing price-critical fields), not from the model's say-so.

4. **R4 — Spec-guard SHADOW → ENFORCE for allowlisted job types.** Set `SPEC_GUARD_MODE=enforce`. A hard spec mismatch (e.g. customer agreed 20A, product is 10A) blocks the affected tier or routes to inspection — it must not ship. First measure the shadow-mode block rate on the 137 historical quotes and fix any over-firing reconcile rule (`lib/estimate/spec-reconcile.ts`) before flipping.

5. **R5 — Constrain `inspection_reason` to a closed enum.** Back `sanitizeInspectionReason` (`lib/estimate/inspection-reason.ts`) with a fixed whitelist of pre-written reasons. A draft that claims `needs_inspection=true` while carrying priced tiers is a CRITICAL anomaly → force-null the prices and log.

### Phase P1 — Make pricing deterministic (the spine)

6. **R6 — LLM never authors the number.** Flip `DETERMINISTIC_BOM=1`. The LLM selects assembly/recipe + quantities (tool-calling); its emitted `unit_price_ex_gst` values are **discarded and recomputed** deterministically from `pricing_book` + catalog rows (`lib/estimate/deterministic-bom.ts`, `catalogue.ts`, consumed in `lib/estimate/run.ts`). The LLM may still author human-readable descriptions / scope-of-works prose.

7. **R7 — Deterministic-or-inspection (no silent Opus fallback).** When the deterministic path cannot price an allowlisted job (no recipe, unpriceable required part, no rate), route to inspection — never fall back to Opus pricing (`run.ts:~322`). Persist a `pricing_path` value (`deterministic | opus_fallback | inspection`) on every `quotes` row. An `opus_fallback` quote is never auto-send-eligible.

8. **R8 — Recipe coverage + labour from the recipe.** Verify every allowlisted job type has a complete `shared_assembly_bom` recipe (already 33 rows seeded; fill gaps via migration), and that labour hours come from the recipe's `default_labour_hours` (per-unit × quantity), not an LLM estimate. Calibrate the labour curve so the known defect is fixed (6 downlights ⇒ 8–10 h, not 10.5–17.5).

9. **R9 — Deterministic sanity-bounds layer.** Add `lib/estimate/sanity-bounds.ts` + a `job_type_bounds` table (per trade/job: max labour hours, min/max total, per-unit labour). A quote outside its band routes to inspection (not auto-corrected — an out-of-band total signals a wrong scope). Catches the labour/total error class that per-line grounding cannot see.

10. **R10 — Collapse the now-redundant grounding seams; keep the validator as a tripwire.** Under deterministic pricing: markup is exactly `pricing_book.default_markup_pct`, so set the grounding markup tolerance to **exact** (remove the ±5pp variant band; keep only a ±$0.50 rounding epsilon) in `lib/estimate/validate.ts`; ground each line against its specific catalog `sourceId`/canonical category (wire `granularToGroundingCategory`), not the loose `categorise()` regex; keep the R12 safety-category whitelist. The validator must never fire on the deterministic happy path — a firing is a CRITICAL alert, not a routine downgrade. **The validator is strengthened, never loosened.**

### Phase P2 — Data integrity → AU calibration (integrity FIRST)

11. **R11 — Fix structural catalog data bugs.** Finalize `sundry → sundries` and add a category **enum / CHECK constraint** so the mismatch cannot recur; backfill the 6 `brand=NULL` rows; de-duplicate products (+ a unique index on trade+category+brand+spec); complete every allowlisted job type's Good/Better/Best spread (3 distinct real products). Ships as migration(s) + `_down.sql`.

12. **R12 — Calibrate material prices to real AU buy prices.** Replace estimated-midpoint `shared_materials.default_unit_price_ex_gst` with real Q2-2026 trade-counter buy prices — Reece/Tradelink (plumbing), L&H/MMEM/Middys (electrical; **not** Bunnings RRP, which over-prices). Record per-row provenance (SKU/source or "flagged — needs tradie input"); **flag, never fabricate** unverifiable values. Persist references in a `supplier_price_refs` table (`item, supplier, sku, price_ex_gst, source_url, captured_at`) so re-calibration (R26) can diff against a stored source.

13. **R13 — Calibrate rates + flag outlier tenants.** Derive the defensible hourly band from a **loaded-cost build** (base award + super + leave/LSL + tool/vehicle + overhead + margin), not a single guessed number; validate `pricing_book.hourly_rate` / `default_markup_pct` / `min_labour_hours` against that band + NECA (NSW electrical) + QBCC/award (QLD plumbing). The outlier tenants ($200/hr + 42.8%, 14% markup) are **tenant-entered → flagged for the tradie to confirm in the dashboard, never silently overwritten**; an out-of-band tenant's quotes are forced to `tradie_review` until confirmed.

14. **R14 — Tenant cold-start gate.** A tenant with an unconfirmed/empty catalogue must not auto-send (it would quote off generic defaults, not real buy prices). Add `tenants.pricing_confirmed_at`; auto-send is eligible only after the tradie confirms rates + top buy prices in onboarding. Until then: `tradie_review` only.

### Phase P3 — Eval harness (the proof; gates deploy)

15. **R15 — Hold-out eval harness.** Build `scripts/eval-quotes.mjs` running the live deterministic path over **≥30 (target 100)** `(intake → tradie-verified expected G/B/B)` pairs sourced from the 157 real intakes + tenants' past quotes. Score on a 6-dim rubric: price within band, material correctness, **BOM completeness vs the tradie-expected line set** (the omitted-material check), tier-spread sanity, labour-hours sanity, route correctness. Wire into CI as a non-regression deploy gate; no pricing/data/prompt change ships if the score regresses.

16. **R16 — Record measured baseline + targets.** Fill the measured-baseline column in `docs/markdown/measurable-targets.md`: determinism diff (target 0), price-accuracy band (**±15% v1, tightening to ±10%** as the set grows), eval pass-rate per job-type, delivery success. State the numbers; do not assert accuracy without them.

### Phase P4 — Dialog / intake correctness (conversion, not safety)

17. **R17 — Reconcile the 3-way job_type classification.** Where the dialog, slot-extractor, and intake-structurer classify `job_type`, add a deterministic reconciliation: on disagreement, ask one targeted clarifying question or route to inspection — never silently pick one (wrong job_type = correct price for the wrong job). Persist all classifications + the resolution.

18. **R18 — Confidence gates on price-critical fields only.** Split readiness into price-critical facts (drive the BOM) vs nice-to-haves; only price-critical gaps may block a quote (`lib/sms/quote-readiness.ts`, `lib/intake/quality.ts`). Missing non-pricing fields become stamped assumptions/risk-flags, not inspections.

19. **R19 — Clarify-cap counts unanswered MUST-ASK turns, not total turns.** Change `decideClarifyGate` (`lib/sms/quote-readiness.ts`) so the cap increments only on turns that add no new price-critical fact; a cooperative-but-slow customer who keeps answering is not escalated to inspection.

### Phase P5 — Staged rollout

20. **R20 — Per-tenant, per-job-type graduated rollout.** Enable auto-send one tenant + one job-type at a time. A job-type joins `AUTO_SEND_JOBTYPES` for a tenant only after it clears the deploy gate (R23) AND **≥10 real tradie-confirmed sends with no material omission or price correction** — the human-in-the-loop check on the recipe itself, which is the one error class no automated guard (grounding, spec-guard, sanity-bounds) can catch. Cross-trade tenant last.

21. **R21 — Kill-switch drill.** Confirm `AUTO_SEND_JOBTYPES=""` (and the existing kill-switch flags) instantly reverts every tenant to `tradie_review` with no auto-sends. Verified in a staging flip.

22. **R22 — Weekly accuracy review + auto-demote.** A recurring review of the eval scorecard + post-send tradie-correction log; any job-type whose post-send tradie-correction rate exceeds **a set threshold (proposed: >20% of sends corrected, or any single correction >±15%)** is automatically dropped from the allowlist pending re-calibration.

### Cross-cutting

23. **R23 — The deploy gate (definition).** Encode in `lib/routing/decide.ts` a per-tenant, per-job-type readiness check. A job-type may auto-send only when ALL hold: determinism diff = 0; ≥80% of that trade's eval pairs in band; tenant `pricing_confirmed_at` set; validator-fire rate = 0 on the trade's replay set; sanity-bounds pass. Anything failing ⇒ forced `tradie_review`, logged with which gate failed.

24. **R24 — Non-regression.** The full `vitest` suite stays green (currently 3877 passing) and `scripts/test-sms-parity.mjs` is extended; no change introduces a new failing test. The deterministic-replay (`scripts/replay-representative-jobs.mjs`) stays green and gains the same-input-twice determinism assertion.

25. **R25 — Migration discipline.** Every data/schema change ships as `sql/migrations/NNN_*.sql` + `scripts/run-migration-NNN.mjs` + a `_down.sql` rollback + pre-apply backup snapshot, verified locally/against a copy. The build never writes to prod; the user applies migrations.

26. **R26 — Price-drift re-calibration + tradie-edit feedback loop.** A scheduled (quarterly) re-calibration re-checks the `supplier_price_refs` sources and opens a review when a source has drifted >10%; and every tradie edit of an auto-sent quote is captured as a new `(intake → corrected-quote)` eval pair (R15), so the eval set and measured accuracy grow from real corrections rather than rotting.

27. **R27 — Observability.** Persist and surface per quote: `pricing_path`, grounding result, routing decision, and the auto-sent flag. A dashboard/report shows % deterministic vs opus_fallback vs inspection, % auto-sent, and **0 ungrounded-sent**. Autonomy that cannot be observed cannot be responsibly sold.

## Non-goals

- Stripe Connect / real funds split (test-mode Checkout is fine for pilot).
- Twilio delivery-reliability hardening (R42–R47 of the overhaul spec) — needed before *scaling* tenant count, not before this deploy.
- Dashboard surface polish beyond the rate/catalogue-confirmation onboarding step (R14) and the outlier-flag surface (R13).
- A third trade / trades registry.
- Wiring apprentice/senior rates into the estimator (mark reserved; the deterministic engine uses a single hourly rate).
- Making the LLM "better at pricing" — the whole point is that it no longer prices.
- Re-doing the overhaul spec's already-verified work (dedup R5–R8, sanitisation, rollback migrations) except where this spec strengthens it (e.g. markup tolerance → exact).

## Constraints

- **LLM never authors money** — prices/markups/labour come from the deterministic engine over DB rows; the LLM does extraction + recipe selection + prose only.
- **Grounding validator strengthened, never loosened**; it becomes a tripwire that should not fire on the deterministic path.
- **Currency** stored ex-GST, displayed inc-GST.
- **Never overwrite tenant-entered values** — calibration fills nulls / corrects the shared library; tenant `pricing_book`/catalogue entries are flagged for confirmation, not rewritten.
- **Flag, never fabricate** unverifiable AU prices/rates — record provenance.
- **DB application is the user's** — build produces migrations + runners + `_down.sql` + backups; never writes prod.
- **AU domain** — electrical NSW (NECA/AS3000), plumbing QLD (QBCC/AS3500); electrical buy prices from trade counters, not retail RRP.
- **Feature-flag risky behavioral changes** with safe defaults + kill-switch (`DETERMINISTIC_BOM`, `SPEC_GUARD_MODE`, `AUTO_SEND_JOBTYPES`, `SMS_ENFORCE_CLARIFYING_QUESTIONS`).
- **Next 16 caveat** — read `quotemate-automation/AGENTS.md` + the relevant `node_modules/next/dist/docs/` guide before editing any Next route/component.

## Risks & mitigations

- **Determinism shrinks the auto-quotable surface below commercial viability.** If recipes cover too little real traffic, most jobs route to inspection and the "auto-quoter" pitch collapses. → R1 measures coverage *first*; the answer to thin coverage is **author more recipes for the top job-types** (top-5 ≈ 70% of volume), never relax determinism. Go/recipe-authoring is decided on the R1 number, not a guess.
- **Deterministic-but-confidently-wrong recipe (omitted/under-specified material → under-quote).** Grounding catches a wrong *price* and spec-guard catches a wrong *product*, but neither catches a recipe that *omits a needed line* — and a confident wrong auto-send is worse than a visibly-uncertain one because nobody re-checks it. → **human-in-the-loop on the recipe** (R20 graduation: ≥10 reviewed sends with no omission), a "BOM completeness vs tradie-expected" dimension in the eval (R15), and sanity-bounds (R9) for gross omissions. This is the residual risk the whole rollout is shaped around.
- **Calibration data is gated/unobtainable.** Supplier trade prices may sit behind a login. → flag-not-fabricate (R12); a job-type with unverifiable inputs stays off the allowlist and routes to inspection (safe). Capture prices via the pilot tradie's own supplier accounts during onboarding (R14).
- **Eval ground-truth is scarce (only 4 pilot tenants).** → start at ≥30 pairs on the top-5 at ±15%; tighten toward ±10% as tradie-graded pairs accrue (R16); every tradie edit becomes a new eval pair (R26).
- **Spec-guard ENFORCE over-blocks → too many false inspections.** → measure the shadow block-rate on the 137 historical quotes and fix the over-firing reconcile rule before flipping (R4); track avoidable-inspection rate after.
- **Calibrated prices rot.** A "calibrated once" catalog drifts as supplier prices move. → quarterly re-calibration + a >10% drift alert (R26).
- **Migration corrupts live data.** → every data migration ships `_down.sql` + a pre-apply backup snapshot, verified on a copy; the user applies (R25).

## Edge cases to handle

- Allowlisted job with no complete recipe → route to inspection (R7), never Opus-price.
- Same intake submitted twice → byte-identical Good/Better/Best totals (R6).
- LLM emits `needs_inspection=true` with populated priced tiers → tiers force-nulled, validation still ran (R3/R5).
- LLM emits `needs_inspection=false` with a hallucinated price → still grounded/sanity-checked; downgrades if it fails (R3/R9/R10).
- Chosen product contradicts the customer's agreed spec (10A vs 20A) → tier blocked or routed, never shipped (R4).
- Tenant rate out of NECA/QBCC band → flagged + forced `tradie_review`; tenant value not overwritten (R13).
- New tenant with empty/unconfirmed catalogue → no auto-send (R14).
- 6-downlight job → labour 8–10 h and total within band; 17.5 h would fail the sanity bound → inspection (R8/R9).
- 3-way job_type disagreement → one clarifying question or inspection, never a silent pick (R17).
- Cooperative-but-slow customer (e.g. 8 turns, each adding a fact) → reaches a quote; circular customer (no new facts) → escalates at the cap (R19).
- Unverifiable price/rate during calibration → flagged with provenance, value left as-is, job-type may stay off the allowlist (R12/R13).
- Deterministic coverage for a job-type below the bar → that job-type is not on the allowlist (R1/R20).
- A calibration migration is wrong after apply → revert via `_down.sql` + backup snapshot (R25).

## Definition of done

- [ ] R1: coverage probe exists and reports per-job-type deterministic coverage on the 157 real intakes.
- [ ] R2: auto-send is allowlist-gated; non-allowlisted job ⇒ `tradie_review`, no customer SMS (test + manual).
- [ ] R3: `needs_inspection` cannot skip validation; tiers force-nulled on inspection; routing decided in code (test).
- [ ] R4: `SPEC_GUARD_MODE=enforce` for allowlisted types; a spec mismatch blocks/routes, never ships; shadow over-block rate measured first (test on 137 quotes).
- [ ] R5: `inspection_reason` restricted to the enum; priced-tiers-while-inspection anomaly nulls prices + logs CRITICAL (test).
- [ ] R6: `DETERMINISTIC_BOM` on; LLM prices discarded/recomputed; **same intake ×20 ⇒ identical totals** (CI assertion).
- [ ] R7: deterministic-or-inspection (no silent Opus fallback) on allowlisted jobs; `pricing_path` persisted on `quotes`; `opus_fallback` never auto-sends.
- [ ] R8: every allowlisted job has a complete recipe; labour from recipe; 6-downlight ⇒ 8–10 h (replay assertion).
- [ ] R9: sanity-bounds layer routes out-of-band quotes to inspection; known-bad case caught on the 137-quote replay.
- [ ] R10: markup tolerance exact, category match by sourceId/canonical, safety whitelist enforced; validator never fires on the deterministic happy path (replay) and is not loosened.
- [ ] R11: 0 `sundry` rows / 0 NULL brands / 0 duplicate SKUs / complete 3-tier spreads on allowlisted types (audit script); category enum/CHECK in place.
- [ ] R12: allowlisted material prices within ±15% of a documented AU source or flagged; per-row provenance recorded.
- [ ] R13: every tenant rate/markup in-band or flagged-for-confirmation; out-of-band tenant forced to `tradie_review`; no tenant value overwritten.
- [ ] R14: unconfirmed-catalogue tenant cannot auto-send; flips eligible only after `pricing_confirmed_at` set (test both states).
- [ ] R15: eval harness runs ≥30 graded pairs on the live path, scores the 5-dim rubric, and gates CI.
- [ ] R16: `measurable-targets.md` baseline column filled with measured determinism diff, eval pass-rate, and the ±15%→±10% band decision.
- [ ] R17: 3-way job_type disagreement ⇒ clarify/inspect, never silent pick (test).
- [ ] R18: a job complete on price-critical fields quotes even with non-pricing gaps; missing price-critical field ⇒ clarify (test per top job type).
- [ ] R19: cooperative-but-slow conversation reaches a quote; no-progress conversation escalates at the cap (test).
- [ ] R20: a documented per-tenant/per-job-type graduation procedure; a job-type joins the allowlist only via the gate + ≥10 confirmed sends.
- [ ] R21: kill-switch flip reverts all tenants to `tradie_review` (staging-verified).
- [ ] R22: weekly review process + auto-demote rule defined and wired to the post-send correction log.
- [ ] R23: the deploy gate is enforced in code; a job-type failing any condition cannot auto-send, with the failing condition logged.
- [ ] R24: full `vitest` suite green; parity + replay harness extended (incl. determinism assertion); no new failing test.
- [ ] R25: every data change ships as migration + runner + `_down.sql` + backup, verified on a copy; no prod writes by the build.
- [ ] R26: quarterly re-calibration + >10% drift alert exist; tradie edits of auto-sent quotes flow into the eval set.
- [ ] R27: per-quote pricing_path / grounding / route / auto-sent observable; dashboard shows the distribution + 0 ungrounded-sent.
- [ ] Sequencing & milestones: dependency order + per-phase exit conditions are documented; the two milestone bars (pilot auto-send / sell-to-new-tenant) are explicit and their gating requirements enumerated.
- [ ] Risks: each item in "Risks & mitigations" has its mitigation implemented or explicitly accepted; the omitted-material risk is covered by the R20 recipe-review graduation + the R15 BOM-completeness dimension.
- [ ] All edge cases above are demonstrably handled (test or documented behavior).
- [ ] Constraints honored: LLM authors no money; validator intact/strengthened; ex/inc-GST; flag-not-fabricate; never-overwrite-tenant; migrations-user-applies; feature-flagged with kill-switches.

## Open questions

- **Initial allowlist:** which job types ship first is decided by R1's coverage number — expected to be the top-5 (downlights, hot_water, power_points, ceiling_fans, blocked_drain). Confirm after the probe runs.
- **Eval "ground truth":** how many of the 30–100 expected-quote pairs can the 4 pilot tenants actually verify vs sourced from published AU ranges? Affects how soon the band tightens to ±10%.
- **Sanity-bounds source:** seed `job_type_bounds` from the calibrated recipes, or from tradie-confirmed ranges? (Default: derive from recipes, then tradie-confirm.)
