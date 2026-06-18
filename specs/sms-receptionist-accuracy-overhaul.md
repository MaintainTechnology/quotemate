# SMS AI Receptionist — Accuracy, Correctness & Reliability Overhaul — Spec

> Make QuoteMate's SMS AI Receptionist quote pipeline (SMS conversation → Intake → Estimate → Full Quote) as accurate, correct, and reliable as possible across electrical (NSW/NECA) and plumbing (QLD/QBCC) for real customer traffic — by fixing price integrity, the materials/services catalog data, the tradie↔catalog wiring, the dashboard surfaces, and Twilio message delivery. For the QuoteMate team / tradie tenants.
> Status: Draft · 2026-06-18
> **Supersedes** [`specs/sms-quote-accuracy-revamp.md`](sms-quote-accuracy-revamp.md) — that spec's quote-engine work is folded into Phase 0–1 + Phase 7 here and broadened.

## Objective

The SMS AI Receptionist is the product's wedge: a customer texts in, the AI runs a dialog, structures an intake, estimates a Good/Better/Best Full Quote, and sends it back — auto-released when clean, or routed to a paid $99 inspection when a price can't be grounded. Many customers will use this at volume, so the quote must be **accurate** (right materials chosen from the catalog for the request), **correct** (prices grounded in catalog data, never invented; no duplicated materials → no double charges), and **reliable** (the messages actually get delivered, and what a tradie configures is what the agent uses).

This build hardens the whole path end-to-end across six areas:

1. **Estimation correctness & price integrity** — no invented prices, no duplicate line items / double charges; strengthen (never loosen) the grounding guardrail.
2. **Materials catalog data quality** — an exhaustive data-cleansing pass (every meant-to-carry-data column filled with verified AU values), then an accuracy pass on everything that feeds a quote.
3. **Services / jobs definitions + the SMS questions** — research-correct the electrical & plumbing service data, populate empty columns, and make the dialog actually ask the job-specific questions needed to choose materials and scope correctly.
4. **Tradie ↔ catalog wiring** — enabling/disabling a service is sensed by the SMS agent promptly; manually added materials and shared→tenant catalog additions are recognized immediately.
5. **Dashboard surfaces** — Account, Pricing, Services & Catalogue, Estimating, Recipes work correctly and consistently.
6. **Twilio delivery reliability** — the AI reply, the quote/quote-link SMS, and the tradie notification are not dropped (the reported failures cluster on long/complex jobs, fresh-conversation first messages, and rapid back-to-back texts).

Success = a representative set of real jobs replays end-to-end and produces correct, internally-consistent Full Quotes with no invented prices and no duplicate charges; the catalog/services data is complete and verified (or explicitly flagged); the dashboard and toggle wiring behave as configured; and the three SMS sends are delivered reliably under the failure conditions above — all proven by tests + live smoke.

## Reference / source of truth

- **PRIMARY (authoritative for current behavior):** [`quotemate-automation/public/docs/sms-ai-receptionist-workflow.html`](../quotemate-automation/public/docs/sms-ai-receptionist-workflow.html). Where any other doc conflicts with it, this one wins. Audit and correct *against* this baseline — do not redesign the pipeline from scratch. If the running code has drifted from this document, record the drift as a finding.
- Supporting docs: `quote-engine-explainer.html`, `pricing-data-accuracy.html`, `estimator-filestore-supplement.html`, `database-visual.html`, `database-architecture.html`, `pricing-flow.html`, `ig-engine-flow.html`, `pricing-transparency.html` (all under `quotemate-automation/public/docs/`).
- A read-only grounding sweep of the live code (2026-06-18) produced the file-cited findings embedded in the requirements below; treat those file:line anchors as starting points and re-confirm before changing.

## Requirements

The build runs in phases. Phase 0 produces the evidence; Phases 1–6 are the fixes; Phase 7 proves them. Requirements are numbered for reference in review/commits. **A "wrong" value or behavior is only treated as wrong after confirming against the docs or code — never against training-data defaults.**

### Phase 0 — Understand & baseline

1. **R1 — Read the reference docs.** Read all reference docs (PRIMARY first) and extract how the quote is meant to be built, priced, grounded, and routed. Produce a short written map noting where the running code has drifted from the PRIMARY doc.

