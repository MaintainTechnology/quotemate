# Claude Code handoff: QuoteMax EV charger service mode and SMS receptionist

Prepared: 16 September 2026, Asia/Manila.

Codex session: `01a0a3a9-47ba-7593-8d75-7aa779424e29`.

## Read this first

The user asked us to fix the root cause of EV charger requests being quoted as supply and installation when that service combination was not clearly requested. We have implemented substantial changes across the QuoteMax website/API and the standalone Electrical SMS receptionist. **The work is not finished or ready to claim as released.**

The immediate next priorities are:

1. Fix the confirmed post-draft customer mode-correction race described in section 8. The current saved code still contains it.
2. Resolve two failing release-test expectations, then rerun the affected checks and complete an independent review against the new specification.
3. Export and synchronize the final canonical code into the standalone Electrical receptionist. Its current source misses at least the latest clarification-cap safeguard and later surface/release changes.
4. Finish final integrated typecheck/build/regression checks and the standalone release verification procedure.

No commit, push, deployment, production migration, customer SMS, replacement quote release, or alteration of the reported customer's financial records was performed for this service-mode repair. The latest user request was specifically to write this handoff for a new Claude Code session, so application editing was paused and the current state was inspected.

The independent review never reached a final PASS. It found real issues, several were fixed, and the review/worker loop was interrupted by a Codex usage limit. At the start of this handoff, no original implementation agents remained active. Do not wait for those old agents or assume their announced edits landed.

## 1. User goal and preferred direction

The user first supplied five screenshots and the complete Steve SMS conversation, and asked for feedback. They then explicitly requested:

> Let's fix the root of the problem by modifying the Quotemax EV charger and the SMS AI receptionist's system, ensuring we won't encounter this issue again.

Their intended behavior is three distinct services:

| Customer choice | Correct result |
| --- | --- |
| Supply only | Sell the charger unit; no installation labour or site-inspection funnel. |
| Installation only | Install the customer's charger; do not sell them another charger. |
| Supply and installation | Price both the actual charger unit and the installation. |

The preferred fix is an end-to-end change: receptionist question and state, intake, dashboard form/API, estimator, release validation, SMS, public quote, HTML/PDF, payment/booking routes, and exported receptionist must agree. A wording-only patch is insufficient.

Continue the scoped build/review loop until the specification passes. Preserve unrelated work. Give plain-English progress and distinguish local tests from deployed/customer behavior. Do not promise that LLM wording can never vary; enforce the business contract deterministically.

## 2. Repositories, paths, and current Git state

### Main QuoteMax/QuoteMate repository

- Root: `C:/Users/dalig/Downloads/QuoteMate/quoteMate`
- Application: `C:/Users/dalig/Downloads/QuoteMate/quoteMate/quotemate-automation`
- Git remote: `git@github.com:MaintainTechnology/quotemate.git`
- Current branch, freshly checked for this handoff: `main`
- Current HEAD: `e3872b0e6e804afe6bfe10c1be3238d2f1d6f742`
- User-facing product name: QuoteMax. Historical directory/repository name: QuoteMate/quotemate.

### Standalone Electrical SMS receptionist

- User-provided parent: `C:/Users/dalig/Desktop/MaintainTech/MaintainOrg/QuoteMax/Receptionists`
- Electrical repo: `C:/Users/dalig/Desktop/MaintainTech/MaintainOrg/QuoteMax/Receptionists/qm-electrical-receptionist`
- Remote: `https://github.com/MaintainTechnology/qm-electrical-receptionist.git`
- Current branch: `main`
- Current HEAD: `09531819a1b1783cb056bcead604e4feb7d9a7d6`
- Fresh handoff check counted 165 changed/untracked status entries in this repo.
- Other sibling receptionists exist (plumbing, roofing, painting, solar, front desk); they are not part of this requested Electrical repair.

### Important working-tree warning

