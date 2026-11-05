# EV charger and SMS consistency repair — 15 September 2026

## Status

Implemented in the working tree and independently reviewed. Production deployment has not occurred. The existing EST-0018 record, its financial amounts and customer messages have not been changed.

The incident investigation is recorded separately in [EST-0018 review](2026-09-15-ev-charger-est0018-review.md).

## What now determines the quote

- Each option must have its own valid charger product reference or authenticated tradie-entered charger-unit line before it can say charger supply is included. A charger in Best does not establish charger supply in Better.
- If the customer requests supply but no charger is priced, the scope and price label explicitly say installation estimate, charger excluded, with model/specification/supply price pending tradie confirmation.
- The same pure supply interpretation drives generated scope, assumptions, exclusions, option descriptions, public-page output and EV HTML/PDF output. EV PDF template version is now `ev4`.
- Customer-supplied units remain installation-only. Existing prices are not changed by rendering or current catalogue repricing.
- Mixed sentences retain unrelated site work and exclusions when obsolete supply wording is removed. A previously excluded charger becomes included only when the selected option has valid unit evidence.
- Public inclusions and optional upgrades follow the selected option. Included RCBO and switchboard-check work is not sold again as an optional extra. Internal machine diagnostics are removed from customer risk notes; readable site warnings remain.

## Pricing safeguards

- A three-phase outlet assembly cannot silently substitute for a charger installation. Incompatible or missing EV base work is held for review. A zero-quantity EV line cannot satisfy that check.
- Conflicting `source` and `catalogue_id` values fail closed without removing the wrong item or reducing its total.
- Matching a callout amount alone no longer validates arbitrary `each` product or labour charges. Real catalogue references and legitimate callout descriptions still work.
- Model-generated `tradie_manual` lines no longer bypass grounding. Only the authenticated, tenant-owned quote save explicitly permits manual pricing, still subject to arithmetic validation. Generation strips forged manual-edit audit markers.
- A failed optional-extra price is removed even when that extra already exists under an equivalent name.

## SMS and intake safeguards

- Five EV intake topics are a mandatory minimum: vehicle, who supplies the unit, mounting location, distance from switchboard, and property phase/capacity. Old three-question catalogue scripts cannot bypass the floor. Additional custom electrician questions remain required.
- Customer phase evidence is normalised across `phase`, `supply_type` and `supply_phase`. An assistant recap does not establish it. Explicit three-phase evidence survives “no spare capacity” and triggers the existing inspection policy.
- Contextual yes/no answers to capacity questions are recognised, reducing repeat questions.
- A recap ending “Sound right?” no longer exempts its preceding numeric claims. Unsupported 7kW and charger-phase claims are rejected. A three-phase property answer does not specify a three-phase charger.
- Required EV-photo wording follows the resolved conversation job type, including when the latest guess is unknown. Missing mandatory facts still block handoff, and an explicit photo decline is respected.

## Sampling and model evidence

The current SMS model remains `claude-sonnet-5`; intake uses the configured Opus model. Both SMS decision paths and intake structuring now use the existing common sampling policy. It requests `temperature: 0` for compatible models and omits unsupported settings for current Sonnet/Opus models. Top P and Top K are not forced.

Official provider documentation says current Sonnet 5 does not accept custom sampling controls: [Sonnet 5 changes](https://platform.claude.com/docs/en/docs/about-claude/models/whats-new-sonnet-5). Installed AI SDK request-body tests verify actual serialization against synthetic HTTP responses. They are not live provider acceptance tests.

No model switch or system-prompt text change was made. Deterministic pricing, readiness and presentation rules constrain the output; identical live LLM wording is not promised. The repository's holdout inventory still contains five ungraded placeholders and no gradable price targets. No 100-pair model-quality evaluation or accuracy delta is claimed.

## Validation

| Check | Result |
|---|---|
| All estimator suites plus shared EV presentation | 1,089 passed; 17 opt-in live tests skipped |
| Final SMS/intake regression pack | 486 passed across 16 files |
| Focused actual public page and EV document/cache checks | 84 passed across 5 files |
| Broader quote/PDF suites plus authenticated edit endpoint | 1,271 passed across 73 files; opt-in live files excluded; overlaps focused checks |
| Authenticated manual save and pricing validation | Passed worker's focused endpoint and grounding packs; overlaps estimator coverage |
| Root standalone TypeScript check | Passed |
| Next.js production build | Passed, exit 0; all 84 static pages generated |
| Standalone Electrical build and release verifier | Passed; 535 compiled outputs verified against source, dependency lock and platform contract |
| Compiled Electrical EV regressions | 19 passed with provider networking disabled |
| Built Electrical HTTP smoke | Passed: liveness, authenticated failed-readiness, signed photo-only ingress, duplicate durable ACK; child exit confirmed |
| Scoped changed-source lint | Passed; existing unused SMS variable warning remains outside the change |
| Independent review | Original incident and all seven additional review findings replayed successfully; no residual findings in assigned scope |

The production build emitted existing `metadataBase` warnings for social-image URLs. These do not change the EV validation result. `git diff --check` passed. Full application-wide tests, live LLM acceptance and carrier delivery were not run.

The tests include the redacted EST-0018 fixture, preserving its $801 ex-GST / $881.10 inc-GST arithmetic during presentation reconciliation. They also cover included versus pending charger supply, authenticated manual lines, wrong-tier/absent audit markers, compound exclusions, conflicting references, zero-quantity assemblies, repeated capacity questions, custom compound questions and customer-only phase evidence.

GitNexus was refreshed successfully: 67,296 nodes and 187,577 edges. The final `detect-changes --scope all` check reports high impact (138 symbols, 10 indexed flows), including shared intake and quote entrypoints and pre-existing dirty files. The user was informed. Process indexing reports bounded coverage; neither absent flows nor App Router `UNKNOWN` impacts are treated as proof of safety. Direct route tracing, meaningful regressions and independent review supplement the graph. No commit has been made.

## Production boundary

Read-only inspection found Electrical Railway deployment `510e74e5-c53f-4761-838d-844ba4d10c30`, created 8 September, still active. Its health endpoint returns 200, while `/api/health/ready` returns 404. It predates the current standalone release contract.

The connected database has no `public.sms_quote_chain_ready()` function, which the current release contract expects from migration 218 and its later updates. Exporting the current source therefore also brings pre-existing, broader release prerequisites. A healthy old endpoint is not evidence that the new candidate can safely receive production traffic.

The isolated candidate passed the repository's export, lock, seal, build, verification and smoke procedure. Source hash: `38de49cba2af7d2bc0483ebe4c8c59c3db14e2fafef1752e7984fa79e0a95dec`.

Candidate root and logs: `C:/Users/dalig/.codex/visualizations/2026/09/15/01a0a3a4-e192-7523-a76e-29cb9e052a3e/ev-charger-electrical-candidate-01`.

General traffic must wait for the matching website/database contract and controlled acceptance described in [SMS release prerequisites](2026-09-09-sms-release-prerequisites.md). Local HTTP smoke tests use inert fixtures and do not prove live schema compatibility, carrier delivery or image deployment. No broad migration or fleet cutover is included in this scoped source repair.

The corrected HTML review fixture is a local, redacted preview, not a newly issued customer quote.