2. **R2 — Trace the live pipeline in code.** Map the actual SMS quote path end-to-end and record, by file:line, every point that can (a) trigger an inspection downgrade, (b) emit an inaccurate/invented price, (c) duplicate a line item, or (d) drop an SMS: `app/api/sms/inbound/route.ts` + `lib/sms/*` (dialog, assumptions, dispatch) → `lib/intake/structure.ts` + `lib/intake/quality.ts` → `lib/estimate/run.ts` + `tools.ts` + `merge-recipes.ts` + `reconcile.ts` → `lib/estimate/prompt.ts`/`electrical-prompt.ts`/`plumbing-prompt.ts` → `lib/estimate/validate.ts` → `lib/routing/decide.ts` → `app/api/estimate/draft/route.ts` (after() sends) and `app/api/quote/[id]/edit/route.ts`.

3. **R3 — Build the representative job set from real data.** Assemble replayable intake fixtures from the live DB: top job types by volume (downlights, hot water, power points, ceiling fans, blocked drain, plus the rest), the full set of distinct job types in `shared_assemblies` for both trades, and historical `intakes`/`quotes` that routed to `inspection_required`. Each fixture must be replayable through the real estimate → grounding → routing pipeline.

4. **R4 — Root-cause inventory.** Produce a single inventory that, for every distinct way a job currently produces a wrong/invented/duplicated price, a missed delivery, a stale toggle, or an avoidable inspection, records: trigger (file:line), layer (`data` | `dialog/flow` | `wiring` | `dashboard` | `delivery`), affected trade(s)/tenant(s), avoidable vs legitimate, and the proposed fix. The grounded findings below (R5–R49) seed this inventory; the build must confirm each against current code before acting. This inventory is the contract the rest of the build is checked against.

### Phase 1 — Estimation correctness & price integrity (no invented prices, no duplicate charges)

> The grounding validator (`lib/estimate/validate.ts`) is a hard guardrail. It may be **strengthened** but never disabled, bypassed, or loosened. Money-touching LLM steps stay tool-calling only.

5. **R5 — Within-tier duplicate prevention (strengthen D-1).** The D-1 dedup (`validate.ts:483–558`) must catch the same catalogue row appearing twice in a tier even when (a) descriptions differ ("Dux Proflo 315L" vs "Premium HWS 315L") or (b) the two prices fall in different markup bands (raw vs ×20% vs ×28%). Resolve anchors by `sourceId`/catalogue id, not description+price alone.

6. **R6 — Cross-tier duplicate prevention.** Detect when the same catalogue row appears across tiers in a way that double-charges. Legitimately offering the same product at different quantities across Good/Better/Best is allowed only when it is explicitly framed in `scope_of_works`/assumptions (e.g. "3 vs 6 downlights"), not silently stacked.

7. **R7 — Recipe pre-emption / Opus-vs-recipe duplication.** Because the recipe engine appends extras (cable runs, supply-line extensions) *after* the draft, an Opus-drafted extra plus a recipe-appended extra for the same thing double-charges. Add an enforced check (not advisory prompt text) so that after `merge-recipes` runs, no appended line duplicates an Opus-drafted line by (catalogue id / product, quantity, unit); fail-closed (drop/flag the dupe) rather than ship it. Ref: `electrical-prompt.ts:166–176`, `plumbing-prompt.ts:185–195`, `merge-recipes.ts`.

8. **R8 — Tradie quote-edit cross-tier validation.** `app/api/quote/[id]/edit/route.ts:327–331` nulls untouched tiers before re-validating, so a tradie can add a line in GOOD that duplicates one in BETTER undetected. Edit re-validation must run duplicate detection across all three tiers, not only the edited tier.

9. **R9 — Recipe-merge error isolation + appended-extra micro-validation.** Wrap `mergeRecipesIntoDraft()` per-tier so a partial failure can't leave a tier with un-grounded, partially-merged extras (`run.ts:359–436`). When `any_changed` is true, run a targeted grounding pass over only the appended lines; if an appended line doesn't ground, drop that tier's recipe result and log CRITICAL.

10. **R10 — KB apply-mode grounding integrity.** When `KB_VERIFY_ESTIMATES=apply` rewrites a price (`run.ts:451–479`), stamp the line with a KB-origin marker and ensure a stale/incorrect KB cannot launder an ungrounded price through the loose category path (`validate.ts:442–467`). Either re-ground KB-rewritten prices or accept them only with explicit origin tracking surfaced to operators.

11. **R11 — After-hours source-tag enforcement.** The after-hours check keys off `li.source` only (`validate.ts:243–252`). Make the prompts explicitly set `source:'after_hours'` when `intake.urgency='emergency'` and `after_hours_multiplier > 1`, and add type/value validation so an inflated rate can't pass under a wrong tag nor a legitimate after-hours line fail under a missing one.

