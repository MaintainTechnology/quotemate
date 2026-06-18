# SMS AI Receptionist — Quote Accuracy Revamp — Spec

> ⚠️ **SUPERSEDED (2026-06-18) by [`specs/sms-receptionist-accuracy-overhaul.md`](sms-receptionist-accuracy-overhaul.md).** This spec's quote-engine work is folded into the overhaul spec (Phase 0–1 + Phase 7) and broadened to cover catalog data quality (exhaustive + accuracy), services/SMS questions, tradie↔catalog wiring, the dashboard, and Twilio delivery. Build against the overhaul spec, not this one. Kept for history.

> Restructure and revamp the SMS AI Receptionist's quote engine so it builds the most accurate, correct Full Quote possible and stops falling back to the $99 Site Inspection except when a price genuinely cannot be grounded. For the QuoteMate team / tradie tenants.
> Status: Superseded · 2026-06-18

## Objective

The SMS AI Receptionist (Twilio → `/api/sms/inbound` → AI dialog → intake → estimate → quote) is supposed to send the customer a complete Good/Better/Best Full Quote. Today, when the quote engine can't confidently ground a price — missing assembly, missing material, low intake confidence, or a risk flag — the job is downgraded to a paid **$99 Site Inspection** instead of being quoted. That safety net exists to avoid sending inaccurate quotes, but it fires more often than it should: many of those fallbacks are caused by **fixable gaps** in the pricing data or the dialog/routing flow, not by jobs that genuinely can't be quoted over SMS.

This work makes the SMS receptionist quote as much as possible, as accurately as possible. Success is measured against avoidable inspections: a representative set of real jobs that fall back to inspection **today** must produce a complete, grounded Full Quote **after** this build, with the gap behind each fallback fixed at the root. The $99 inspection remains only for jobs the pipeline truly cannot price even with complete data.

This is a multi-trade change covering **electrical (NSW/NECA)** and **plumbing (QLD/QBCC)** across the active tenants. It is scoped to the **SMS channel** and the shared estimate/pricing/routing machinery that feeds the SMS Full Quote.

## Requirements

The build runs in phases. Phase 0 produces the evidence that drives every later fix; Phases 1–2 are the fixes; Phase 3 proves them.

### Phase 0 — Understand and map the current system

1. **R1 — Read the reference docs.** Read all reference docs and extract how the quote is supposed to be built and priced. **`quotemate-automation/public/docs/sms-ai-receptionist-workflow.html` is the latest and most accurate reference of the SMS AI Receptionist system — treat it as the authoritative source of truth; where any other doc conflicts with it, this one wins.**
   - `quotemate-automation/public/docs/sms-ai-receptionist-workflow.html` ← **PRIMARY / latest / most accurate**
   - `quotemate-automation/public/docs/quote-engine-explainer.html`
   - `quotemate-automation/public/docs/pricing-data-accuracy.html`
   - `quotemate-automation/public/docs/estimator-filestore-supplement.html`
   - `quotemate-automation/public/docs/database-visual.html`
   - `quotemate-automation/public/docs/database-architecture.html`
   - `quotemate-automation/public/docs/pricing-flow.html`
   - `quotemate-automation/public/docs/ig-engine-flow.html`
   - `quotemate-automation/public/docs/pricing-transparency.html`

2. **R2 — Trace the live pipeline in code.** Map the actual SMS quote path end-to-end and document each stage that can trigger an inspection downgrade or an inaccurate quote: `app/api/sms/inbound/route.ts` and `lib/sms/*` (dialog + question capture) → `lib/intake/structure.ts` (intake structuring + confidence) → `lib/estimate/run.ts` + `lib/estimate/tools.ts` (RAG + tool-calling price lookup) → `lib/estimate/prompt.ts` / `electrical-prompt.ts` / `plumbing-prompt.ts` → `lib/estimate/validate.ts` (grounding check) → `lib/routing/decide.ts` (confidence/routing → `tradie_review` vs `inspection_required`). Note exact file:line for each downgrade decision.

3. **R3 — Build the representative job set from real data.** Query the live DB to assemble the test set: the top job types by volume (currently downlights, hot water, power points, ceiling fans, blocked drain, plus the rest), the full list of distinct job types covered by `shared_assemblies` for both trades, and the historical `intakes`/`quotes` that routed to `inspection_required`. Record each as a concrete intake fixture that can be replayed through the pipeline.

4. **R4 — Produce a root-cause inventory.** For every distinct way a job currently lands in inspection (or produces a wrong number), record: the trigger (file:line), the layer (`data` or `flow`), the affected trade(s)/tenant(s), whether it is an **avoidable** gap or a **legitimate** inspection, and the proposed fix. This inventory is the contract the rest of the build is checked against.

### Phase 1 — Database data: coverage and correctness (both trades)

