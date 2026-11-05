# Rank 1: all-account platform scope

Date: 23 September 2026. Status: local system-wide hardening phase implemented and checked. Production deployment remains gated; this is not an accuracy certification.

The owner superseded the Atomic Electrical pilot decision. Rank 1 is the shared architecture and safety policy for **all accounts**, including existing and future accounts, across SMS receptionist and portal/API quotation paths. No account is privileged by its business name or by a rollout allowlist.

## Conversation decisions carried forward

The original problem was inconsistent SMS quotes, estimation, logic and maths. The discussion compared direct Claude SDK access with agent frameworks and Gemini File Search, then selected the Rank 1 separation of conversation from deterministic pricing. Changing the model SDK alone was not treated as proof of accurate quoting.

The owner explicitly rejected Vercel AI Gateway configuration, requested a documented deployment plan and authorised implementation in the platform and Receptionists API pipelines. Electrical was the first reference implementation; the subsequent instruction expanded the scope from Atomic Electrical to all accounts and the entire existing system. That scope change does not authorise invented tenant prices, automatic customer quote release, a new trade or voice-agent work.

## What universal means

- Direct Anthropic through Vercel AI SDK for conversation/structured intake; no Gateway configuration.
- Tenant-owned authoritative pricing and deterministic monetary calculations. An LLM may not become the money fallback when a recipe or catalogue source is missing.
- Each account keeps its own prices, rules, products and customer records. Account-wide coverage never permits cross-tenant retrieval or pricing.
- Missing data or unsupported work goes to useful clarification or human review. Internal configuration failures must not invent quotes or create inspection charges.
- Explicit authenticated tradie approval before a new customer quote release. Existing released historical offers remain tied to their saved snapshot.
- Durable receipts, jobs and outbound delivery handling shared by the fleet.

## Trade coverage is a separate question

Electrical's new exact-cent Quote Core is the reference implementation. Existing deterministic specialist engines keep their own approved rules; they are not relabelled as the Electrical engine. The generic path must review-hold work outside its validated recipe contract. Broader account coverage does not automatically provide complete catalogue/recipe coverage for every trade or job.

This change covers both SMS and direct portal/API entry points. Broader account scope does **not** mean every request can already be automatically priced. Unsupported generic plumbing, roofing, painting and solar requests are held unpriced; the existing dedicated specialist engines keep their separate source and approval contracts.

## Implemented stack and boundaries

| Layer | Implementation |
| --- | --- |
| Portal and APIs | Existing Next.js App Router on Vercel; same tenant and release rules as SMS |
| SMS services | Existing Node/NestJS Railway services for Electrical, Plumbing, Roofing, Painting, Solar, plus Front Desk |
| Conversation and typed intake | Direct Anthropic through `ai` and `@ai-sdk/anthropic`; no Gateway routing, additional agent SDK or provider introduced |
| Authoritative state | Supabase Postgres: tenant-owned records, versioned pricing books, saved source snapshots and release evidence |
| Pricing | Exact-cent Electrical Quote Core; existing deterministic specialist calculators using complete owned rate cards; no monetary model fallback |
| Transport and background work | Twilio plus durable inbound receipts, fenced work/checkpoints, outbound idempotency and recovery |
| Customer release | Authenticated tradie approval, server-side source validation, atomic saved-release contract, matching page/PDF/payment authority |
| Deployment proof | Source/website contract fingerprint, lock seal, build attestation, authenticated readiness and trade-specific evaluation gates |

Specific changes:

- `rank1QuoteCoreEnabled()` is unconditional. A retired allowlist or false-like environment value cannot restore model pricing for another account.
- Estimation captures the account's immutable price-book version and uses approved recipe/catalogue identities. Missing authority, ambiguous scope and unsupported quantity/specification rules are review holds. EV supply-only or unresolved service mode cannot become a site visit because of an old inspection flag.
- Historical-price retrieval is disabled as monetary authority. It performs no quote-history retrieval, even when the old flag is enabled.
- New drafts require approval regardless of an old `auto_send` price-book setting. Review-only drafts have no tiers, inspection charge, Stripe session or early-booking discount.
- Painting saves recompute on the server, ignore browser-supplied prices, require complete owned rates and remain unreleased. Missing measurement credentials cannot silently create a mock production estimate.
- Solar estimation, redrafting and building selection require complete owned rates. Building selection no longer reuses an unversioned monetary cache.
- Roofing promotion is checked against the exact owned measurement, quote linkage, source revision, scope, tier prices and selected totals before release. Supplying a roofing label is not a bypass.
- Editing an unreleased quote cannot notify the customer or stamp `sent_at`. Previously released core quotes cannot retain stale calculation evidence after price edits; an invalid revision is rejected for recalculation/review.
- Front Desk retries revalidate the current destination owner, active account status and enabled trade. Direct trade ingress also checks the account's enabled service before customer/model work.
- Plumbing's form-first workflow, stable form token and gathered slots are retained inside durable checkpoints. Roofing, Painting and Solar retain their dedicated flows with review-first release and active worker pollers.
- Service information pages now describe review holds and explicit approval, and distinguish liveness/configuration checks from authenticated capability readiness.

