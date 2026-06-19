# Measurable targets & Phase-0 baseline — SMS AI Receptionist Accuracy Overhaul

> Records the concrete acceptance numbers required by the spec's **"Measurable
> targets (set + record in Phase 0)"** section of
> [`specs/sms-receptionist-accuracy-overhaul.md`](../../../specs/sms-receptionist-accuracy-overhaul.md),
> plus the before-state baseline (R4) so before/after is objective rather than
> from memory. Companion to `sms-overhaul-coverage-report.md`,
> `catalog-completeness-matrix.md`, and `catalog-data-provenance.md`.
> Recorded 2026-06-19. Sourced from the committed build + the read-only prod
> audits cited in the companion docs — no values invented.

## 0. Measured baseline — deterministic-pricing build (R16, 2026-06-19)

For the deterministic-pricing spec ([`specs/sms-deterministic-pricing-deploy-readiness.md`](../../../specs/sms-deterministic-pricing-deploy-readiness.md)):

| Metric | Target | Measured now | Source / pending |
|---|---|---|---|
| Determinism diff (same input → same output) | 0 | **0 — deterministic by construction** | `buildDeterministicTiers` is a pure function; unit-proven in `lib/estimate/deterministic-bom.test.ts` ("identical output for identical input"). Live-pipeline ×20 replay is pending the prod `DETERMINISTIC_BOM=1` flip. |
| Grounded-clean replay | all representative jobs | **17/17** | `scripts/replay-representative-jobs.mjs` (read-only, prod data). |
| Price-accuracy band | ±15% v1 → ±10% | **PENDING** | Needs the R15 eval pairs tradie-graded; `scripts/eval-quotes.mjs` + `eval/holdout-pairs.json` are built but all pairs are `needs_grading:true`. |
| SMS delivery success (3 failure conditions) | ≥99% | **PENDING** | Needs the live dev-server/SMS smoke (R52-style); mechanisms unit-verified. |
| Clarify-turn cap | 6, no-progress turns only | **6 (configurable)** | `SMS_CLARIFYING_TURN_CAP` (default 6); R19 counts only no-progress turns; `lib/sms/clarify-gate.test.ts`. |
| Catalog completeness (allowlist job-types) | 100% meant-to-carry | **PENDING probe** | `scripts/measure-deterministic-coverage.mjs` (run against prod to fill). |

## 1. Price-accuracy tolerance

- **Target:** a replayed quote total must fall within **±10%** of the
  real-tradie reference range for that job (proposed default; tighten once a
  larger invoice sample exists).
- **How verified:** `scripts/replay-representative-jobs.mjs` replays 14 job
  types through `validateQuoteGrounding()` + `detectCrossTierDuplicates()` +
  `decideRouting()` (no LLM). Result recorded in `sms-overhaul-coverage-report.md`:
  **17/17 PASS** — 14/14 representative jobs grounded-clean → `tradie_review`,
  3/3 negative guardrails bite.
- **Integrity gate (hard, not tolerance-based):** the grounding validator
  (`lib/estimate/validate.ts`) rejects any ungrounded price outright → $99
  inspection. Tolerance is a *quality* check on top of the *correctness* gate.
- **Source of reference prices:** Reece / Bunnings / Tradelink + NECA award
  rates, per-row provenance in `catalog-data-provenance.md`; unverifiable rows
  flagged to the owner, never fabricated.

## 2. Catalog column-completeness

Target: **100% of *meant-to-carry-data* columns** populated; reserved/unwired
columns excluded by the R16 matrix (`catalog-completeness-matrix.md`).

| Table | Meant-to-carry completeness | Notes |
|---|---|---|
| `shared_assemblies` | 49/49 = 100% | category + clarifying_questions backfilled (mig 121) |
| `shared_materials` | brand 8 NULL → 3 filled (`Generic`), **5 flagged** | mig 120; 5 genuinely-branded rows need owner input (recorded in provenance) |
| `pricing_book` | 7/7 = 100% | mig 119 audit; 1 impossible licence_expiry NULLed; rate outliers flagged to owner |
| `shared_assembly_bom` | core jobs seeded | mig 118 (was 3 rows → all core electrical + plumbing) |

Flagged-unverifiable count (owner decisions pending): **5 material brands + the
pricing_book rate/licence items** listed in `catalog-data-provenance.md` and
`service-content-audit.md`. These are correct "flag-not-fabricate" outcomes, not
build gaps.

