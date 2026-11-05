# Rank 1 Electrical SMS implementation and rollout

> Historical implementation record. The owner subsequently expanded Rank 1 to **all accounts and the entire system**. The Atomic-only selection, tenant allowlist and pilot enablement instructions below are superseded by [strategy v26](../strategy.md) and the [system-wide rollout record](2026-09-23-rank1-systemwide-rollout.md). The older candidate hashes are not current release evidence. Earlier tests and unresolved production gates remain part of the audit history.

Date: 23 September 2026. Status: local implementation and built candidate completed; pilot not enabled or deployed. Production gates below remain open.

## Decision and scope

The owner authorised implementing the Rank 1 plan after comparing ten alternatives. Retain Next.js/Vercel for the portal, Node 22/NestJS/Railway for the SMS worker, Twilio for transport, Supabase Postgres for authoritative state, and direct Anthropic via `ai` + `@ai-sdk/anthropic` for conversation and typed intake. No Vercel AI Gateway, additional model provider, agent SDK or database is introduced. Models do not calculate quote prices. Authenticated tradies approve every new customer quote.

Canonical implementation is in `quotemate-automation/`, generated into a fresh sealed candidate. A separately reviewed source-only overlay was merged into the long-lived Electrical directory; it was not regenerated wholesale or treated as an attested release. Both checkouts contain unrelated, pre-existing changes. Any local candidate is a validation artifact until its exact changes are reviewed and promoted from an explicit release allowlist/ref.

## Implemented boundaries

- Historical-price RAG returns no context and performs no database retrieval, even when old flags are enabled.
- Unmatched destination tenants cannot create customer quotation work. Signed durable receipt and explicit tradie signup remain supported; unresolved jobs remain visible for recovery.
- `RANK1_QUOTE_CORE_TENANTS` selects exact Electrical tenant IDs. Empty by default; `*`, `all` and booleans do not enable a fleet. Configure the same approved IDs on website and worker.
- Pilot estimation uses its captured immutable pricing-book version and tenant-only recipe/catalogue evidence. It does not enter monetary model generation or a model fallback.
- Quote Core uses exact decimal parsing and integer cents, explicit GST policy, minimum labour, source IDs and unit/line/GST rounding. It rejects missing, ambiguous, stale or unapproved authority.
- Unsupported scope or internal data gaps produce a zero-tier review draft, not an invented amount or a chargeable inspection. Genuine structured site-inspection decisions remain distinct.
- Product specifications are checked against the priced catalogue ID/name/properties, never recipe prose. Unsupported specification keys, ambiguous identity and fractional ratio rules hold for review. Review-only drafts cannot create Stripe sessions or early-booking offers.
- Initial release checks the captured job scope, property/access facts, safety/confidence, address and deterministic scope wording. Tier-bound calculation/scope evidence is covered by the existing atomic quote snapshot comparison; this does not claim an atomic lock on subsequent intake edits. Historical released offers remain anchored to their original snapshot.
- A designated Electrical candidate carries `rank1Required: true` in its release fingerprint. Readiness requires its selected test tenant to have the pilot enabled. No tenant IDs are returned in capability output.
- The evaluation harness runs actual captured outputs, rejects ungraded placeholders and expected-answer leakage, and requires source-backed human grades before production scoring. Its core adapter does not call a model, database or carrier.

## Honest initial coverage

This is a restricted pilot, not complete Electrical automation. Priceable work requires approved, active tenant products/recipes, explicit supply-and-install scope, validated specifications, known item count/address, configured call-out/labour/GST/markup, and supported recipe quantity semantics. Conditional components, conditional price bands, different labour quantity assumptions and component-specific supply-only/install-only recipes hold for review. Supporting these jobs requires approved structured rules and new graded cases, not a prompt claiming the missing facts.

Conversation remains the existing direct Anthropic receptionist. This implementation does not claim improved measured conversational intelligence or change prompts without a baseline. Never equate deterministic calculator tests with a multi-turn SMS evaluation.

## Release procedure

1. Identify the pilot tenant, approved price book, grading owner, controlled numbers, target Supabase project, portal deployment, Railway service and known rollback artifact. Do not enable the flag from a guessed tenant ID.
2. Obtain at least 100 de-identified, human-graded Electrical fixtures with price/recipe provenance. Use `quotemate-automation/eval/README.md` for actual-core capture and the production evaluation gate. The current five ungraded placeholders are a deliberate no-go.
3. Review the precise canonical change allowlist and all overlapping pre-existing edits. Run the focused quote, approval, replay, durability and export checks; record source/config fingerprints.
4. Export a new candidate, never point the exporter at the dirty standalone checkout. Source-only updates to that checkout require a separate preimage/overlap review and do not transfer release attestation:

   ```powershell
   node scripts/export-receptionist.mjs --rank1 --out-root=C:/path/to/new-candidates electrical
   ```