## Configuration and rollout

The former `RANK1_QUOTE_CORE_TENANTS` list is retired as a control. It must not exclude accounts or restore model pricing. `SMS_READINESS_TENANT_ID` remains only a controlled **test-evidence** context for authenticated readiness, not a list of accounts allowed to use the feature.

All newly exported trade candidates identify the all-account policy in their release fingerprint. Old single-account candidates cannot silently stand in for a new system-wide artifact. Front Desk routes/accounts remain isolated; it does not gain price authority.

No production change is implied by this document. Before deployment, fix the recorded dependency advisories; validate actual schema/RPCs, privileged query isolation, compatible website/worker releases and each trade's graded cases; prove controlled SMS → draft → owner approval → customer/PDF/payment → delivery journeys. Never reuse an Electrical-only accuracy score to approve painting, plumbing, roofing or solar. No fabricated grades, real customer test messages or wholesale overwrite of dirty service folders.

## Local verification record

These are offline implementation checks, not measured customer-facing accuracy:

- Entire estimation suite: **80 files, 1,200 tests passed**.
- SMS library suite: **86 files, 1,662 tests passed**; six live/provider tests in four files intentionally skipped. The subsequently added plumbing durable-form suite passed **20 tests** separately, including failure before the secret-token checkpoint is committed.
- Actual draft API: **12 tests passed**, including successful deterministic pricing for two separate accounts, persisted calculation/source replay, unsupported-trade holds and no premature customer quote release.
- Edit, notification policy, roofing promotion, approve/send, strict core authority, delivery and PDF suite: **246 tests passed across seven files**.
- Painting and solar direct-API/source-authority checks: **31 tests passed across five files**.
- Export/attestation/lock/container contract checks: **60 tests passed across four files**. Readiness, release identity and evaluation adapter/gate checks also passed; their Electrical replay does not certify other trade calculators.
- Generated service-copy and retirement-guard checks: **eight tests passed**.
- Final current-source inbound route, tenant boundary, plumbing recovery, generated trade-ingress and service-copy run: **132 tests passed across five files**. This includes the real transformed webhook entry points for all five trades and the real plumbing POST/outbox path under offline fixtures.
- Front Desk: **73 routing checks** and its offline durable-routing regression suite passed, including reassigned destination, disabled trade and cross-account cases.
- Full canonical TypeScript check (`tsc --noEmit --incremental false`): **passed** after correcting test-fixture typing.
- All six final long-lived service builds passed after the r3 source refresh: Electrical, Plumbing, Roofing, Painting, Solar and Front Desk. Retained Plumbing/Roofing/Painting form and address checks passed, as did all six compiled web-session security checks.
- Evaluation-runner unit tests: **15 passed**; production evaluation still refuses the ungraded dataset, as required.
- Final export/readiness/evaluation regression batch: **194 assertions passed across 11 files**. Its website-contract suite initially exceeded the 10-second Windows temporary-file cleanup hook; the teardown-only budget was increased to 30 seconds and that complete 25-test suite passed on rerun. Pricing, release and evaluation assertions were not weakened.
- **All six compiled services passed offline HTTP checks:** liveness 200, unauthenticated readiness 403, fixture-only readiness 503 with `ok:false`, invalid Twilio signature 403, signed photo-only ingress and duplicate acknowledgement 200. Fixture acknowledgements were 6–30 ms; local trade-service cold starts were 25.0–50.7 seconds. These are not production latency measurements. The harness used fixture-only credentials, disabled local environment-file loading in memory and blocked external fetch/socket/TLS/DNS traffic. All spawned services were stopped. No carrier, live database or quote-generation journey was exercised.

The production Electrical evaluation was deliberately run and correctly refused promotion: no human-graded cases or scored actual outputs. There are five ungraded repository placeholders in total (three Electrical), not a validated holdout set. No scores or approvals were invented.