5. **R5 — Audit `pricing_book` for every trade/tenant row.** Verify each field is present and sane: `hourly_rate`, `call_out_minimum`, `apprentice_rate`, `senior_rate`, `default_markup_pct`, `risk_buffer_pct`, `min_labour_hours`, GST, licence, and `overlays`. Flag any value that is missing, zero/null where a number is required, stale, or inconsistent across trades/tenants vs the reference docs. Correct every flagged value.

6. **R6 — Close `shared_assemblies` coverage gaps.** For every job type in the representative set (R3) that has no groundable assembly for its trade, add or correct the assembly so the estimate can price it. Assemblies must carry the labour and component data the grounding validator and tool-calling lookup require.

7. **R7 — Close `shared_materials` coverage gaps.** Ensure every material referenced by the in-scope assemblies exists, is correctly categorised, and is priced. Add missing materials and correct wrong prices so no in-scope line item fails grounding for lack of a material.

8. **R8 — Verify tenant overlays resolve.** Confirm `tenant_service_offerings`, `tenant_custom_assemblies`, and `tenant_material_preferences` for the active tenants resolve correctly against the shared library for both trades, so a tenant offering a job type actually has a groundable price path for it. Fix any offering that points at a missing/ungroundable assembly.

9. **R9 — Deliver all data changes as migrations.** Every data correction ships as a new `sql/migrations/NNN_*.sql` plus a matching `scripts/run-migration-NNN.mjs` runner, following the repo convention, with `sql/init.sql` kept representative. Migrations must be re-runnable/idempotent where practical and verified locally or against a copy. (Application to prod is done by the user — see Constraints.)

### Phase 2 — Flow: dialog, intake, and routing

10. **R10 — Fix dialog/question gaps.** Where the SMS dialog fails to capture a detail the estimate needs to ground a price (quantity, fixture type, access, property attributes, etc.), update the question flow / intake structuring so the needed detail is captured before estimation. Capturing the detail must measurably move the affected job from inspection to a grounded quote.

11. **R11 — Fix estimation accuracy bugs.** Correct any flow-layer defect that produces a wrong number even when data exists — e.g. labour-hours math, hourly/apprentice/senior rate application, markup or risk-buffer application, GST handling, or tool-calling lookups that miss a valid assembly. Money-touching LLM steps stay tool-calling only.

12. **R12 — Tune confidence/routing thresholds.** Adjust the confidence/routing rules in `lib/routing/decide.ts` (and the confidence assignment upstream) so a job that produces a fully grounded price is not needlessly diverted to `inspection_required`. The grounding validator is **not** changed; only the routing/confidence thresholds that sit around it. Each threshold change must be justified against a specific case in the R4 inventory.

13. **R13 — Keep legitimate inspections intact.** Jobs the pipeline genuinely cannot ground even with complete data (per the R4 classification) must still route to inspection. The publish/price-hiding behavior for those jobs must be preserved.

### Phase 3 — Verification

14. **R14 — Replay the representative job set end-to-end.** Run each fixture from R3 through the actual estimate → grounding → routing pipeline against the corrected data and confirm that every job classified as avoidable now yields a Good/Better/Best Full Quote (not an inspection), and that the numbers are internally consistent (ex-GST stored, inc-GST displayed).

15. **R15 — Lock wins into automated tests.** Extend `vitest` unit tests and `scripts/test-sms-parity.mjs` so the new coverage, the corrected calculations, and the new routing outcomes are asserted and protected against regression.

16. **R16 — Report coverage against the spec.** Produce a final report mapping each R-number and each R4 inventory item to its fix and its verification result, plus a before/after count of avoidable-inspection job types now quoting.

## Constraints

