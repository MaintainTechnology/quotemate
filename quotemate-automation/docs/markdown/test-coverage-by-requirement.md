# Test coverage by requirement (R5–R49)

> Maps the QuoteMate test suite to the spec requirements it exercises.
> Generated for the R51 test-consolidation pass — **2026-06-18**.
> Source of truth for the totals below is `npx vitest run` (vitest 4.1.6,
> Node-only environment, config: `vitest.config.ts`).

## Full-suite totals

```
$ npx vitest run
 Test Files  272 passed | 1 skipped (273)
      Tests  3866 passed | 1 skipped (3867)
   Duration  ~33s
```

- **273 test files**, **3867 tests** — 3866 pass, **1 skipped**.
- The single skip is `lib/estimation/refine.live.test.ts` (a `*.live`
  integration test, env-gated; not part of the deterministic unit run).
- Test discovery globs: `lib/**/*.test.ts`, `tests/**/*.test.ts`,
  `app/**/*.test.ts`. Playwright e2e specs (`tests/e2e/**`) are excluded
  from the vitest run.

> Determinism note: every requirement below is covered by exercising the
> pure helpers directly (`validateQuoteGrounding`, `detectCrossTierDuplicates`,
> `decideRouting`, `evaluateIntakeQuality`, `evaluateQuoteReadiness`,
> `rulesAsText`, the dispatch/retry seams, route handlers with a stubbed
> Supabase). **No test in this map issues an LLM call** — the Opus draft is
> never invoked, so replays stay deterministic.

---

## This overhaul's new / extended files → requirements