12. **R12 — Category-match robustness (loose path).** The `categorise()` regex (`validate.ts:106–178`) is heuristic and can false-match (e.g. "pool pump" → a fan/pump category). Tighten with a strict-category whitelist for safety-critical categories (smoke alarm must contain smoke/alarm, etc.) and a documented `[product_name → expected_categories]` test matrix; flag cross-trade mismatches.

13. **R13 — Constrain `inspection_reason`.** When `needs_inspection=true`, validation short-circuits (`run.ts:261–269`, `validate.ts:203`) and `inspection_reason` is free-form/unchecked. Constrain it (length cap, no currency symbols / sensationalism) or — preferred — restrict it to a whitelist of pre-written reasons so the model cannot emit misleading claims.

14. **R14 — Post-reconciliation re-check.** After `reconcileTierMath()` / `collapseDuplicateTiers()` / `checkQuantityVsItemCount()` modify the draft (`run.ts:638–681`), run a lightweight second pass verifying every priced line's `(unit_price_ex_gst, unit)` still matches a grounded candidate, so post-validation arithmetic can't introduce an ungrounded number.

15. **R15 — Spec-mismatch handling.** The spec guard (`run.ts:576–730`) in shadow/enforce mode logs/flags but never blocks a chosen product that contradicts the customer's agreed specs (e.g. customer says 15A GPO, model picks 10A). Define explicit behavior: a hard spec mismatch must either block the tier or route to tradie-review/inspection — not ship silently.

### Phase 2 — Materials catalog data quality — **A then B**

> Tables in scope: `shared_assemblies`, `shared_materials`, `shared_assembly_bom`, `pricing_book`, `tenant_material_catalogue`, `tenant_custom_assemblies`, `tenant_assembly_bom`, `tenant_material_preferences`, `tenant_assembly_overrides`. All data changes ship as migrations (R49 convention). Use deep/web research against real AU suppliers (Reece, Bunnings, Tradelink) and AU award/trade rates; **flag, never fabricate** anything unverifiable.

16. **R16 — Completeness matrix (the data contract).** For every table above, produce a column-by-column matrix: column, type, nullability, whether it is *meant to carry data now* or *reserved/unwired for a future feature*, current fill state, and the intended source for filling it. This matrix defines exactly what the A-pass populates.

17. **R17 — A-pass: exhaustive population of meant-to-carry-data columns.** Fill every meant-to-carry-data column on every row across shared + all tenant tables with verified AU values: `shared_materials` (brand, range_series, real `default_unit_price_ex_gst`, category) and `shared_assemblies` (`default_labour_hours`, `default_unit_price_ex_gst`, `default_exclusions`, `category`, `clarifying_questions`). Source from real Q2-2026 supplier price lists and tradie quotes; record the source per row.

18. **R18 — Seed `shared_assembly_bom` and confirm the estimator consumes it.** `shared_assembly_bom` currently has **zero seed rows** (migration 028). Hand-curate a BOM (material_category, quantity, required, sort) for each core electrical and plumbing assembly, and verify the estimator actually reads BOMs (`run.ts buildBomHint()` / recipe path) — if BOMs aren't consumed, wire them or document why not.

19. **R19 — `pricing_book` audit + wire-or-deprecate dead columns.** Verify every row has sane required fields (`hourly_rate`, `call_out_minimum`, `default_markup_pct`, `min_labour_hours`, `gst_registered`, licence fields, `risk_buffer_pct`). `apprentice_rate`, `senior_rate`, `after_hours_multiplier` are seeded but **not used by the estimator** — either wire them into estimation or explicitly mark them deprecated/reserved in the matrix (R16). Sanity-check rates against AU trade reality per trade/state; correct outliers.

20. **R20 — Reserved/unwired columns documented, not fabricated.** Columns that are genuinely reserved for unbuilt features (`overlays`, `properties` jsonb, `customer_supply_price_ex_gst`, unvalidated `tier_hint` inference, etc.) are recorded in the matrix (R16) as intentionally-empty with the gating feature named — they are **not** filled with invented values in the A-pass.

21. **R21 — B-pass: accuracy of everything that feeds a quote.** For every job type in the representative set (R3), confirm there is a groundable price path for its trade: assembly exists and carries the data the validator/tool-lookup need; every referenced material exists, is categorised, and is priced; tenant overlays (`tenant_service_offerings`, `tenant_custom_assemblies`, `tenant_assembly_bom`, `tenant_material_preferences`, `tenant_assembly_overrides`) resolve correctly against the shared library for both trades, with no offering pointing at a missing/ungroundable assembly. Confirm the estimator prefers `tenant_assembly_bom` over `shared_assembly_bom` when present, and that `tenant_material_preferences` actually re-ranks materials without starving a quote.

