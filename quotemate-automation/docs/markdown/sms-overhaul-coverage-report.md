# SMS AI Receptionist — Accuracy, Correctness & Reliability Overhaul — Final Coverage Report (R53)

> Phase 7 deliverable for [`specs/sms-receptionist-accuracy-overhaul.md`](../../../specs/sms-receptionist-accuracy-overhaul.md) (R1–R53).
> Produced 2026-06-18. Maps every requirement R1–R53 + each R4 root-cause theme to its fix and verification result, with before/after metrics.
>
> **Status legend.** `done` = code merged, no test gate cited · `done-with-tests` = code + passing vitest/parity assertions · `data-migration-staged` = migration + runner written and dry-run-verified, **owner must apply to prod** · `flagged-for-owner` = surfaced, deliberately NOT auto-changed (flag-not-fabricate) · `deferred-to-live-smoke` = behaviour is correct in unit/replay but the final proof is R41/R52 manual smoke on the dev server.
>
> **Hard rules honoured by this report's verification.** Prod was read **read-only** (`SUPABASE_DB_URL`, `ssl rejectUnauthorized:false`). No prod writes. No LLM calls — R50 was proven by the **deterministic** replay harness (`scripts/replay-representative-jobs.mjs`) which exercises `validateQuoteGrounding` / `detectCrossTierDuplicates` / `decideRouting` directly, never the Opus draft.

---

## Verification snapshot (2026-06-18)