| Requirement | What it guards | Primary test file(s) | Tests |
|---|---|---|---|
| **R5** | Within-tier duplicate-charge prevention — the same catalogue row charged twice in one tier, even with **different descriptions** or **different markup bands**; price-only anchor resolves the dup; labour/after-hours lines never false-flag against a same-priced material row | `lib/estimate/validate-dedup-r5.test.ts` (extends `validate-dedup.test.ts`, the original D-1 guard) | 8 (+ D-1) |
| **R6** | Cross-tier duplicate-charge prevention — same row at **unframed differing quantities** across Good/Better/Best is flagged; framed (scope_of_works / assumptions / customer-prose) differences and same-qty progression are allowed; price-only cross-tier anchor | `lib/estimate/validate-cross-tier-dedup.test.ts` | 18 (R6+R8) |
| **R7** | `dropDuplicateAppendedLines` — a recipe-appended extra that double-charges an Opus line is dropped (fail-closed); labour is always additive and never dropped; driven by the `recipe_origin` marker (not positional preCount) so the SWAP path is sound | `lib/estimate/run-phase1.test.ts` | (38 shared) |
| **R8** | Cross-tier dedup runs over the **full merged tier set** in the edit route, with scope_of_works / assumptions carried forward so a framed multi-qty edit is not falsely 422'd | `lib/estimate/validate-cross-tier-dedup.test.ts` | (in 18) |
| **R9** | `validateAppendedLines` — a recipe that appends an **un-grounded** extra is caught and the offending tier flagged; failure isolated per-tier; framed cross-tier extras pass, unframed still fail | `lib/estimate/run-phase1.test.ts` | (in 38) |
| **R10** | `markKbRewrittenLines` — a KB-rewritten price is stamped (`kb_origin` + `risk_flags`) so it can't launder silently; a stamped-but-ungrounded price still fails the validator | `lib/estimate/run-phase1.test.ts` | (in 38) |
| **R11** | After-hours surcharge acceptance — validator only accepts an above-rate labour/callout price when the line is **tagged** after-hours AND the multiplier is finite, `>1`, and `≤` the cap (2.5); forged tags / garbage multipliers / untagged inflation all fail | `lib/estimate/validate-after-hours-r11.test.ts` (extends `validate-after-hours.test.ts`, the P-1 baseline) | 12 (+ P-1) |
| **R12** | Safety-critical category whitelist + cross-trade mismatch guard — a smoke-alarm / gas / switchboard / RCBO line can only ground off a row carrying the same safety tag; an electrical line can't ground off a same-priced plumbing row; mixed safety+non-safety rows still ground on the shared non-safety tag (R12.1) | `lib/estimate/validate-safety-category.test.ts` | 24 |
| **R13** | `sanitizeInspectionReason` — strips invented price claims, calms shouting, length-caps on a word boundary; safe default for empty/nullish; clean reasons pass through (no-price-leak on a no-price quote) | `lib/estimate/inspection-reason.test.ts` | 8 |
| **R14** | Post-reconciliation grounding **re-check** — re-running the validator catches an ungrounded number introduced after the first pass; a still-grounded draft passes (no false downgrade) | `lib/estimate/run-phase1.test.ts` | (in 38) |
| **R15 / R15b** | `enforceSpecMismatch` — a hard spec mismatch blocks only the offending tier(s) in enforce mode (or routes to inspection if no safe tier remains); shadow/off are no-ops; partial block stamps a machine-readable `spec_block` + `needs_review` signal; stale signal cleared on a re-run | `lib/estimate/run-phase1.test.ts` | (in 38) |
| **R24** | Per-job MUST-ASK injection — `mustAskLines` is the one canonical mandatory-question set; `rulesAsText` renders it as a hard pre-finish gate; the deterministic readiness gate blocks `finish` until every per-job MUST-ASK is answered, with robust answered-detection (transcript recovery, no brittle re-ask loops) | `lib/sms/mustask-injection.test.ts`, `lib/sms/quote-readiness.test.ts` | 29 + 51 |
| **R25** | Conditional + classifier questions — power_points 600 mm wet-area question is conditional on the room; smoke_alarms swap-vs-compliance classifier; affirmative/decline detection breaks re-ask loops | `lib/sms/quote-readiness.test.ts` | (in 51) |
| **R26 / E8** | hot_water unknown-fuel stops the `energy_source` loop ("not sure" → finish, then structure.ts E8 backstop escalates to inspection); `requested_specs` parser degrades to `{}` and never throws | `lib/sms/quote-readiness.test.ts`, `lib/intake/structure.test.ts` | (in 51) + 27 |
| **R27** | Inspection-trigger escalation rendering — `rulesAsText` lists each job-type's triggers as `escalate_inspection` rules in addition to the universal list | `lib/sms/mustask-injection.test.ts` | (in 29) |
| **R28** | Quality gate — `job_type='other'` is quotable when name + scope are usable (the "bug zapper" fix); LOW + missing critical fields still 'empty' | `lib/intake/quality.test.ts` | 20 |
| **R29** | Safe-default guard / decline-escape — a natural-language decline waives a slot-backed MUST-ASK; a never-addressed field still blocks; SYSTEM_PROMPT carries the guard | `lib/sms/mustask-injection.test.ts`, `lib/sms/quote-readiness.test.ts` | (shared) |
| **R31** | `PATCH /api/tenant/me` service-toggle cache bump — a service / custom-service toggle stamps a fresh `service_version` into every pricing_book overlay (preserving other keys); a pricing-only PATCH does not churn the stamp | `app/api/tenant/me/route.test.ts` | 11 (R31+R36) |
| **R33** | `POST /api/tenant/bom/fork` category-gap surfacing — fork still creates rows AND reports forked lines whose `material_category` has no active tenant catalogue product; canonical `normaliseCategory` comparison; degrades (never blocks) on a catalogue read error | `app/api/tenant/bom/fork/route.test.ts` | 8 |
| **R36** | Per-service delta contract — single/array `service_delta` upserts only the named rows (anti-clobber); delta wins over the legacy dict; malformed delta → 400; pure helpers in `service-delta.ts` | `app/api/tenant/me/route.test.ts`, `lib/dashboard/service-delta.test.ts` | (in 11) + 18 |
| **R37** | Catalogue-coverage badge resolver — same resolver drives Catalogue / Estimating / Recipes so a category is 'catalogue' or 'generic' everywhere | `lib/dashboard/badge-state.test.ts` | 10 |
| **R38** | Fork-baseline catalogue-gap mapper — `mapForkGaps` / `lineHasGap` / `forkGapSummary` over baseline × catalogue | `lib/dashboard/fork-gaps.test.ts` | 7 |
| **R39** | `POST /api/tenant/trades` activate-a-new-trade — inserts pricing_book row, seeds offerings, seeds an EMPTY licence slot, returns `trades[]`; noop when unchanged; empty `trades[]` → 400; licence fieldset rendering | `app/api/tenant/trades/route.test.ts`, `lib/dashboard/licence-fieldsets.test.ts` | 4 + 9 |
| **R40** | Cross-table service name-collision detection + Services-tab display annotation | `lib/dashboard/service-delta.test.ts`, `lib/dashboard/name-collision.test.ts` | (in 18) + 7 |
| **R42** | `isNearMaxDuration` — `after()`-budget margin alert (default 85%); safe for nonsensical inputs | `lib/sms/inbound-helpers.test.ts` | (in 29) |
| **R43** | `decideConversationUpsert` — ON CONFLICT DO NOTHING race: use created row, else adopt the existing winner, else fail | `lib/sms/inbound-helpers.test.ts` | (in 29) |
| **R44** | `arrivalTimestampsFromTurns` + `adaptiveDebounceMs` — current un-replied inbound burst timing; debounce extends for fast bursts, caps at 4×, never drops a message | `lib/sms/inbound-helpers.test.ts`, `lib/sms/send-reliability.test.ts` | (shared) |
| **R46** | Send reliability — `isRetryableCode` / `isRetryableSendError` classification (429/5xx/NETWORK/abort retryable; carrier-permanent terminal); `backoffDelayMs` monotonic+capped+jitter; `retryWithBackoff` / `sendWithRetry` retry budget; `dispatchQuoteMessage` **never throws** (throw-guard); twilio `res.text()` body-read failure on a 2xx is **not** a retryable NETWORK code (no duplicate resend) | `lib/sms/send-reliability.test.ts`, `lib/sms/send-quote-dispatch.test.ts`, `lib/sms/dispatch-throw-guard.test.ts`, `lib/sms/twilio-body-read.test.ts`, `lib/sms/inbound-helpers.test.ts` | 50 + 14 + 2 + 6 (+29) |
| **R47** | `decideSidDedup` + `classifyInboundInsert` + `sideEffectsAllowed` — MessageSid idempotency (fail-open on no SID), unique-violation race → ack-duplicate, side effects only on a clean finish (duplicate-quote / held-choice / in-flight guards) | `lib/sms/inbound-helpers.test.ts` | (in 29) |
| **R48** | Send-outcome record + `logSendOutcome` — `buildSendOutcome` / `isAlertableStatus` / `describeError`; alertable failures logged on the err channel with structured kv | `lib/sms/send-reliability.test.ts`, `lib/sms/send-quote-dispatch.test.ts` | (shared) |
| **R49** | Delivery-knob env parsing — `parseIntKnob` / `getDeliveryKnobs` defaults, clamping, `max < base` monotonic raise, garbage fallback | `lib/sms/send-reliability.test.ts` | (in 50) |