22. **R22 — Deliver data + source documentation.** Ship all corrections as migrations (R49) and produce a pricing/data source record (per-row provenance: supplier SKU/list or "flagged — unverifiable, needs your input"). Migrations must be re-runnable/idempotent where practical; `sql/init.sql` kept representative.

### Phase 3 — Services / jobs definitions + the SMS questions — **A then B (mirrored)**

> Root cause found: per-job mandatory questions (`mustAsk`) are hardcoded in `lib/sms/assumptions.ts` but **never injected into the dialog** (`rulesAsText()` excludes them, `assumptions.ts:386–391`), and `shared_assemblies.clarifying_questions` is mostly NULL — so the agent can finish on name + suburb + scope and skip the job-specific fields needed to choose materials/scope.

23. **R23 — Migrate `mustAsk` → DB `clarifying_questions`.** Every SMS-auto-quoteable job type (electrical + plumbing easy-set: downlights, power_points, ceiling_fans, smoke_alarms, outdoor_lighting, blocked_drain, hot_water, tap_repair, tap_replace, toilet_repair, toilet_replace, plus the rest in `shared_assemblies`) must carry a populated `clarifying_questions` derived from the corresponding `assumptions.ts` `mustAsk`. Verification target: zero auto-quote job types with NULL `clarifying_questions`.

24. **R24 — Inject + enforce questions in the dialog.** The dialog system prompt must render each matched job type's `clarifying_questions` as a MUST-ASK block and **block `action=finish` until all are answered** (one question per turn). Today only custom-service rows get this via `customServicesDirective()`; the easy-set must too.

25. **R25 — Conditional questions.** Encode context-dependent questions: power_points 600mm-from-water question only when room ∈ {bathroom, ensuite, laundry, kitchen}; smoke_alarms must classify like-for-like vs full-property compliance hardwire before finishing. Ask the classifier first, then the conditional follow-up.

26. **R26 — Structured fields for plumbing decisions; resolve the WP5 contradiction.** Add structured capture for `system_type` (electric|gas|heat_pump) on hot_water and `supplied_by` on tap/toilet jobs, and resolve the intake-structurer contradiction where plumbing is told to skip all `scope.specs` (`structure.ts:139–140`) yet WP5 needs `supplied_by`/`system_type` for plumbing (`structure.ts:100–102`). For hot_water, an unknown `system_type` must **not** be guessed — capture it, or escalate to inspection rather than invent a gas/electric assembly (aligns with `plumbing-prompt.ts:144–154` "NO PRICED GAS UPSELL").

27. **R27 — Inspection triggers enforced per job type.** Render each job type's `inspectionTriggers` (from `assumptions.ts`) into the dialog as escalation rules so the agent escalates to inspection when the customer mentions one, instead of relying only on the universal trigger list.

28. **R28 — Per-job confidence gating.** `lib/intake/quality.ts` must check the captured intake against the job type's required fields and lower confidence (→ MEDIUM/LOW, firing the callback path) when a mandatory field is missing, rather than passing on global confidence alone.

29. **R29 — Research-correct service content (A then B).** A-pass: populate every empty meant-to-carry-data column on all electrical & plumbing service rows (description, default labour, exclusions, category, questions). B-pass: correct AI-generated descriptions/labour/exclusions that are wrong against AU trade reality, sourced via research; flag unverifiable items. No safe-default may be silently applied without first attempting to capture the field via a clarifying question (then logging the assumption if the customer declines).

### Phase 4 — Tradie ↔ catalog wiring + the toggle bug

30. **R30 — Fix service-toggle staleness (the reported bug).** Confirm the root cause first: the DB write to `tenant_service_offerings` is correct/synchronous, but the service list is embedded in the Anthropic **prompt-cache** prefix used by the dialog, so a toggle isn't sensed for ~1–3 turns. Fix so a toggle is reflected on the **next** inbound message: version/bust the cache key on the service-list block (or move the service list out of the cached prefix), keeping static instructions cached. Ref: `app/api/sms/inbound/route.ts:1498–1509,1160,1705`, `lib/sms/dialog.ts`.

31. **R31 — Invalidate on write.** When `PATCH /api/tenant/me` writes `tenant_service_offerings` (`app/api/tenant/me/route.ts:701–704`) or a tenant custom-service enable flag, trigger whatever invalidation R30's design requires (cache-key bump / version stamp), so there is a defined mechanism — not silent reliance on TTL.