Both repositories are dirty. The main checkout includes changes from this repair, an earlier related EV consistency repair, and unrelated SMS dashboard/schema work. There are also generated `.claude-flow` metrics changes. Do not stage everything, reset the tree, overwrite all files, or treat every modified file as owned by this session.

Before any publication, inspect the diff and use an explicit file allowlist or a clean worktree with carefully carried changes. No publication was completed here.

## 3. Original incident and evidence

This session's customer is **Steve in Harboard**, although the SMS contact label was Jonathan Pepper. The important sequence was:

1. Customer: “Can you do EV chargers”.
2. Receptionist asked whether the charger was already on site and what model it was.
3. Customer: “Not on site... can you supply”.
4. Receptionist agreed to supply, then immediately asked the switchboard distance and electrical phase/capacity.
5. Customer gave 7 m, single phase, likely spare capacity.
6. Receptionist recapped “EV charger install ... we're supplying the unit”.
7. Customer replied “Sounds right”.
8. The quote described supply and installation, showed 4 hours of installation-related labour, and directed the customer to a $99 site visit.

Important interpretation: “can you supply?” establishes interest in supply, but alone does not unambiguously distinguish supply-only from combined service. The AI had already steered the conversation toward installation before asking. The later affirmative recap can resolve a clearly stated combined scope, but it cannot establish a charger model or a valid supply price. The fix asks the three-way question before entering the installation flow.

Screenshot evidence:

- Main scope: supply and install the charger on a dedicated single-phase circuit, approximately 7 m.
- Exclusion: supply of the charger unit itself excluded.
- “Good to know”: tradie supplies the charger unit.
- Another note: charger supplied separately, model and price confirmed before booking.
- Breakdown: $171.60 installation assembly + $495.00 installation labour + $165.00 switchboard/isolation work = **$831.60 inc GST**. The SMS rounds this to $832.
- No distinct priced charger-unit product appears in that breakdown.

Original quote link supplied by the user: `https://quotemax.com.au/q/fH7vLy-a70v0n9YqnRQt8A`. It was evidence, not authorization to pay, book, or send anything. The handoff did not re-open or modify the live record.

The five original image files are in `C:/Users/dalig/AppData/Local/Temp/`:

- `codex-clipboard-6fe95fa2-34a9-4bb3-b4ad-7caae8d6a266.png`
- `codex-clipboard-6e019420-02af-4e67-b293-8f501bc51af5.png`
- `codex-clipboard-454f03e8-d63e-4fb9-99a0-a40eb0ef0dd6.png`
- `codex-clipboard-104b7a9e-92fa-4e0b-a065-abd80484b19a.png`
- `codex-clipboard-bdfdc4c2-d902-4b62-ab8f-307f1942d7f5.png`

An earlier, related incident involves **Bob in Chandler / EST-0018 / $881.10**, documented in `docs/audits/2026-09-15-ev-charger-est0018-review.md`. Do not confuse Bob's record, amounts, or verification results with Steve's case.

## 4. Architecture and authority boundaries

### Main application

The operational application is Next.js App Router, hosted through Vercel. It uses Supabase/Postgres for tenant data, conversations, intakes, quotes, catalogues and durable work; Twilio for SMS; AI SDK/provider calls for dialog, structuring and drafting; Stripe for payment; and shared public quote/HTML/PDF rendering. Gotenberg/HTML-based quote documents exist alongside legacy PDF logic.

Relevant flow:

```text
Twilio inbound SMS
  -> app/api/sms/inbound/route.ts
  -> persisted conversation slots + deterministic mode/readiness gates
  -> product choice / installation photo flow, when applicable
  -> durable intake work
  -> app/api/intake/structure/route.ts
  -> intakes.scope.specs.service_mode + chosen_product
  -> durable estimate work
  -> app/api/estimate/draft/route.ts -> lib/estimate/run.ts
  -> catalogue grounding + EV mode/line consistency
  -> saved quote awaiting explicit tradie approval
  -> approve/send/edit release checks
  -> durable outbound SMS + public page + HTML/PDF + payment/booking
```