5. In the new `qm-electrical-receptionist` directory, resolve a lock with `npm install --package-lock-only --ignore-scripts`, then install with `npm ci --ignore-scripts`. From the canonical app directory, seal the candidate with `seal-receptionist-release.mjs`, build with `receptionist-build.mjs`, and exercise `smoke-built-receptionist.mjs`. Use `node scripts/verify-receptionist-release.mjs <candidate> --rank1-fixture=<graded-json> --rank1-actuals=<captured-json>`; missing evidence must fail, not downgrade the candidate to a legacy release. The gate repeats the actual pure calculation as well as scoring the captured results.
6. Verify actual required migrations/RPC bodies, tenant isolation, website approval/public/PDF/payment parity, backup and rollback readiness. No database changes or release routing are authorised by a local test result.
7. Deploy the exact reviewed, attested candidate to a controlled staging service. Configure direct provider secrets, matching website/worker pilot IDs, authenticated readiness, durable worker and callback endpoints. Never print credentials or use production-capable simulation casually.
8. Prove the controlled SMS → draft → owner approval → released snapshot → delivery callback → customer page/PDF/payment path, including duplicates, restarts, delayed messages and a second tenant denial test. A provider acceptance is not handset delivery.
9. Promote one approved Electrical tenant only after all gates pass. On a critical error, hold new work for humans while preserving durable receipts and reconciling ambiguous outbound messages; do not simply disable the flag and fall back to model pricing for new pilot work.

## Outstanding promotion gates

- Selected pilot: **Atomic Electrical**, tenant `829702af-b7eb-48f6-9574-29bf08ed9106`. Read-only queries using the Electrical service's configured database found active SMS configuration, one complete basic policy, seven active Electrical catalogue rows and three tenant recipe rows across hardwired oven/security-camera assemblies. The camera offering is disabled; no labour/markup override rows exist for these two assemblies. This is the strongest existing structured-data candidate among the active Electrical tenants inspected, not evidence that its entire book is approved or that its core coverage is sufficient. No tenant data or enablement flags were changed. Pricing-owner review is still required.
- Five repository holdouts are still ungraded; no 100-case accuracy result exists.
- Live migrations, installed worker artifact/configuration, controlled carrier delivery, real conversational evaluation and authenticated customer journey are unverified.
- Broader Electrical recipe coverage and privileged-query isolation audit are not complete.
- The isolated candidate's `npm audit --omit=dev` reported nine advisory-affected packages (five high, four low), including image processing and Nest/Express upload dependencies. Remediate and retest before staging/promotion; no forced framework upgrade was bundled into this price-authority change. `ai` includes an unused Gateway package transitively; this is not Gateway configuration or Gateway routing—the code calls the direct Anthropic provider.
- No production configuration, SQL mutation, deployment or real SMS change has been made by this implementation session. The tenant/readiness inspection above was read-only; live workflow evidence remains outstanding.

## Verification record

- Consolidated focused run: 14 test files, **268 tests passed** (core, scope, catalogue authority, quantity restrictions, hold behaviour, tenant ingress, captured versions, release proof, readiness and adapter).
- Evaluation harness: **15 Node tests passed**; separate actual-runtime promotion gate: **6 tests passed**, including fabricated-output rejection. Two additional actual draft-POST tests confirm held/legacy-checkpoint drafts persist without inspection/Stripe/early-bird/PDF/customer quote links while creating an owner-review task and status-only customer message.
- Canonical full TypeScript check: blocked only by the pre-existing `customer-release-ev-service-mode.test.ts:117` reduce-accumulator typing errors. Two existing EV tests also expect superseded error labels; the unchanged EV validator still blocks those unsafe cases. These unrelated changes were not rewritten to hide the baseline failures.
- GitNexus index is older than this dirty tree. Targeted existing impacts were LOW/MEDIUM or unresolved and directly traced. Whole-workspace detection reports **critical breadth** (85 changed files/383 symbols including prior work); its abbreviated output is not clean assurance for a full-checkout release. No commit or push performed.

### Built candidate and pipeline update

- Candidate directory: `C:\Users\dalig\Desktop\MaintainTech\MaintainOrg\QuoteMax\Receptionists\_candidates-rank1-20260923\qm-electrical-receptionist`.
- Sealed source identity: `de7936a28384a18c22e67485bb8077c82f4855c9be2b7ada8eac246b286e19f6`.
- Attested build: **547 compiled outputs**. Offline built HTTP smoke passed liveness, authenticated failed-readiness, signed photo-only ingress and duplicate durable ACK; provider I/O was blocked and the child process exited.
- Full release verifier reached and correctly failed the mandatory raw graded-fixture/estimator-capture gate. It is **not** a successful promotion verification. Actual adapter production evaluation reports 3 Electrical placeholders, **0 graded, 0 scored, accuracy not measured**; all five repository fixtures remain ungraded.
- Applied a reviewed **24-file source-only overlay** to the requested existing `qm-electrical-receptionist` folder, preserving unrelated dirty changes and its environment/package/lock files. This adds the core, pipeline integration and worker/readiness source; it does not copy a manifest/build attestation into an editable checkout or pretend that checkout is a sealed artifact. Standalone `npm run typecheck` and `npm run build` both passed; all 24 files match the candidate after line-ending normalization. Its `docs/RANK1_IMPLEMENTATION_HANDOFF_2026-09-23.md` records the source overlay and remaining gates. No standalone app was started with live credentials.
- Direct provider configuration remains unchanged. No commit, push, deployment, tenant-write, real SMS or activation flag change occurred.

Local evidence is not production certification. Obtain approved recipe coverage, real graded cases, dependency remediation and controlled live acceptance before enabling the selected tenant.