32. **R32 — Manual catalogue add recognized immediately.** Adding a material via the Catalogue tab (`tenant_material_catalogue`) must be picked up by the estimator/grounding on the next quote without a redeploy or long cache wait — verify the estimate path reads current catalogue rows and that pricing/badging reflect the new row.

33. **R33 — Shared→tenant additions recognized; fork resolves categories.** Adding a shared-catalog material to a tenant (or forking a baseline recipe via `POST /api/tenant/bom/fork`) must result in the tenant's quotes/badges recognizing it. Fix the fork gap where forked baseline lines reference a `material_category` with no tenant catalogue product → silent generic-price fallback (`app/api/tenant/bom/fork/route.ts:104–148`): surface it, don't hide it.

34. **R34 — Wiring tests.** Automated/scripted tests prove: toggle a service OFF → the agent stops offering/quoting it on the next inbound; toggle ON → it's offered on the next inbound; add a catalogue material → it's grounded/badged on the next quote.

### Phase 5 — Dashboard surfaces (Account, Pricing, Services & Catalogue, Estimating, Recipes)

> Surface map (all via `app/dashboard/page.tsx` + `/api/tenant/*`): Account → `tenants`/`tenant_licences`; Pricing → `pricing_book` (+ overlays); Services & Catalogue → `tenant_service_offerings`/`tenant_custom_assemblies` + `tenant_material_catalogue`; Estimating → read-only view via `/api/tenant/estimation` (+ inline override to `tenant_assembly_overrides`); Recipes → `tenant_assembly_bom` (+ fork from `shared_assembly_bom`).

35. **R35 — Resolve the Estimating read-only contradiction.** The tab is labelled "Read-only" yet exposes an inline override editor that PATCHes `tenant_assembly_overrides` (`page.tsx:8546–8909`). Make it consistent: either present it as an editable "effective values" view with a clearly-labelled override action, or move overrides elsewhere — no surface that claims read-only while writing.

36. **R36 — Fix services-toggle concurrency.** The optimistic toggle PATCHes the **entire** services dict (`page.tsx:4051–4085`), so overlapping toggles can lose writes. Send per-service deltas (or otherwise make concurrent toggles safe) and reconcile against the server response.

37. **R37 — Cross-tab badge sync.** Enabling/disabling a material in Catalogue must update the "priced from your catalogue vs generic" badges in Estimating and Recipes (re-fetch or shared state), so the three tabs never disagree about what the tenant stocks.

38. **R38 — Fork catalogue-category presence.** Same underlying issue as R33, surfaced in the UI: when forking a baseline recipe, show which lines have no matching tenant catalogue product (generic-price) so the tradie can act, instead of silent fallback.

39. **R39 — Licence row on trade activation.** When a tradie activates a new trade (`POST /api/tenant/trades`), the Account tab's licences must show a blank fieldset for the new trade (re-fetch `/api/tenant/me`), so a multi-trade tradie can enter the new licence without a manual reload.

40. **R40 — Shared/custom name collision.** Define and implement behavior when a tenant disables a shared service and creates a custom service with the same name (`page.tsx:252–254`, `tenant/me/route.ts:200–254`): either prevent the collision or visually distinguish the two rows so the list is unambiguous.

41. **R41 — End-to-end dashboard verification.** Each tab (Account, Pricing, Services & Catalogue, Estimating, Recipes) is driven end-to-end as a real tradie and confirmed: reads correct data, writes persist, multi-trade fan-out is correct (editing trade A's pricing/licence doesn't touch trade B), and CRUD/toggle/fork/override all behave.

### Phase 6 — Twilio delivery reliability

> Symptom: the AI reply, the quote/quote-link SMS, and the tradie notification all sometimes never arrive, clustering on (a) long/complex jobs, (b) the first message in a fresh conversation, (c) rapid back-to-back texts.

42. **R42 — No sends lost to timeout.** Worst-case Sonnet dialog + Opus intake/estimation + dispatch can exceed `maxDuration=300s` on `/api/sms/inbound` (`route.ts:246`), so the `after()` work and all three sends never complete. Fix by raising `maxDuration` with a safety margin and/or offloading heavy work so the webhook fast-acks and the sends are guaranteed to run to completion.