The dashboard starts at `app/dashboard/job/_components/JobQuoteForm.tsx`, posts to `app/api/tenant/job-quote/route.ts`, and joins the same intake/estimator/release pipeline. The API rereads the chosen product and price server-side.

Core persisted concepts:

- `sms_conversations.conversation_state.slots`: customer facts and explicit mode.
- `sms_conversations.product_choice`: selected product state.
- `sms_conversations.intake_id`, `quote_id`, `quote_stage`: pipeline linkage and recovery.
- `intakes.scope.specs.service_mode`: canonical persisted EV request.
- `intakes.scope.specs.supplied_by`: compatibility field derived from mode.
- `intakes.scope.chosen_product.catalogue_id`: selected product anchor.
- `quotes.good/better/best`: priced tiers with source references and line amounts.
- `quotes.risk_flags`: includes server-owned manual-edit provenance when applicable.
- `quote_pricing_versions` / saved pricing snapshots: historical pricing authority.
- Durable jobs, outbox and release snapshot/revision machinery: idempotency and explicit approval.

### Standalone receptionist

`qm-electrical-receptionist` is a separate NestJS service intended for Railway. It has adapted route files under `src/receptionist/` and generated/copied shared modules under `src/lib/`. It is a separately deployed surface, so changing only the Next.js source does not change its behavior.

The canonical exporter is `quotemate-automation/scripts/export-receptionist.mjs`. It builds adapted candidates from the monolith. Preserve the standalone repo's `.env`, `.git`, package/platform ownership and existing unrelated edits. Export to a new candidate directory, verify it, then synchronize the intended source files; do not point a destructive export at the live Git checkout.

## 5. Decisions already made

The contract of record for this repair is:

`C:/Users/dalig/Downloads/QuoteMate/quoteMate/quotemate-automation/specs/ev-charger-service-mode.md`

Read it completely. It supersedes service-intent portions of older EV specifications without discarding unrelated pricing, inspection, tenant, or approval requirements.

### Canonical modes

- `supply_only`
- `install_only`
- `supply_and_install`
- Unknown is represented by the field being absent, **not** a fourth stored enum value.

`supplied_by=tradie` alone cannot distinguish supply-only from combined and stays unresolved. Exact legacy dashboard options can be mapped. Legacy customer-supplied metadata can be interpreted as installation-only by compatibility readers, while strict readiness/release gates require explicit canonical state.

Exact receptionist question:

> Do you need the charger supplied only, installation only for a charger you already have, or both supply and installation?

“Can you supply?” must trigger clarification. A short “yes” or “sounds right” establishes mode only in the context of an unambiguous single-mode recap. The LLM is not the authority allowed to invent mode independently.

### Mode-specific requirements

| Mode | Required | Must not be added |
| --- | --- | --- |
| Supply only | Vehicle/compatibility, selected positively priced charger product | Installation questions/work/labour, site photo, certification wording, $99 inspection |
| Installation only | Existing installation facts and photo/allowed explicit decline handling | Charger product choice or charger-unit charge |
| Supply and installation | Installation facts plus selected positively priced charger product | A complete combined-price claim when the charger is unpriced |
| Unknown | Explicit mode clarification | Product offer, site/photo funnel, quote handoff or customer release |

A charger is proven by a positive-quantity, positive finite-price EV material line anchored to the appropriate catalogue, or an authenticated tradie-authorized manual charger-unit line. An installation assembly, labour, RCBO, cabling, or a description containing “charger” does not prove charger supply. Model-generated manual provenance cannot authorize pricing.

Every present priced tier must satisfy the mode. A valid unit in one tier does not validate another. Supply-bearing tiers must match the chosen catalogue product unless an authenticated manual unit is authorized.

Missing charger pricing is a tradie-review/product-selection gap. It must not silently become a $99 inspection. Genuine installation/site conditions retain the established installation policies.