| Check | Result |
|---|---|
| Full vitest suite (`npx vitest run`) | **3866 passed · 1 skipped · 273 files · 33.7s** |
| Deterministic replay harness (`scripts/replay-representative-jobs.mjs`, prod read-only, NO LLM) | **17/17 PASS** — 14/14 representative job types grounded-clean → `tradie_review`; 3/3 negative guardrails bit (within-tier dup → downgrade, cross-tier unframed dup → downgrade, gas/always-inspection → `inspection_required`) |
| Migrations staged | **5** (118–122) + 5 matching runner scripts, each dry-run-verified via `BEGIN; … ROLLBACK;` on the dev DB |
| Prod write made by this build | **0** (migrations are the owner's to apply) |

---

## Per-requirement coverage (R1–R53)

### Phase 0 — Understand & baseline

| R | Status | Where | Evidence (one line) |
|---|---|---|---|
| R1 | done | `docs/markdown/sms-inspection-rootcause-inventory.md`; catalog/service docs | Reference docs read; drift map produced (auto_send dead, `apprentice/senior/after_hours` actually WIRED, catalog grown to 65 assemblies / 46 materials / 7 pricing_book). |
| R2 | done | `sms-inspection-rootcause-inventory.md` "How a job becomes a $99 inspection" | Pipeline traced file:line across `sms/inbound` → `intake/structure`+`quality` → `estimate/run`+`tools`+`merge-recipes`+`reconcile` → `validate` → `routing/decide` → `estimate/draft` + `quote/[id]/edit`. |
| R3 | done-with-tests | `scripts/replay-representative-jobs.mjs` | 14 representative job types (7 electrical + 7 plumbing) built from the live catalogue, each replayable through the real grounding+routing functions; 3 negative cases planted. |
| R4 | done | `sms-inspection-rootcause-inventory.md` (T1–T8 avoidable, L1–L9 legitimate) | Root-cause inventory: 90 machine findings (54 avoidable / 9 legitimate / 27 unclear) classified by layer + avoidable/legitimate with a planned fix; reconciled against current code below. |

### Phase 1 — Estimation correctness & price integrity

| R | Status | Where | Evidence (one line) |
|---|---|---|---|
| R5 | done-with-tests | `lib/estimate/validate.ts` `resolveLineAnchor` (L356–558, sourceId-FIRST L408–439); `lib/estimate/validate-dedup-r5.test.ts` | D-1 within-tier dedup now anchors by `sourceId`/catalogue id, catching the same row under a different description or in a different markup band. |
| R6 | done-with-tests | `lib/estimate/validate.ts` `detectCrossTierDuplicates` (L555); `lib/estimate/validate-cross-tier-dedup.test.ts`; replay NEG(b) | Cross-tier duplicate of the same catalogue row is flagged unless explicitly framed in scope/assumptions; replay harness confirms NEG(b) → downgrade. |
| R7 | done-with-tests | `lib/estimate/merge-recipes.ts` + `lib/estimate/run.ts` R9 block (L456–483); `lib/estimate/run-phase1.test.ts` | Enforced (not advisory) post-merge check: an Opus-drafted extra duplicated by a recipe-appended extra is dropped/flagged fail-closed. |
| R8 | done-with-tests | `app/api/quote/[id]/edit/route.ts`; `app/api/quote/[id]/edit` re-validation runs all three tiers | Tradie quote-edit re-validation now runs duplicate detection across all three tiers, not only the edited one. |
| R9 | done-with-tests | `lib/estimate/run.ts` per-tier `mergeRecipesIntoDraft` isolation + `failedTiers` revert (L456–483); `run-phase1.test.ts` | Recipe merge is per-tier error-isolated; un-grounded appended lines revert that tier's recipe result and log CRITICAL. |
| R10 | done | `lib/estimate/run.ts` KB apply-mode path (KB-origin marker on rewritten lines) | KB-rewritten prices are origin-stamped so a stale KB can't launder an ungrounded price through the loose category path. |
| R11 | done-with-tests | `lib/estimate/validate.ts` after-hours source-tag check (L737–900); `lib/estimate/validate-after-hours-r11.test.ts` | After-hours lines validated by `source:'after_hours'` + value bounds (multiplier gated >1, ≤2.5) so an inflated rate can't pass under a wrong tag. |
| R12 | done-with-tests | `lib/estimate/validate.ts` `categorise()` + strict whitelist (L106–178); `lib/estimate/validate-safety-category.test.ts` | Strict-category whitelist for safety-critical categories (smoke alarm etc.) + documented product→category matrix; cross-trade mismatch flagged. **Tightened, not loosened.** |
| R13 | done-with-tests | `lib/estimate/inspection-reason.ts` (`SAFE_INSPECTION_REASON`, `sanitizeInspectionReason`); `lib/estimate/inspection-reason.test.ts` | `inspection_reason` constrained (length cap, no currency symbols/sensationalism) with a safe-reason fallback. |
| R14 | done-with-tests | `lib/estimate/run.ts` post-reconciliation re-check after `reconcileTierMath`/`collapseDuplicateTiers`/`checkQuantityVsItemCount`; `run-phase1.test.ts` | Lightweight second grounding pass verifies every priced line's `(unit_price_ex_gst, unit)` still matches a grounded candidate after reconciliation arithmetic. |
| R15 | done-with-tests | `lib/estimate/run.ts` `enforceSpecMismatch` (L905–925); `lib/estimate/spec-guard.ts` + `spec-guard.test.ts` | Enforce mode now ACTS on a hard spec mismatch: partial → null the offending tier(s); all priced tiers mismatch → route to inspection. No silent ship. |

### Phase 2 — Materials catalog data quality (A then B)

| R | Status | Where | Evidence (one line) |
|---|---|---|---|
| R16 | done | `docs/markdown/catalog-completeness-matrix.md` | Column-by-column matrix for all 9 catalog tables: CARRY vs RESERVED/UNWIRED vs STRUCTURAL, fill state, intended source. |
| R17 | data-migration-staged + flagged-for-owner | `sql/migrations/120_material_brand_category.sql`; `docs/markdown/catalog-data-provenance.md` | A-pass: 3 no-brand consumable/cable rows set `brand='Generic'` (structurally accurate); **5 genuinely-branded downlight/outdoor-light rows left NULL and flagged** (unverifiable brand). Confirmed-stale finding: 0 missing category. |
| R18 | data-migration-staged | `sql/migrations/118_shared_assembly_bom_seed.sql`; `lib/estimate/run.ts` `buildBomHint()` consumes it | BOM seeded for core electrical+plumbing assemblies (was 3 rows total). Estimator's `buildBomHint()` (always-on) + deterministic path (flag-gated) confirmed consumers. Uses correct `sundries` category. |
| R19 | data-migration-staged + flagged-for-owner | `sql/migrations/119_pricing_book_audit.sql` | All 7 pricing_book rows audited: numeric fields sane. Only auto-fix = NULL an impossible `licence_expiry` (year 0008). `apprentice/senior/after_hours` confirmed WIRED (not deprecated). Rate outliers flagged (below), not changed. |
| R20 | done | `catalog-completeness-matrix.md` §R20 (RESERVED table) | Reserved/unwired columns documented with gating feature named (`overlays`→EARLY_BIRD, `followup_2h_enabled`, `tier_hint`, `image_path`, `cost_price_ex_gst`, `customer_supply_price_ex_gst`, `price_recipe`, whole `tenant_assembly_overrides`). None fabricated. |
| R21 | done-with-tests + flagged-for-owner | `docs/markdown/catalog-data-provenance.md` §R21; `scripts/replay-representative-jobs.mjs` | All 14 representative job types have an intact groundable price path — **0 BROKEN**. Tenant overlays resolve for all 4 active tenants. Thin gas_fitting path noted for owner awareness. |
| R22 | data-migration-staged | migrations 118–121 + runner scripts; `catalog-data-provenance.md` per-row provenance | All data changes shipped as idempotent migrations; per-row provenance recorded (supplier justification or "flagged — needs owner input"); `sql/init.sql` kept representative. |

### Phase 3 — Services / jobs definitions + the SMS questions (A then B)

| R | Status | Where | Evidence (one line) |
|---|---|---|---|
| R23 | data-migration-staged | `sql/migrations/121_clarifying_questions_backfill.sql`; `service-content-audit.md` | Confirmed-stale "mostly NULL": exactly 2 prod auto-quote rows (16 on dev) had empty `clarifying_questions`; both backfilled. Verification target met: **0** empty auto-quote elec/plumbing rows. Name-keyed → idempotent on both DBs. |
| R24 | done-with-tests | `lib/sms/dialog.ts` MUST-ASK block (L356–607, "HARD per-job gates"); `lib/sms/quote-readiness.ts` `evaluateQuoteReadiness`; `lib/sms/mustask-injection.test.ts` | Dialog renders each matched job type's `clarifying_questions` as a MUST-ASK block and blocks `action=finish` until all answered (one per turn) — now for the easy-set, not just custom rows. |
| R25 | done-with-tests | `lib/sms/dialog.ts` + `lib/sms/quote-readiness.ts` conditional slots; `mustask-injection.test.ts` | Conditional questions encoded: GPO 600mm-from-water only in wet rooms; smoke-alarm like-for-like vs whole-property compliance classified before finish. |
| R26 | done-with-tests | `lib/intake/schema.ts` (`supplied_by` L60, `system_type` L75–76); `lib/intake/structure.ts` (R26/WP5 L14–68); `lib/intake/structure.test.ts` | Structured `system_type`(electric\|gas\|heat_pump) + `supplied_by` captured via `requested_specs_json`; WP5 contradiction resolved; unknown hot-water `system_type` not guessed → captured/escalated. |
| R27 | done-with-tests | `lib/sms/dialog.ts` INSPECTION-TRIGGERS block (L685–686); `mustask-injection.test.ts` | Each job type's `inspectionTriggers` rendered into the dialog as escalation rules, not just the universal list. |
| R28 | done-with-tests | `lib/intake/quality.ts` `missingRequiredFields` + `PER_JOB_REQUIRED_FIELDS` (L122–127); `lib/intake/quality.test.ts` | Per-job confidence gating: a missing mandatory field (e.g. `count`) lowers confidence and fires the callback path, not global confidence alone. |
| R29 | flagged-for-owner | `docs/markdown/service-content-audit.md` | B-pass audit of all 49 elec/plumbing rows: **0 values changed** (none met "unambiguously wrong AND justifiable"); 4 labour-hour/scope plausibility items flagged for owner (notes 1–4). |

### Phase 4 — Tradie ↔ catalog wiring + the toggle bug

| R | Status | Where | Evidence (one line) |
|---|---|---|---|
| R30 | done-with-tests | `lib/sms/dialog.ts` `serviceListVersion()` + `buildDialogServiceBlock()`; `lib/sms/service-toggle-freshness.test.ts` | Service list rendered OUTSIDE the cached prefix with a deterministic version stamp → a toggle is reflected on the **next** inbound, not 1–3 turns later. |
| R31 | done-with-tests | `app/api/tenant/me/route.ts` write path; `lib/dashboard/service-toggle.ts`; `app/api/tenant/me/route.test.ts` | `PATCH /api/tenant/me` writing `tenant_service_offerings` bumps the version stamp (defined invalidation mechanism, not TTL reliance). |
| R32 | done-with-tests | `lib/estimate/catalogue.ts` reads current rows; `lib/estimate/catalogue-add-grounding.test.ts` | Manually-added catalogue material is read by the estimator/grounding on the next quote — no redeploy/cache wait; pricing/badging reflect the new row. |
| R33 | done-with-tests | `app/api/tenant/bom/fork/route.ts`; `lib/dashboard/fork-gaps.ts`; `fork-gaps.test.ts`, `app/api/tenant/bom/fork/route.test.ts` | Shared→tenant/fork additions recognized; the fork category-gap (line with no tenant catalogue product) is surfaced, not silently generic-priced. |
| R34 | done-with-tests | `lib/sms/service-toggle-freshness.test.ts`, `lib/dashboard/service-toggle.test.ts`, `lib/estimate/catalogue-add-grounding.test.ts` | Wiring tests prove toggle-OFF stops offering on next inbound, toggle-ON offers on next inbound, add-material grounds/badges on next quote. |

### Phase 5 — Dashboard surfaces

| R | Status | Where | Evidence (one line) |
|---|---|---|---|
| R35 | done-with-tests | `app/dashboard/page.tsx` Estimating tab; `lib/dashboard/badge-state.ts`; `badge-state.test.ts` | Estimating "read-only" contradiction resolved: presented as an "effective values" view with a clearly-labelled override action. |
| R36 | done-with-tests | `lib/dashboard/service-delta.ts`; `service-delta.test.ts` | Toggle concurrency fixed: per-service deltas (not whole-dict PATCH) reconciled against the server response so overlapping toggles can't lose writes. |
| R37 | done-with-tests | `lib/dashboard/badge-state.ts`; `badge-state.test.ts` | Cross-tab badge sync: enabling/disabling a Catalogue material updates the "priced from your catalogue vs generic" badges in Estimating + Recipes. |
| R38 | done-with-tests | `lib/dashboard/fork-gaps.ts`; `fork-gaps.test.ts` | Fork UI surfaces which baseline lines have no matching tenant catalogue product (generic-price), instead of silent fallback (UI side of R33). |
| R39 | done-with-tests | `app/api/tenant/trades/route.ts`; `lib/dashboard/licence-fieldsets.ts`; `licence-fieldsets.test.ts`, `app/api/tenant/trades/route.test.ts` | Activating a new trade shows a blank licence fieldset for it (re-fetch `/api/tenant/me`) — no manual reload. |
| R40 | done-with-tests | `lib/dashboard/name-collision.ts`; `name-collision.test.ts` | Shared/custom same-name collision handled: the two rows are visually distinguished/disambiguated. |
| R41 | deferred-to-live-smoke | (manual checklist below) | Each tab's logic is unit-covered; full end-to-end "drive as a real tradie" with multi-trade fan-out is the R52 live smoke. |

### Phase 6 — Twilio delivery reliability

| R | Status | Where | Evidence (one line) |
|---|---|---|---|
| R42 | done-with-tests | `lib/sms/send-reliability.ts` `getDeliveryKnobs`/`SMS_MAX_DURATION` (L230), `isNearMaxDuration`; `lib/sms/send-reliability.test.ts` | `maxDuration` raised with safety margin + configurable; near-timeout detection so the webhook completes its sends or fires a fallback. |
| R43 | data-migration-staged + done-with-tests | `sql/migrations/122_sms_conversation_active_unique.sql` (partial unique index + `create_sms_conversation_idempotent` RPC); `lib/sms/inbound-helpers.ts` `decideConversationUpsert` (L151); `lib/sms/inbound-helpers.test.ts` | First-message race: idempotent ON-CONFLICT-DO-NOTHING create returns one canonical conversation; loser adopts the winner's row. No orphaned inbound. |
| R44 | done-with-tests | `lib/sms/send-reliability.ts` `adaptiveDebounceMs` (L407); `lib/sms/inbound-helpers.ts` `arrivalTimestampsFromTurns` (L183); `send-reliability.test.ts`, `inbound-helpers.test.ts` | Adaptive (arrival-rate) debounce + every queued inbound processed — no silent drop. |
| R45 | done-with-tests | `app/api/estimate/draft/route.ts` (outer try/catch per `after()` block); `lib/sms/dispatch-throw-guard.test.ts`, `lib/sms/send-quote-dispatch.test.ts` | Each `after()` block wrapped in top-level try/catch that logs + fires a "we hit a snag" SMS to the customer and a "quote failed" notice to the tradie. |
| R46 | done-with-tests | `lib/sms/send-reliability.ts` `backoffDelayMs`/`isRetryableSendError`/`isRetryableCode` (L58–121); `lib/sms/send-quote-dispatch.ts` `retryPolicyFromKnobs`; `send-reliability.test.ts` | Each send (AI reply, photo, quote, tradie-notify) retries independently with exponential backoff; AbortError/timeout handled; one failure doesn't abort the others. |
| R47 | done-with-tests | `lib/sms/inbound-helpers.ts` `decideSidDedup` (L55), `classifyInboundInsert` (L83, `PG_UNIQUE_VIOLATION`), `sideEffectsAllowed` (L104); `inbound-helpers.test.ts` | MessageSid idempotency hardened: Twilio/concurrent retries can't duplicate inbounds or double-fire the intake handoff / photo SMS. |
| R48 | done-with-tests | `lib/sms/send-reliability.ts` `buildSendOutcome`/`logSendOutcome`/`isAlertableStatus` (L295–407); `send-reliability.test.ts` | Every send outcome + skip path logged; alertable statuses (latency budget, quote-without-SMS, near-maxDuration) classified. |
| R49 | done-with-tests + data-migration-staged | `lib/sms/send-reliability.ts` `getDeliveryKnobs` (env: `SMS_MAX_DURATION`, `SMS_DEBOUNCE_MS`, retry knobs, bounded); migrations 118–122 + runners | Knobs configurable via env (bounded defaults); all DB changes ship as `NNN_*.sql` + `run-migration-NNN.mjs`; no prod writes by the build. |

### Phase 7 — Verification

| R | Status | Where | Evidence (one line) |
|---|---|---|---|
| R50 | done-with-tests | `scripts/replay-representative-jobs.mjs` | **17/17 PASS** against the live prod catalogue (read-only, NO LLM): 14/14 grounded-clean → quote, no within/cross-tier dups, consistent math; 3/3 negatives → inspection. |
| R51 | done-with-tests | `lib/**/*.test.ts` (R5–R8 dedup, R9–R15 grounding, R17–R21 data, R23–R28 questions, R30–R34 wiring, R42–R47 reliability) + `scripts/test-sms-parity.mjs` | vitest + parity harness extended; **full suite 3866 passed / 1 skipped**. |
| R52 | deferred-to-live-smoke | (manual checklist below) | Logic proven in unit + deterministic replay; the dev-server browser + SMS-path smoke is the manual step below. |
| R53 | done | **this file** (`docs/markdown/sms-overhaul-coverage-report.md`) | Final coverage report mapping every R + R4 theme to fix + verification with before/after metrics. |

---

## R4 root-cause inventory → fix mapping

| Theme | Description | Resolved by | Status |
|---|---|---|---|
| **T1** | All-or-nothing tier nulling (one ungrounded line nulls all 3 → full inspection) | Per-tier salvage via correct dedup + per-tier revert (`run.ts` `failedTiers` L456–483); only-all-fail → inspection; each shipped tier still 100% grounded | done-with-tests |
| **T2** | False grounding rejection — category | Strict-category whitelist + tightened `categorise()` (R12); strict `source=material:/assembly:<uuid>` path bypasses category match; category backfill confirmed already present (0 missing) | done-with-tests |
| **T3** | Dialog over-escalation (job outside hardcoded easy lists → $99) | Quotable scope broadened to the live enabled catalogue; over-broad universal triggers trimmed (genuine safety kept) (R24/R27) | done-with-tests |
| **T4** | Confidence forced LOW by non-pricing fields → quality gate blocks quote | `quality.ts` rubric no longer forces LOW for missing CRM `name`/`suburb`; per-job recompute (R28) | done-with-tests |
| **T5** | Grounding band tightness (markup/unit/min-labour) | `pricing_book` audited sane (R19); after-hours wired+bounded (R11); valid units recognised; min-labour floor ordering preserved | done-with-tests + data-migration-staged |
| **T6** | Migration-069 inspection_triggers too aggressive | Dialog asks the disambiguating storey/ceiling/access question before escalating; trigger phrasing narrowed (R25/R27) | done-with-tests |
| **T7** | WP5 customer-supply with no install-only price → inspection | `supplied_by` structured capture + install-only path (R26) | done-with-tests |
| **T8** | pricing_book data hygiene | Impossible `licence_expiry` NULLed (mig 119); outliers (Oakcrest, Atomic, min_labour==after_hours coincidences) surfaced for owner, not silently changed | data-migration-staged + flagged-for-owner |
| **L1–L9** | Legitimate inspections (gas HWS `always_inspection`, gas keyword override, emergency/safety, wrong-trade, tradie-declined, GPO wet-area, plumbing burst/reno/gas-leak) | **Kept** inspection-routed; replay NEG(c) confirms gas/always-inspection still routes to `inspection_required`; price-hiding preserved | done-with-tests |

---

## MIGRATIONS STAGED FOR OWNER TO APPLY

> **The build never writes to prod.** Each migration is idempotent and was dry-run-verified on the dev DB inside `BEGIN; … ROLLBACK;`. Apply in number order. Run each with:
> `node --env-file=.env.local scripts/run-migration-NNN.mjs`

| # | File | What it does | Run command |
|---|---|---|---|
| **118** | `sql/migrations/118_shared_assembly_bom_seed.sql` | **BOM seed (R18).** Seeds `shared_assembly_bom` for the core electrical + plumbing assemblies (was 3 rows total). Structural only — writes `material_category` + typical quantity per assembly (uses the correct `sundries` category, NOT `sundry`); **no prices**. Consumed by `run.ts buildBomHint()` (always-on soft hint) + the deterministic path. | `node --env-file=.env.local scripts/run-migration-118.mjs` |
| **119** | `sql/migrations/119_pricing_book_audit.sql` | **pricing_book licence-date fix (R19).** Audited all 7 rows sane. Only auto-correction: NULLs an impossible `licence_expiry` (year 0008 on the Atomic Electrical row) — removes garbage, never invents a year. All flagged rate outliers left untouched. | `node --env-file=.env.local scripts/run-migration-119.mjs` |
| **120** | `sql/migrations/120_material_brand_category.sql` | **Material brand A-pass (R17).** Sets `brand='Generic'` on the 3 no-brand consumable/cable rows (structurally accurate). 5 genuinely-branded downlight/outdoor rows deliberately left NULL (flagged). `brand` only — confirmed 0 missing category; no grounding impact. Runner re-verifies + prints remaining flagged rows. | `node --env-file=.env.local scripts/run-migration-120.mjs` |
| **121** | `sql/migrations/121_clarifying_questions_backfill.sql` | **clarifying_questions backfill (R23).** Name-keyed, emptiness-guarded backfill of `shared_assemblies.clarifying_questions` from `assumptions.ts mustAsk`. Populates the 2 empty prod rows (16 on dev). Verification target: 0 empty auto-quote rows. No pricing/labour/description touched. | `node --env-file=.env.local scripts/run-migration-121.mjs` |
| **122** | `sql/migrations/122_sms_conversation_active_unique.sql` | **Idempotent conversation-create RPC + partial unique index (R43).** Adds `sms_conversations_active_customer_quote_unique` (partial: active customer_quote per from/to) + the `create_sms_conversation_idempotent` RPC the inbound route calls via `supabase.rpc()`. The runner reports pre-existing active duplicates BEFORE creating the index. | `node --env-file=.env.local scripts/run-migration-122.mjs` |

> ⚠ **Ordering — split-brain guard.** **Migration 122 must be applied BEFORE (or together with) the inbound-route deploy.** The updated `app/api/sms/inbound/route.ts` calls `create_sms_conversation_idempotent` and relies on the partial unique index. If the code ships before the migration, the RPC/index is missing and the first-message race (R43 split-brain duplicate conversations) is not yet closed. Apply 122, confirm the runner reports no unreconciled active duplicates, then deploy the inbound route.

---

## FLAGGED FOR OWNER DECISION (flag-not-fabricate)

Per the research-integrity rule, these were **surfaced, not changed**. Each needs the owner's real-world confirmation.

**pricing_book rates & licences (R19 / T8):**
- **Oakcrest — $200/hr + 42.8% markup.** Well above the NSW electrical norm (~$110/hr × 28–36%). Surface for owner sign-off; not changed.
- **Atomic — 14% markup.** Below the electrical norm; confirm intended.
- **`min_labour_hours == after_hours_multiplier` coincidences** on some rows (e.g. both 1.70) — likely a data-entry artefact; owner to confirm the real values. Not changed.
- **Placeholder `licence_number "1234567"`** and a **null plumbing `licence_state`** (Atomic plumbing row) — owner input; never fabricated.

**shared_materials brands (R17):** 5 genuinely-branded rows left `brand IS NULL` — **Basic LED downlight** ($28), **Tri-colour LED downlight** ($48), **Dimmable IP-rated downlight** ($72), **Premium 90+CRI warm-white LED downlight (5yr warranty)** ($75), **Smart dimmable outdoor light** ($140). Owner to set the real supply brand (grounding unaffected; renders blank in the dashboard brand list until then).

**Service content / scope-safety (R29):**
- **'Gas appliance connection' is auto-quote despite being licensed gasfitting work (AS/NZS 5601).** Unlike *Install gas HWS* it is **NOT** `always_inspection`. Recommend the owner either set `always_inspection=true` on this row, or confirm it stays auto-quote and ensure the clarifying question asks whether a certified existing gas point/bayonet is within reach (a compliance plate is always required).
- **Labour-hour plausibility notes (R29 notes 1–3):** Install 20A dedicated GPO (2.0 h — base vs long-run distance split); whole-house smoke compliance (1.0 h "per-alarm" framing internally inconsistent vs a realistic 4–6 h compliance install); Install electric HWS (3.0 h vs a likely 2.0–2.5 h like-for-like). All within a defensible band → flagged, not changed.

**Pre-existing BOM category mismatch:** the 3 original `shared_assembly_bom` rows for the downlight job use `material_category='sundry'` (singular), which does **not** exist in `shared_materials` (it is `sundries`), so that downlight deterministic consumable line cannot resolve today. Migration 118 uses the correct `sundries` for all new rows; **fixing the pre-existing `sundry` rows was out of R18 scope — flagged for the owner.**

---

## LIVE SMOKE REQUIRED (R41 + R52)

The logic is unit-covered and the deterministic data/grounding/routing path is proven by the replay harness, but two requirements need the running dev server (browser + real SMS) as their final proof. **Apply migrations 118–122 to the target DB first** (122 before the inbound-route deploy — see split-brain note).

**R41 — drive each dashboard tab end-to-end as a real tradie:**
- [ ] **Account** — read tenant + licences; edit a licence and confirm it persists; activate a second trade → a blank licence fieldset appears for the new trade with no manual reload (R39).
- [ ] **Pricing** — edit `pricing_book` for trade A; confirm trade B's pricing is untouched (multi-trade fan-out, R41).
- [ ] **Services & Catalogue** — toggle a service OFF then ON (concurrent toggles don't lose writes, R36); add a catalogue material and confirm its badge; create a custom service with the same name as a disabled shared one → the two are visually distinguished (R40).
- [ ] **Estimating** — confirm it reads as an "effective values" view with a clearly-labelled override action (not a read-only-that-writes contradiction, R35); enabling/disabling a Catalogue material updates the catalogue-vs-generic badge here (R37).
- [ ] **Recipes** — fork a baseline recipe; confirm lines with no matching tenant catalogue product are surfaced as gaps, not silently generic-priced (R38).

**R52 — replay a representative SMS conversation per job type (browser + SMS path):**
- [ ] **Toggle wiring:** toggle a service OFF → the **next** inbound SMS no longer offers/quotes it; toggle ON → the next inbound offers it (R30/R31/E11) — no multi-turn staleness.
- [ ] **Catalogue add:** add a catalogue material → the **next** quote grounds/badges from it (R32/E12) — no stale generic fallback.
- [ ] **Per job type:** run one SMS conversation for each representative job (downlights, power_points, ceiling_fans, smoke_alarms, outdoor_lighting, hot_water, blocked_drain, tap_replace, toilet_replace, tap_repair, toilet_repair, gas_fitting) and confirm the dialog asks the MUST-ASK questions, blocks `finish` until answered (R24), and the returned quote has no duplicate charges and consistent ex/inc-GST.
- [ ] **Delivery failure conditions:** long/complex job (no send lost to timeout / fallback "snag" SMS fires, R42/R45); first message of a brand-new number (no orphaned inbound, R43); rapid back-to-back texts (all processed, R44).

---

## BEFORE / AFTER

### Avoidable-inspection drivers — before → after

| Driver | Before | After |
|---|---|---|
| Tier nulling | One ungrounded line in any tier nulled **all three** tiers → full $99 inspection (dominant code-side cause) | Per-line salvage via **correct** dedup (sourceId-anchored) + per-tier revert; a tier that fully grounds ships; inspection only when **all** tiers fail — each shipped tier still 100% grounded |
| False rejections (category / markup / unit) | Correctly-priced lines failed the loose category-overlap / band checks | **Tightened, not loosened:** strict-category whitelist + strict `material:/assembly:<uuid>` path; after-hours/markup bands wired and bounded; a line still must price-match a real candidate row |
| MUST-ASK questions | `mustAsk` hardcoded in `assumptions.ts` but **never injected** into the dialog → agent finished on name+suburb+scope and skipped job-specific fields | `clarifying_questions` injected as HARD per-job MUST-ASK gates; `action=finish` blocked until answered (R23/R24) |
| Decline / unknown-fuel loops | Dialog could loop or invent on decline; unknown hot-water fuel risked an invented gas/electric assembly | Decline handled (safe-default logged after asking); unknown `system_type` captured or escalated — never invented (R26/E8) |

### Catalog completeness delta

- `shared_assembly_bom`: **3 rows → core electrical+plumbing assemblies seeded** (mig 118); estimator consumption confirmed.
- `shared_materials.brand`: **8 no-brand elec/plumb rows → 3 set `Generic`**, 5 flagged for owner (mig 120). Category: confirmed **0 missing** (stale seed finding).
- `shared_assemblies.clarifying_questions`: **2 empty auto-quote rows (16 on dev) → 0 empty** (mig 121); verification target met.
- `pricing_book`: all 7 rows audited sane; 1 impossible `licence_expiry` NULLed (mig 119); rate outliers + licence placeholders flagged for owner.
- Groundable-path coverage (R21): **14/14 representative job types intact, 0 BROKEN**; all 4 active tenants' overlays resolve.

### Test count

- **Full vitest suite: 3866 passed · 1 skipped · 273 files.**
- **Deterministic replay (`replay-representative-jobs.mjs`): 17/17 PASS** (14 positive grounded-clean→quote + 3 negative guardrails-bite), prod read-only, NO LLM calls.

### SMS delivery under the three failure conditions (mechanism in place; final proof = R52 smoke)

| Condition | Mechanism shipped |
|---|---|
| Long/complex job | Raised+configurable `maxDuration`, near-timeout detection, top-level `after()` try/catch + fallback "snag" SMS (R42/R45) |
| Fresh-conversation first message | Partial unique index + idempotent create RPC (mig 122) so concurrent webhooks adopt one canonical conversation — no orphan (R43) |
| Rapid back-to-back texts | Adaptive (arrival-rate) debounce + every queued inbound processed (R44); MessageSid idempotency prevents duplicate inbounds / double handoff (R47) |
| Any single send fails | Independent per-send retry with exponential backoff + per-send logging/alerting; one failure doesn't abort the others (R46/R48) |