43. **R43 — First-message conversation-create race.** Two webhooks for a brand-new `from_number` can race the `sms_conversations` INSERT, orphaning the loser's inbound (`route.ts:914–928`, persist-before-lock at `1013–1020`). Use an idempotent create (`INSERT ... ON CONFLICT DO NOTHING` / upsert) and order lock-claim vs inbound-persist so no inbound is left unprocessed.

44. **R44 — Rapid-fire coalescing.** The fixed 1.5s debounce (`route.ts:1159`) plus lock-after-persist can miss messages that land mid-processing. Make debounce adaptive to arrival rate and ensure every queued inbound is processed (no message silently dropped because the leader had already read history).

45. **R45 — After()-block error isolation + fallback.** `app/api/estimate/draft/route.ts:609–898` has per-send try/catch but **no outer try/catch**, so any unhandled error (review logic, URL building) kills all sends. Wrap each `after()` block in a top-level try/catch that logs and fires a fallback "we hit a snag" SMS to the customer (and a "quote failed" notice to the tradie).

46. **R46 — Per-send route-level retries.** The AI reply, photo-link SMS, quote SMS, and tradie-notify SMS must each retry independently at the route level (not only inside `dispatch.ts`), with exponential backoff and per-send failure logging; handle the AbortError/timeout case so a slow LLM doesn't yield silent non-delivery (`route.ts:2476–2484` currently skips retry on AbortError). One send failing must not abort the others.

47. **R47 — MessageSid idempotency hardening.** Ensure Twilio webhook retries and concurrent retries can't create duplicate inbounds or fire the intake handoff / photo SMS twice (`route.ts:657–672`, `1937–1986`), beyond the unique-index backstop.

48. **R48 — Observability.** Log every send outcome (AI reply, photo, quote, tradie) and every skip path to the pipeline log, and add alerts for: a message type not dispatched within a latency budget of inbound receipt; a quote inserted but customer SMS never sent; an `after()` block nearing `maxDuration`.

49. **R49 — Configurable knobs + migration discipline.** Make `maxDuration`, debounce, retry counts/delays configurable via env so they can be tuned without a code change. All DB changes throughout this spec ship as a new `sql/migrations/NNN_*.sql` + matching `scripts/run-migration-NNN.mjs`, verified locally/against a copy, with `sql/init.sql` kept representative.

### Phase 7 — Verification

50. **R50 — Replay the representative job set end-to-end.** Run every R3 fixture through the real estimate → grounding → routing pipeline against the corrected data and confirm: correct material selection, grounded prices (no invention), **no duplicate line items within or across tiers**, internally-consistent ex-GST/inc-GST math, and that avoidable inspections now quote while legitimate ones still route to inspection.

51. **R51 — Lock wins into automated tests.** Extend `vitest` unit tests and `scripts/test-sms-parity.mjs` to assert: the duplicate-charge regression suite (R5–R8), grounding-integrity cases (R9–R15), data coverage (R17–R21), question enforcement (R23–R28), toggle/wiring (R30–R34), and Twilio reliability (R42–R47 via stress/slow-LLM/rate-limit/recovery tests). Suite passes.

52. **R52 — Live smoke on the dev server.** Drive each dashboard tab and replay a representative SMS conversation on the dev server (browser + SMS path) to confirm the fixes behave in the running app, not just in unit tests.

53. **R53 — Final coverage report.** Map each R-number and each R4 inventory item to its fix + verification result, with before/after metrics: avoidable-inspection job types now quoting, catalog column-completeness %, count of flagged-unverifiable rows, and SMS delivery results under the three failure conditions.

## Constraints

- **Grounding validator is a hard guardrail** — strengthen only; never disable, bypass, or loosen `lib/estimate/validate.ts`.
- **Money steps tool-calling only** — LLM steps that touch prices use the tool-calling lookup; never free-form prices.
- **Currency convention** — stored ex-GST, displayed inc-GST; do not change.
- **Research integrity** — when correcting catalog/services data, prefer verified AU sources (Reece/Bunnings/Tradelink, NECA/QBCC/award rates); **flag, never fabricate** unverifiable values.
- **SMS scope** — changes to shared estimate/pricing/routing libs that other channels depend on must stay neutral for voice/solar; do not build new voice/solar/onboarding behavior.
- **DB application is the user's** — the build produces migration files + runner scripts and verifies them locally/against a copy; **the build never writes to prod**. The user reviews and runs `node --env-file=.env.local scripts/run-migration-NNN.mjs`.
- **Migration discipline** — new `sql/migrations/NNN_*.sql` + `scripts/run-migration-NNN.mjs` per change; keep `sql/init.sql` representative; never commit or paste `.env.local` secrets.
- **Next 16 caveat** — before writing any Next.js code, follow `quotemate-automation/AGENTS.md` and the relevant `node_modules/next/dist/docs/` guide.
- **Confirm before judging** — treat a value/behavior as wrong only after confirming against docs or code, not training-data defaults.
- **Assumptions baked in (interview):** the catalog *and* services data each get the exhaustive A-pass then the accuracy B-pass; reserved/unwired columns are documented, not filled; verification is both automated (vitest + parity harness) and live (dev-server dashboard + replayed SMS).