Customer renderers must not change issued quote totals. If an incompatible tier would require hiding installation rows while retaining its subtotal, show a review-required state instead. Legitimate supplied accessories must remain in the breakdown so rows reconcile to the stored total.

All newly drafted quotes require explicit tradie approval. Do not reintroduce auto-send. Final priced EV quotes must satisfy the same service contract as initial quotes. Balance records are separate tier-less payment requests; the generic send route already rejects them.

### Existing project constraints

Read root `AGENTS.md`, `README.md`, and the iteration history in `docs/strategy.md`. Current strategy header is v24; old painting-first prose is historical. Electrical/plumbing/roofing/painting/solar evolution and human approval are already recorded. Do not add another trade or turn this into voice-agent work. This task concerns the existing SMS system.

Currency is stored ex GST and shown inc GST to customers; preserve saved pricing versions and tenant ownership checks. No infrastructure expansion is needed for this repair. No strategy change was made in this session; if a later implementation changes a load-bearing product decision, record it through the repository's strategy process.

## 6. Implemented source changes

Paths in this section are relative to the `quotemate-automation` application directory.

| Area | Main files | Current implementation |
| --- | --- | --- |
| Canonical mode | `lib/quote/ev-service-mode.ts`, `lib/intake/schema.ts` | Three-value schema, normalization, strict/legacy readers, labels and supplier mapping. |
| SMS extraction | `lib/sms/extract-slots.ts`, `lib/sms/dialog.ts` | Deterministic mode extraction and explicit prompt rule; capability enquiry does not grant installation. |
| SMS readiness | `lib/sms/quote-readiness.ts`, `lib/sms/product-options.ts` | Mode-specific requirements; product choice only for supply-bearing modes. |
| Inbound enforcement | `app/api/sms/inbound/route.ts` | Overrides drift toward install/photo/inspection; exact question for unknown mode; no-progress cap cannot sell an inspection for unresolved/supply-only EV. |
| Intake handoff | `app/api/intake/structure/route.ts`, `lib/intake/structure.ts` | Unknown-mode preflight before structuring; stale intake normalization and mode-change clearing when no saved quote blocks the path. Post-draft case remains open. |
| Dashboard | `lib/quote/job-fields.ts`, `JobQuoteForm.tsx`, `app/api/tenant/job-quote/route.ts` | Explicit mode, server-verified active positive-price EV product for supply modes, stale product/photo/site field clearing. |
| Estimator | `lib/estimate/ev-charger-supply.ts`, `lib/estimate/electrical-prompt.ts`, `lib/estimate/run.ts` | Supply-only skips installation BOM/recipes/labour; mode/line matrix; chosen-product match; grounded installation requirement; missing data held for tradie review. |
| Draft save | `app/api/estimate/draft/route.ts` | Holds EV/customer quote release for approval; supply-only skips installation preview/sample generation. |
| Release/edit | `lib/quote/customer-release.ts`, `app/api/quote/[id]/{approve,send,edit}/route.ts` | Release matrix and scope checks; supply-only inspection-state rejection; final-quote enforcement; edit validation before released writes/notifications. |
| Shared presentation | `lib/quote/ev-supply-presentation.ts` | Per-tier product evidence, scope/assumption/exclusion reconciliation, supply-only tier display safety. |
| Customer surfaces | `app/q/[token]/page.tsx`, `lib/quote/report-html-ev-charger.ts`, `lib/quote/pdf.ts`, `lib/sms/templates.ts` | Mode-aware copy and rendering; supply-only order/delivery presentation; unknown/incompatible public/PDF review gate; full supplied-item table. |
| Payments/booking | `lib/quote/mint-tier.ts`, `lib/quote/accept.ts`, `app/r/[token]/[tier]/route.ts`, `app/api/q/[token]/book/route.ts`, public book/paid pages | Supply-only avoids site-visit-first flow; inspection route rejected and product-only payment can avoid booking. |
| Database questions | `sql/migrations/222_ev_charger_service_mode.sql`, `222_down.sql` | Guarded change to the exact old shared EV question array, with exact canonical mode question first. No historical mode backfill or price changes. |