- **Grounding validator is a hard guardrail.** Do not disable, bypass, or loosen `lib/estimate/validate.ts`. Reduce inspections by improving data coverage, dialog, and routing — not by letting ungrounded prices through. (Matches the project's price-integrity backstop.)
- **Money steps stay tool-calling only.** LLM steps that touch prices must use the tool-calling lookup; never free-form prices.
- **Currency convention.** Stored ex-GST, displayed inc-GST. Do not change this.
- **SMS scope only.** Do not modify voice/solar/dashboard surfaces unless a change is to a shared dependency the SMS Full Quote relies on (e.g. shared estimate/pricing/routing libs), in which case keep the change neutral for the other channels.
- **DB application is the user's.** The build produces migration files + runner scripts and verifies them locally/against a copy; the user reviews and runs them against prod Supabase (`node --env-file=.env.local scripts/run-migration-NNN.mjs`). The build does not write to prod.
- **Migration discipline.** New `sql/migrations/NNN_*.sql` + `scripts/run-migration-NNN.mjs` per change; keep `sql/init.sql` representative; never commit or paste `.env.local` secrets.
- **Next 16 caveat.** Before writing any Next.js code, follow `quotemate-automation/AGENTS.md` and the relevant `node_modules/next/dist/docs/` guide.
- **Confirm before judging.** Treat a value or behavior as "wrong" only after confirming against the docs or code, not against training-data defaults.

## Out of scope

- Voice channel, solar estimator, and the tradie dashboard/CRM (except shared estimate/pricing/routing libs as noted above).
- Stripe Connect / real funds split, and any change to deposit/payment amounts beyond what's needed to display a correct quote total.
- RLS / tenancy policy work, onboarding/provisioning flows, and the eval-rubric framework (the 100 hold-out pairs) — this build extends the parity harness, it does not build the rubric.
- Adding a third trade. Only electrical and plumbing are touched.
- Applying migrations to prod (user does this) and any production deploy.

## Edge cases to handle

- **E1 — Job type with no assembly in either library:** if neither `shared_assemblies` nor `tenant_custom_assemblies` can cover it for the trade, classify it (R4) as legitimate-inspection unless an assembly can reasonably be added (R6); document the choice.
- **E2 — Assembly exists but references a missing material:** add/price the material (R7); the line item must ground after the fix.
- **E3 — Multi-item / quantity jobs (e.g. "12 downlights"):** the dialog must capture quantity (R10) and the estimate must scale labour/materials correctly (R11).
- **E4 — Ambiguous or underspecified request:** the dialog should ask the missing question rather than silently routing to inspection; only after the question is asked and still unanswerable does inspection apply.
- **E5 — Cross-trade tenant:** a job must be priced against the correct `trade` scope; a plumbing job for a cross-trade tenant must not ground against electrical assemblies, and vice versa.
- **E6 — Grounded price but historically low confidence:** R12 threshold tuning must let it quote, but only when grounding actually succeeded — never override a true grounding failure.
- **E7 — Risk-flagged job (safety/compliance):** stays inspection-routed per R13 even if a price could be computed; price-hiding on the quote page is preserved.
- **E8 — Tenant offers a service with no groundable price path:** fix the offering or its assembly (R8); the offering must not produce a silent inspection.
- **E9 — Migration partially applied / re-run:** runner scripts must be safe to re-run without corrupting data (R9).

## Definition of Done

- [ ] R1–R2: A written map of the current SMS quote pipeline exists, naming every inspection-downgrade decision point by file:line.
- [ ] R3: A replayable representative job-set fixture is built from real DB data (top job types + all `shared_assemblies` job types + historical inspection-routed intakes), for both trades.
- [ ] R4: A root-cause inventory exists classifying every inspection trigger as data/flow and avoidable/legitimate, each with a proposed fix.
- [ ] R5: Every `pricing_book` row for both trades has all required fields present and sane; flagged values corrected via migration.
- [ ] R6: Every avoidable job type in the representative set has a groundable assembly for its trade.
- [ ] R7: Every material referenced by in-scope assemblies exists, is categorised, and is priced; no in-scope line item fails grounding for a missing/zero-priced material.
- [ ] R8: Tenant offerings/overlays for active tenants resolve to a groundable price path for both trades; broken offerings fixed.
- [ ] R9: All data changes shipped as `sql/migrations/NNN_*.sql` + `scripts/run-migration-NNN.mjs`, verified locally/against a copy, with `sql/init.sql` kept representative. (Prod application left to the user.)
- [ ] R10: Identified dialog/question gaps are fixed so the SMS flow captures the details the estimate needs.
- [ ] R11: Identified estimation-accuracy bugs (labour, rates, markup, risk buffer, GST, tool lookup) are fixed; money steps remain tool-calling only.
- [ ] R12: Confidence/routing thresholds tuned so grounded quotes aren't needlessly diverted; each change justified against an R4 item; grounding validator unchanged.
- [ ] R13 / E7: Legitimately inspection-only jobs (incl. risk-flagged) still route to inspection with price-hiding preserved.
- [ ] R14: Every avoidable job in the representative set, replayed through the real pipeline against corrected data, now returns a Good/Better/Best Full Quote with internally consistent ex-GST/inc-GST numbers.
- [ ] R15: `vitest` + `scripts/test-sms-parity.mjs` extended to assert the new coverage, calculations, and routing outcomes; suite passes.
- [ ] R16: Final report maps each R-number and R4 item to its fix + verification, with a before/after count of avoidable-inspection job types now quoting.
- [ ] All edge cases E1–E9 are demonstrably handled (test or documented behavior).
- [ ] Constraints honored: grounding validator intact, tool-calling-only pricing, ex-GST/inc-GST convention, SMS-only scope, no secrets committed, no prod writes by the build.

## Open questions

None blocking. If a `pricing_book` value or an assembly's correct real-world AU price is genuinely ambiguous during the audit, it will be surfaced in the R4 inventory for your decision rather than guessed.