Graph impact analysis was run before functional changes. The bound index is stale and its refresh previously failed; unresolved graph results were checked against direct call sites. This is not a clean whole-checkout graph review. Unrelated existing edits remain untouched; no commit or push was made.

## Candidate and service-source handoff

Canonical app: `C:\Users\dalig\Downloads\QuoteMate\quoteMate\quotemate-automation`.

The final five-trade source export is `C:\Users\dalig\Desktop\MaintainTech\MaintainOrg\QuoteMax\Receptionists\_candidates-rank1-systemwide-20260923-r3`. Every generated source hash and website contract hash was checked against its manifest and the current canonical source. All five manifests have contract version 2, `rank1Required:true` and `rank1Scope:all_accounts`.

These fresh candidates are **source-only and not build-attested or promotion-ready**. The earlier unsuffixed and `-r2` directories are superseded; they were preserved rather than overwritten. The separately reviewed long-lived service overlays have their own local build and offline HTTP evidence, not the candidates' release identity. No `.env`, package manifest, lockfile, release manifest or build attestation was copied onto an existing service as part of source synchronization.

Each long-lived service has a `docs/RANK1_SYSTEMWIDE_SOURCE_ROLLOUT.md` record for its preserved custom flows and local checks. Front Desk uses its own staging script rather than the five-trade exporter.

The final normalized source comparison found no missing exported files. Electrical matches all 277 candidate source files. Plumbing (275), Roofing (291), Painting (294) and Solar (282) each retain only two deliberately unrelated shared-file differences: `lib/ig-engine/prompts.ts` and `lib/onboard/intent-tokens.ts`. Target-only checks and helpers were preserved. These reviewed overlays are therefore not described as byte-identical, attested candidate deployments.

## Deployment sequence and open gates

1. Review the exact change set in the canonical app and all six service folders. Keep unrelated dirty changes outside a release. Do not run the exporter over a long-lived dirty service folder.
2. Finish the unsupported trade-specific replay adapters and approved recipe coverage. Collect independently graded, de-identified holdouts and tenant-owned price books. Electrical promotion requires at least 100 distinct graded Electrical cases; another trade cannot borrow this evidence.
3. Resolve dependency advisories against the new candidate lockfiles and rerun regression tests. The earlier isolated Electrical candidate reported nine affected packages (five high, four low); that historical audit is not a clean audit of these new candidates.
4. Verify the actual target schema/RPC definitions and privileged query isolation, including receipt/job fencing, atomic release and customer document/payment paths. Have a backup, rollback artifact and recovery owner. No live migrations were applied in this work.
5. Export all trade services into a fresh candidate root from the reviewed canonical source. Stage Front Desk separately with its release script. Every trade candidate must declare `rank1Required: true` and `rank1Scope: "all_accounts"`.

   ```powershell
   # Run from quotemate-automation. Use a new, reviewed candidate directory.
   node scripts/export-receptionist.mjs --out-root=C:/path/to/new-candidates
   ```

6. Resolve and review each candidate's lockfile; install reproducibly, seal, build, run the offline HTTP smoke and verify the exact artifact with `seal-receptionist-release.mjs`, `receptionist-build.mjs`, `smoke-built-receptionist.mjs` and `verify-receptionist-release.mjs`. A source-only overlay or copied `dist` is not a release attestation. Missing evaluation proof must remain a failed gate.
7. Deploy the matched website/worker release to controlled staging after the gates pass. Use direct provider credentials, correct public/engine origins, enabled workers and authenticated readiness. `SMS_READINESS_TENANT_ID` selects a test context, not a rollout allowlist.
8. Prove multi-tenant, multi-turn SMS → saved draft → tradie approval → immutable customer quote/PDF/payment → delivery callback journeys. Include duplicate webhooks, restarts, delayed replies, reassigned numbers, disabled trades, price corrections and uncertain carrier acknowledgements. A successful build or provider acceptance does not prove handset delivery or conversational quality.
9. Promote the approved release across the intended services and accounts. On a critical failure, retain durable receipts and route new work to human review while reconciling uncertain sends. Never restore model-generated prices as rollback behaviour.

All-account policy is implemented in source, but production activation, real carrier delivery and measured accuracy/intelligence remain unverified. There were no production deployments, remote configuration changes, live database mutations or real customer SMS sends in this continuation.

The earlier [Electrical implementation record](2026-09-23-rank1-sms-implementation.md) is historical evidence; its Atomic-only selection, hashes and allowlist instructions are superseded by strategy v26 and this document.