Migration 222 was validated locally earlier using PGlite. The question text was subsequently made byte-for-byte consistent with the runtime question in both up/down files. It has not been applied to production; rerun migration checks after that final wording adjustment.

## 7. Review findings and their current state

These were found through strict review, not hypothetical enhancements.

| Finding | Current handoff state |
| --- | --- |
| Supply-only page could display raw installation/labour rows | Defensive display-tier gate now exists; actual public-page regressions pass in fresh handoff run. |
| Supply-only with `needs_inspection` or stored inspection routing could pass release | Central inspection-state rejection and public/document protection exist. |
| Supply-only exclusion still mentioned certification | Deterministic wording changed; release scope checks reject certification wording. |
| Clarification cap could turn missing vehicle/compatibility into $99 inspection | Fixed in canonical inbound route; earlier inbound suite passed 123/123; standalone still lacks this fix. |
| A second present but empty tier was ignored | Validator now rejects present empty tiers; one fresh release test expects the older error code and currently fails. |
| Raw contradictory `scope_of_works` could be sent in SMS | Release now rejects incompatible scope. All-mode scope regressions exist. This is rejection at release, not proof that every direct template caller normalizes raw text. |
| Approve/send forgot mode in `isSiteVisitFirstRow` | Calls now pass mode; fresh route tests pass for no inspection link and deposit validation. |
| Final quotes bypassed EV consistency | Exemption narrowed to balance records; final enforcement exists. One fresh test expects a different earlier failure code and currently fails. |
| Unknown legacy EV could render the electrical $99 page/PDF | Public and document review gates exist and fresh focused tests pass. |
| Supply-only PDF hid accessories but retained their total | Renderer now includes the complete safe supply-only line list; accessory arithmetic regression exists. |
| Post-draft customer correction can leave stale combined quote releasable | **Still open; highest priority.** See section 8. |

An inactive-catalogue-row concern was raised and then explicitly retracted by the reviewer. Candidate validation deliberately retains deactivated rows so a newly grounded draft is not invalidated by a deactivation race; new product lookup/selection excludes inactive entries. Do not quietly change that policy based on the earlier retracted comment.

## 8. Confirmed unresolved post-draft correction bug

Reproduction to implement as a true regression:

1. SMS conversation has a canonical `supply_and_install` intake and an existing quote awaiting tradie approval.
2. Customer texts “Actually supply only”.
3. The latest intent must invalidate the earlier combined request before any tradie release can succeed.

Current code obstacles, freshly inspected for the handoff:

- `app/api/sms/inbound/route.ts:2623`: `handleSavedJobCorrection(...)` runs before normal EV slot extraction and can intercept that correction.
- `app/api/sms/inbound/route.ts:3865`: `hasExistingIntake = !!savedQuoteId || quoteAlreadyDrafted` suppresses readiness/photo/intake handoff for saved quotes.
- `app/api/intake/structure/route.ts:484`: `if (convo.quote_id)` returns the existing intake immediately before mode reconciliation.
- `app/api/estimate/draft/route.ts:125`: an existing saved quote returns through `resumeSavedSmsQuote(...)`. Simply re-enqueueing the same intake does not redraft it.
- Release validation currently reads the persisted intake/quote. If those remain combined while only the conversation changes, the old pair can still validate together.

The final assigned worker (`ev_inbound_cap`) reported this exact interception and proposed a fix, but no completed implementation or tests were delivered before interruption. The current code still contains the early return and suppression path.

Accepted implementation direction before interruption:

- Recognize an explicit EV service-mode correction deterministically before the generic saved-job correction path consumes it.
- For an **unreleased held quote**, reconcile the persisted intake authority and clear incompatible product/install/photo state, and leave the old quote blocked for correction.
- A safe full redraft is preferable if it fits the existing recovery design. A minimal fail-closed repair is acceptable: update the held intake authority, keep the quote held, create clear durable review context, and ensure its old lines/scope cannot pass release until the tradie corrects them.
- Do not delete quote/intake rows or mutate an already issued quote's terms or amounts. Released/sent/accepted/paid cases should enter the existing review/amendment workflow.
- Preserve durable idempotency and avoid duplicate quote/customer messages.
- Explicitly test all three directional changes, unknown state, released-row immutability, retries, and the release attempt after correction.

Also consider the interval between receiving the correction and asynchronous intake reconciliation: the release boundary must not authorize a stale quote during that window. Prove the intended ordering or add a scoped mismatch/hold check against the originating conversation.

## 9. Verification evidence: what passed and what did not

### Fresh verification during this handoff, 16 September

Ran eight late surface/release suites together. Result: **168 passed, 2 failed; 7 files passed, 1 failed**.

Passing files:

- `lib/sms/templates-ev-service-mode.test.ts`: 2 tests.
- `lib/quote/ev-supply-presentation.test.ts`: 47 tests.
- `lib/quote/ev-supply-document-regression.test.ts`: 3 tests.
- `app/api/quote/[id]/send/route.test.ts`: 24 tests; includes both send and approve route behavior.
- `lib/quote/report-selection.test.ts`: 7 tests.
- `lib/quote/pdf-pricing-authority.test.ts`: 41 tests.
- `lib/quote/quote-page-pricing.test.ts`: 26 tests.

Failing file: `lib/quote/customer-release-ev-service-mode.test.ts`, 18 passed / 2 failed:

1. Around line 175, “blocks a second present tier whose empty breakdown would otherwise be ignored” expects `empty_present_tier`, but receives `supply_only_tier_presentation_conflict` for `better`.
2. Around line 256, “enforces the EV service-mode contract on final customer quotes” expects `unexpected_installation_work`, but receives `supply_only_tier_presentation_conflict` for `good`.

Both observed failures still reject release before the RPC; the test expectations and the newly earlier presentation guard disagree on the error code. Review which diagnostic contract is intended, then align the tests/aggregation without weakening the rejection. These tests were deliberately left unchanged during the handoff request.

### Earlier results from this session

These passed before the latest surface/release edits and therefore do not certify the exact final working tree:

| Check | Earlier result |
| --- | --- |
| Integrated regression pack | 30 files / 781 tests passed. |
| Intake handoff focused suite | 22/22 passed. |
| Dashboard API operation suite after adding combined-mode coverage | 32/32 passed. |
| All inbound route suites after clarification-cap fix | 123/123 passed. |
| Customer-links inbound suite | 75/75 passed, including true two-receipt cap regressions. |
| Dashboard Playwright | 3/3 passed with one worker and 90-second timeout after warming compilation. |
| TypeScript | Passed at multiple intermediate checkpoints. |
| Next.js production build | Passed; all 84 static pages generated. Existing metadataBase warnings. |
| Scoped ESLint | Passed for changed slices at those checkpoints. |
| Diff whitespace check | Passed at those checkpoints apart from informational CRLF conversion warnings. |
| Migration 222 | Earlier PGlite up/down validation passed; exact first-question wording was subsequently aligned. |

The surface worker last reported an intermediate run of 198/202 and patched assertion mismatches, but never returned final completion evidence. The fresh 168/170 result above is the latest directly observed surface snapshot.

Full repository lint is not a clean gate: `lib/estimate/run.ts` has an existing backlog (previously observed 69 errors and 2 warnings), and broader generated/pre-existing files also create noise. Earlier review found no newly added `any` lines in that file. Use scoped lint and report baseline limitations honestly; do not silently repair unrelated lint.