## Out of scope

- Voice channel, solar estimator, and the tradie dashboard/CRM beyond the five named tabs and the shared estimate/pricing/routing libs.
- Stripe Connect / real funds split; any change to deposit/payment amounts beyond displaying a correct quote total.
- RLS / tenancy policy work, onboarding/provisioning flows, and the 100-pair eval-rubric framework (this build extends the parity harness; it does not build the rubric).
- Adding a third trade — only electrical and plumbing are touched.
- Applying migrations to prod (user does this) and any production deploy.

## Edge cases to handle

- **E1 — Job type with no assembly in either library:** classify as legitimate-inspection unless an assembly can reasonably be added (R18/R21); document the choice.
- **E2 — Assembly references a missing material:** add/price the material (R21); the line must ground after the fix.
- **E3 — Multi-item / quantity jobs ("12 downlights"):** dialog captures quantity (R24); estimate scales labour/materials correctly; the same product across tiers is not silently duplicated (R6).
- **E4 — Ambiguous/underspecified request:** the dialog asks the missing job-specific question (R24–R26) rather than finishing on name+suburb; only after asking and still unanswerable does inspection apply.
- **E5 — Cross-trade tenant:** a job grounds only against its `trade` scope; plumbing never grounds against electrical assemblies and vice versa.
- **E6 — Grounded price, historically low confidence:** confidence/routing lets it quote — but only when grounding actually succeeded; never override a true grounding failure.
- **E7 — Risk-flagged / safety-compliance job:** stays inspection-routed (R27) even if a price is computable; price-hiding on the quote page preserved.
- **E8 — Hot-water unknown system type:** not guessed (R26) — captured, or escalated to inspection; no invented gas/electric assembly.
- **E9 — Duplicate via recipe extras:** Opus-drafted extra + recipe-appended extra for the same item is caught and de-duplicated, not double-charged (R7).
- **E10 — Tradie edits one tier to add a duplicate of another tier:** caught by cross-tier edit validation (R8).
- **E11 — Service toggled off then immediately tested over SMS:** the next inbound reflects the new state (R30); no multi-turn staleness.
- **E12 — Catalogue material added then immediately quoted:** recognized on the next quote (R32); no stale generic-price fallback for a now-stocked category.
- **E13 — First message of a brand-new conversation (concurrent webhooks):** no orphaned inbound; the customer gets a reply (R43).
- **E14 — Rapid back-to-back texts:** every message is processed and answered; no silent drop (R44).
- **E15 — Long/complex job exceeds the LLM budget:** the webhook still completes its sends or fires a fallback "snag" SMS — the customer is never left in silence (R42, R45, R46).
- **E16 — One of the three sends fails (Twilio error / rate limit):** it retries independently and the other two still go out; failure is logged/alerted (R46, R48).
- **E17 — Migration re-run / partial apply:** runner scripts are safe to re-run without corrupting data (R49).
- **E18 — Unverifiable data value during research:** surfaced as a flagged item for the user's decision (R22/R29), never guessed.

## Definition of Done