Other dashboard helpers contributing to the v6 onboarding surface (no
single R-tag in-file, but part of the same overhaul): `coverage.test.ts`
(29), `invoice-calibration.test.ts` (24, A5), `pricing-wizard.test.ts`
(40). All green.

---

## Pre-existing baselines these requirements build on

| Baseline | File | Note |
|---|---|---|
| D-1 within-tier dup guard (2026-05-26) | `lib/estimate/validate-dedup.test.ts` | R5 strengthens it for differing descriptions + markup bands |
| P-1 after-hours acceptance (2026-05-25) | `lib/estimate/validate-after-hours.test.ts` | R11 hardens the multiplier type/value check |
| R-1 strict-UUID grounding / units / row-id | `validate-row-id.test.ts`, `validate-units.test.ts` | grounding backstop the dedup guards layer onto |
| Quality gate (voice == SMS) | `lib/intake/quality.test.ts` | R28 is the bug-zapper relaxation |

---

## The SMS parity harness (`scripts/test-sms-parity.mjs`)

A cross-channel self-check asserting the **SMS path produces the same
customer SMS / tradie-notify / dialog / quality-gate / money-path
decisions the voice path uses**, run on TS-imported helpers (no network,
no Supabase, no Twilio, **no LLM**).

- **Run command (the ONLY one that works):**
  `node --import tsx scripts/test-sms-parity.mjs`
- **Why not raw `node` / `node --test`:** the harness imports
  `lib/sms/templates.ts` (and now `lib/estimate/validate.ts`,
  `lib/estimate/inspection-reason.ts`), which use the `@/lib/...`
  TypeScript path alias. Raw `node` and `node --test` cannot resolve that
  alias and fail with `ERR_MODULE_NOT_FOUND: Cannot find package '@/lib'`.
  A TS-aware loader (`tsx`) is required; the project ships `tsx` in
  `node_modules/.bin`. The vitest suite resolves the same alias via the
  `@`→`.` mapping in `vitest.config.ts`.
- **Current count:** **114 assertions, 0 failures** (was 70 before R51).

### R51 additions to the harness (+44 assertions)

| Section | Requirement | What it asserts (deterministic, vs the shared lib code) |
|---|---|---|
| 7. duplicate-charge prevention | R5 / R6 | within-tier dup (raw + marked-up, differing descriptions) fails grounding; unframed cross-tier quantity stack flags + fails; framed difference and same-qty progression pass |
| 8. after-hours surcharge tag | R11 | tagged after-hours labour at hourly × valid multiplier grounds; same inflated rate on an **untagged** line fails; an absurd above-cap multiplier cannot inflate the accepted rate |
| 9. question enforcement | R24 / R27 | `mustAskLines` non-empty+cleaned for every easy-set job; `rulesAsText` renders a hard "do NOT finish" MUST-ASK gate with all numbered questions; inspection triggers rendered as `escalate_inspection`; SYSTEM_PROMPT frames the pre-finish gate |
| 10. inspection-reason no-price-leak | R13 | invented price claims stripped (reason kept); safe default for empty; clean reason unchanged |

The pre-existing harness sections (1–6) still cover the customer SMS body,
tradie notify, incomplete-call SMS, the shared quality gate, assumption
rules, and the Zod dialog schema.