No final full application suite, live LLM acceptance, actual carrier delivery, live customer booking/payment, or post-deploy browser flow was proven. Prompt changes exist, and the repository requires evaluation deltas; the earlier audit reports only five ungraded placeholder holdouts, so no 100-pair quality evaluation is claimed. Decide and document the remaining evaluation gate before shipping prompt changes.

## 10. Standalone export and synchronization status

An earlier candidate was generated and synchronized into the standalone repo. At that time the worker reported:

- 242 shared library files plus 3 adapted route files checked.
- 165 standalone changed files.
- Zero candidate/source mismatches and zero out-of-scope changes for that synchronization.
- Standalone typecheck/build/release verifier and synthetic Steve smoke passed.

That candidate is now stale. Its path, freshly located:

`C:/Users/dalig/Desktop/MaintainTech/MaintainOrg/QuoteMax/Receptionists/_candidates-20260915/final-stable/qm-electrical-receptionist`

Manifest source hash:

`03af3585bbb71e48d0b458d4d54d4bc527d78372be8b79df3c87a06d8bc9b526`

The directory name `final-stable` is historical and does **not** mean the current repair is final. A previous candidate also exists directly under `_candidates-20260915/qm-electrical-receptionist` with hash `14740ca4b1bff21b77fd20b8f1e3c4c40da431895bf0d01d9fe2c021a7d135b3`.

Fresh handoff search confirms the actual standalone `src/receptionist/inbound.route.ts` has service-mode changes but does not contain `evCannotUseInspectionFallback`, which is present in the canonical route. Later central release/public/template/helper changes must also be compared, and the unresolved correction fix must be included after it lands.

After canonical code is stable, generate a new candidate using the exporter, inspect its README and release scripts, lock dependencies, seal, build, verify and smoke-test it. Relevant canonical scripts:

- `scripts/export-receptionist.mjs`
- `scripts/receptionist-build.mjs`
- `scripts/seal-receptionist-release.mjs`
- `scripts/verify-receptionist-release.mjs`
- `scripts/smoke-built-receptionist.mjs`
- `scripts/receptionist-platform-contract.mjs`
- `scripts/receptionist-schema-contract.mjs`

The standalone checkout currently uses `nest build && tsc-alias -p tsconfig.json` and `tsc --noEmit`. Use the candidate's exact release instructions; do not mix a new source export with an old dependency lock or release seal.

## 11. Production and review warnings

### Existing production prerequisites were not refreshed here

The earlier sibling audit `docs/audits/2026-09-15-ev-charger-consistency-repair.md` records an Electrical Railway deployment from 8 September, a health endpoint returning 200 but readiness endpoint 404, and a database missing `public.sms_quote_chain_ready()`, expected by the newer release contract. That is earlier evidence, **not a fresh production check for this handoff**.

Read `docs/audits/2026-09-09-sms-release-prerequisites.md` before any rollout and verify the current website/database/receptionist contract. Exporting current source brings existing broader release prerequisites. Local Nest/Next builds do not prove those prerequisites are satisfied.

### Conflicting older documents

`docs/audits/2026-09-15-ev-charger-consistency-repair.md` says its earlier assigned scope passed independent review and describes an installation-only estimate fallback when supply pricing is missing. That is a related earlier repair, not final sign-off on this newer three-mode contract. The new `specs/ev-charger-service-mode.md` and current open findings take precedence for this session.

### GitNexus

Root AGENTS requires graph impact before code edits and changed-impact analysis before commit. Earlier targeted checks were LOW or UNKNOWN; UNKNOWN was supplemented with direct caller searches. The last aggregate shared dirty-tree analysis reported **CRITICAL**, approximately 66 files / 280 symbols / 24 indexed flows, with no partial/truncated flag. It includes broad shared and unrelated dirty changes and is not a clean bill of health.

Run targeted impact for any new fix and warn before HIGH/CRITICAL edits. Rerun `detect-changes` after final edits. Do not treat missing graph callers/processes as proof that App Router code is unused.

### Security and external effects