## 3. SMS delivery success & latency budget

- **Target:** **≥99%** successful delivery for each of the three sends (AI
  reply, quote/quote-link SMS, tradie notify) under the three failure
  conditions (long/complex job, fresh-conversation first message, rapid
  back-to-back texts).
- **Mechanisms in place (verified by unit tests, see
  `test-coverage-by-requirement.md`):**
  - Long/complex job → `after()` outer try/catch + fallback "snag" SMS (R45);
    near-budget watchdog `isNearMaxDuration` (R48).
  - Fresh-conversation race → idempotent `create_sms_conversation_idempotent`
    RPC + partial unique index (mig 122, R43).
  - Rapid back-to-back texts → adaptive debounce + per-conversation lock +
    `MessageSid` idempotency (R44/R47).
  - Per-send independent retry with backoff (R46), all sends + skips logged (R48).
- **Latency / timeout budget:**
  - `maxDuration = 300` (static export) on `/api/sms/inbound`,
    `/api/estimate/draft`, `/api/intake/structure`.
  - **Platform assumption:** 300s requires **Vercel Pro or Railway** — Vercel
    Hobby caps function duration well below this (per `CLAUDE.md`). Tunable
    operational knobs (debounce, retry counts/delays, near-budget threshold)
    live in `lib/sms/send-reliability.ts` via `getDeliveryKnobs()` /
    `DELIVERY_KNOBS`; `maxDuration` itself must stay a static literal (Next 16
    ignores a computed export).
  - **Alert thresholds (R48):** any send > 120s after inbound; a quote row
    exists but the customer SMS isn't sent within 180s; an `after()` block
    exceeds 80% of `maxDuration`.
- **Baseline status:** the *mechanisms* are unit-verified now. The **measured
  live delivery rate** under the three conditions is captured by the R52
  dev-server / stress smoke run (`sms-overhaul-coverage-report.md` §R52) — that
  is the one target whose numeric baseline is recorded at smoke time, not from
  unit tests. Until that smoke run, treat ≥99% as the target and the per-send
  retry+fallback design as the mechanism, not a measured guarantee.

## 4. Clarifying-turn cap (R24 safety valve)

- **Cap:** **6** consecutive blocked MUST-ASK turns before the deterministic
  readiness gate stops re-asking and routes the job to the $99 inspection
  (so a customer who cannot answer is never trapped in a loop).
- **Configurable:** `SMS_CLARIFYING_TURN_CAP` (default 6, clamped [1,20]).
- **Kill switch:** `SMS_ENFORCE_CLARIFYING_QUESTIONS` (default **ON**; set
  `0`/`off`/`false`/`no` to instantly disable the deterministic override so the
  model's own finish/ask decision stands).
- **Where:** `lib/sms/quote-readiness.ts`
  (`clarifyingEnforcementEnabled` / `clarifyingTurnCap` / `decideClarifyGate`),
  consumed in `app/api/sms/inbound/route.ts` readiness gate; counter persisted
  on `conversation_state.clarify_gate_count`. Tested in
  `lib/sms/clarify-gate.test.ts`.

## 5. Edge-case resolutions recorded here (E1, E8)

- **E1 — job type with no assembly:** migration 118 seeds a baseline BOM for
  every core electrical + plumbing assembly, and `catalog-completeness-matrix.md`
  confirms every one of the 14 representative job types has a groundable
  assembly path (R21 = 14/14, 0 broken). A job whose type has **no** assembly
  for its trade is not force-quoted — the grounding validator finds no
  candidate and the engine routes it to the $99 inspection (the spec's
  legitimate-inspection outcome). Choice documented: add an assembly when
  reasonable (done for the core set), else inspection.
- **E8 — hot-water unknown `system_type`:** captured, never guessed. Migration
  121 adds the system-type question ("Current system type - electric storage,
  gas storage, continuous-flow gas, or heat pump?") to the HWS install rows, and
  `lib/sms/quote-readiness.ts` requires the fuel/energy fact for `hot_water`
  with capture-or-escalate: a stated fuel satisfies it; an explicit "not sure"
  lets finish proceed so the `structure.ts` E8 backstop escalates to inspection
  rather than inventing a gas/electric assembly (aligns with
  `plumbing-prompt.ts` "NO PRICED GAS UPSELL").