- [ ] R1–R2: Written map of the current SMS quote pipeline exists, naming every invented-price / duplicate / inspection-downgrade / dropped-send decision point by file:line, with drift from the PRIMARY doc noted.
- [ ] R3: Replayable representative job-set fixtures built from real DB data for both trades.
- [ ] R4: Root-cause inventory classifies every issue (layer + avoidable/legitimate) with a proposed fix; R5–R49 reconciled against current code.
- [ ] R5–R6: Within-tier and cross-tier duplicate line items are detected and prevented; legitimate same-product-different-quantity offers are explicitly framed, not silently stacked.
- [ ] R7 / E9: Opus pre-empted recipe extras can't double-charge against recipe-appended extras (enforced check, fail-closed).
- [ ] R8 / E10: Tradie quote-edit re-validates duplicates across all three tiers.
- [ ] R9: Recipe merge is per-tier error-isolated; appended extras are micro-validated or dropped+logged.
- [ ] R10–R15: KB-origin tracking, after-hours source-tag enforcement, tightened category matching, constrained `inspection_reason`, post-reconciliation re-check, and spec-mismatch blocking/routing are all in place; grounding validator never loosened.
- [ ] R16: Column completeness matrix exists for all 9 catalog tables (meant-to-carry vs reserved).
- [ ] R17 / R29 (A-pass): every meant-to-carry-data column on every row (shared + all tenants), for materials and services, is populated with verified AU values, with per-row provenance.
- [ ] R18: `shared_assembly_bom` is seeded for core assemblies and confirmed consumed by the estimator.
- [ ] R19: `pricing_book` rows verified sane; `apprentice_rate`/`senior_rate`/`after_hours_multiplier` wired or explicitly marked deprecated/reserved.
- [ ] R20: reserved/unwired columns documented as intentionally-empty — none fabricated.
- [ ] R21 / R29 (B-pass) / E1–E2/E5: every representative job type has a groundable price path for its trade; tenant overlays resolve; tenant BOM preferred over shared; preferences re-rank without starving quotes.
- [ ] R22: all data changes shipped as migrations + source/provenance record; unverifiable items flagged (E18); `sql/init.sql` representative.
- [ ] R23: zero auto-quote job types with NULL `clarifying_questions`.
- [ ] R24 / E3–E4: dialog injects and enforces per-job questions; `action=finish` is blocked until mandatory fields are answered.
- [ ] R25–R26 / E8: conditional questions (GPO 600mm, smoke compliance) work; plumbing `system_type`/`supplied_by` captured as structured fields; WP5 contradiction resolved; unknown hot-water system type captured or escalated, never invented.
- [ ] R27 / E7: per-job inspection triggers escalate correctly; risk-flagged jobs stay inspection-routed with price-hiding preserved.
- [ ] R28: per-job confidence gating lowers confidence and fires callback when a mandatory field is missing.
- [ ] R30–R31 / E11: toggling a service on/off is reflected on the next inbound SMS (root cause confirmed and fixed; defined invalidation on write).
- [ ] R32–R33 / E12: manual catalogue adds and shared→tenant/fork additions are recognized on the next quote; fork category gaps surfaced, not hidden.
- [ ] R34: wiring tests prove toggle-off/toggle-on/add-material are sensed on the next inbound/quote.
- [ ] R35–R40: Estimating read-only contradiction resolved; toggle concurrency fixed; cross-tab badge sync works; fork category-presence surfaced; licence row appears on trade activation; shared/custom name collision handled.
- [ ] R41: every dashboard tab driven end-to-end; writes persist; multi-trade fan-out correct (trade A edits don't touch trade B).
- [ ] R42 / E15: no send lost to timeout — webhook completes its sends or fires a fallback "snag" SMS.
- [ ] R43 / E13: first-message conversation-create race eliminated; no orphaned inbound.
- [ ] R44 / E14: rapid back-to-back texts are all processed and answered.
- [ ] R45: every `after()` block has a top-level try/catch + customer/tradie fallback notification.
- [ ] R46 / E16: AI reply, photo, quote, and tradie sends each retry independently (incl. AbortError/timeout); one failure doesn't abort the others.
- [ ] R47: Twilio retries / concurrent retries can't duplicate inbounds or double-fire handoffs.
- [ ] R48: all sends + skips logged; latency/non-delivery/near-timeout alerts in place.
- [ ] R49 / E17: tunable knobs via env; all DB changes as idempotent migration + runner; no prod writes by the build.
- [ ] R50: representative job set replayed end-to-end — correct materials, grounded prices, no duplicate charges, consistent ex/inc-GST, correct inspection vs quote routing.
- [ ] R51: vitest + parity harness extended to cover duplicates, grounding integrity, data coverage, question enforcement, wiring, and Twilio reliability; suite passes.
- [ ] R52: live dev-server smoke (dashboard tabs + replayed SMS) confirms fixes in the running app.
- [ ] R53: final coverage report maps every R + R4 item to fix + verification, with before/after metrics.
- [ ] All edge cases E1–E18 demonstrably handled (test or documented behavior).
- [ ] Constraints honored: grounding validator intact, tool-calling-only pricing, ex/inc-GST convention, research integrity (flag-not-fabricate), SMS-only scope, migration discipline, no secrets committed, no prod writes by the build.

## Open questions

None blocking. Where a real-world AU price, labour figure, rate, or service detail is genuinely ambiguous during the audit, it is surfaced as a flagged item in the R4/R22/R29 records for your decision rather than guessed (E18).