Do not print `.env` contents, secrets or customer contact details into handoff logs. Preserve tenant scoping and saved price authority. No live SMS, payment, booking, migration or deployment should be used as a casual test. Prepare a concrete reviewed release, then follow the user's deployment authorization and existing release process.

## 12. Suggested continuation sequence and commands

1. Read this handoff, root AGENTS, the full service-mode specification and the current diffs. Confirm both Git states before editing.
2. Fix section 8 first with a deterministic route regression and release-attempt assertion. Inspect `lib/sms/job-corrections.ts` and the durable work identity/recovery design as well as the three route files.
3. Resolve the two current release-test expectation failures and rerun the late surface pack. Include `lib/estimate/ev-charger-supply.test.ts` to verify the lower-level diagnostic still has meaningful direct coverage.
4. Run the focused SMS/intake/dashboard/estimator/release/payment suites, typecheck and scoped lint after changes.
5. Complete independent requirement-by-requirement review. PASS only when every R1–R5 and DoD item is actually met. The previous review skill is `C:/Users/dalig/.codex/skills/review/SKILL.md`; it requires independent strict review and does not allow partial acceptance.
6. Export/synchronize the final standalone receptionist and verify byte parity, build, release fingerprint and synthetic behavior. Include the actual post-draft correction and cap regressions in parity checks.
7. Run final build, browser check and GitNexus changed-impact check after the last meaningful edits. Record exact current results and limitations.
8. Hand the user a clear ready-to-release state or concrete remaining blockers. Do not claim production remediation until deployment and controlled acceptance are actually complete.

PowerShell note: use `login:false` when supported; the user's login profile is known to be broken. Prefer PowerShell 7. Paths containing `[id]`/`[token]` should be quoted and read using `-LiteralPath`. Use `apply_patch` for edits and avoid destructive Git/file commands.

From the repository root:

```powershell
git status --short
git diff --stat
node .gitnexus/run.cjs impact "symbolName" --direction upstream --repo .
node .gitnexus/run.cjs detect-changes --scope all --repo .
```

From `quotemate-automation`, reproduce the fresh handoff surface pack:

```powershell
pnpm vitest run lib/quote/customer-release-ev-service-mode.test.ts lib/quote/ev-supply-presentation.test.ts lib/quote/ev-supply-document-regression.test.ts lib/quote/pdf-pricing-authority.test.ts lib/quote/report-selection.test.ts lib/quote/quote-page-pricing.test.ts lib/sms/templates-ev-service-mode.test.ts 'app/api/quote/[id]/send/route.test.ts'
```

Useful focused checks to include after the correction fix:

```powershell
pnpm vitest run lib/sms/ev-service-mode.test.ts lib/sms/quote-readiness.test.ts lib/sms/product-options.test.ts app/api/sms/inbound/route.customer-links.test.ts app/api/intake/structure/route.ev-service-mode-handoff.test.ts lib/quote/job-quote-operation.test.ts lib/estimate/ev-charger-supply.test.ts
pnpm typecheck
pnpm build
pnpm exec playwright test tests/e2e/ev-charger-job-quoter.spec.ts --workers=1 --timeout=90000
git diff --check
```

The browser configuration previously did not define a project named `chromium`; do not add `--project=chromium` without checking the current config. Cold parallel compilation caused an earlier timeout; the warmed serial run passed.

## 13. Suggested opening prompt for Claude Code

> Continue the QuoteMax EV charger service-mode repair described in `docs/handoffs/2026-09-16-ev-charger-service-mode-claude-handoff.md`. Read that file and `quotemate-automation/specs/ev-charger-service-mode.md` completely. Preserve the dirty work in both repos. Start with the confirmed post-draft SMS correction/release race, then resolve the two current release-test failures, complete independent review, re-export the final Electrical receptionist and run final checks. Do not infer completion from the older audit or stale candidate named final-stable. Keep customer-issued quotes immutable and maintain explicit tradie approval. Report real evidence and remaining rollout prerequisites.

