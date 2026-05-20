# SMS AI Agent Sweep Report (2026-05-20)

> Test harness: n8n workflow `t3Hu6NyvxiXvLOD4` ("SMS AI Agent — Test Harness")
> Test pair: `+61489083371` → `+61481613464` (dev shared SMS number, no tenant attached)
> Mode: plan + report, no auto-commit per user preference
> Coverage: **41 of 43 services tested** (T002 smoke alarm and T025 dishwasher returned no reply within the wait window — possibly slow LLM call, retest needed)

## Headline

| Grade | Count | Meaning |
|---|---:|---|
| ✅ PASS | **14** | Correct classification + asked a sensible / mandated question |
| ⚠️ FLAG | **19** | Worked but didn't ask the per-row mandated clarifying questions before deciding inspection |
| ❌ FAIL | **6** | Service exists in catalogue but agent declined as `out_of_scope` or hard-misclassified |
| ❓ NO REPLY | 2 | T002, T025 (worth retrying) |

The agent's **core flows are healthy** — downlights, GPOs, ceiling fans, hot water, tap repair, blocked drain, toilet — all classify and respond cleanly. The failures cluster into three precise bug families documented below.

## Bug Cluster A — Catalogue extras declined as `out_of_scope`

The dev test number `+61481613464` has no tenant attached. The dialog reads `tenant_service_offerings` for the tenant on the receiving number; with no tenant it gets an empty set; the dialog then treats every catalogue extra as a service we don't offer and declines.

Affected services (all of these exist in `shared_assemblies` with prices + mandated questions, all are migration-021 extras with `default_enabled=false`):

| Test | Service | Reply |
|---|---|---|
| T011 | Install LED strip lighting | "LED strip lighting installs sit outside what we can quote over SMS" |
| T017 | Install security camera (single) | "PoE camera installs aren't something we can quote over SMS" |
| T018 | Install wired doorbell or intercom | "doorbell and intercom work isn't something we can quote over text" |
| T028 | Install garbage disposal | "garbage disposal fitting isn't something we can quote over SMS" |
| T031 | Install rainwater tank | "rainwater tank connections are outside what we can quote over SMS" |
| T033 | Install whole-house water filter | "whole-house mains water filter is a bit outside what we can quote over SMS" |

**Diagnosis**: For a real tenant who has ticked these services ON in the dashboard, the dialog will work correctly (we already saw that pattern in the WP5 + services-toggle-OFF memory). The bug is that the **dev shared number has no tenant** so the dialog can't tell whether the service is enabled — and it defaults to "decline". This is the inverse of what `project_services_toggle_off_decline` (2026-05-19) was supposed to do: toggle OFF declines; absent-tenant should fall back to the shared default catalogue (services with `shared_assemblies.default_enabled=true`), NOT decline-all.

**Proposed fix** (no commit): when `tenantByDestinationSms` returns `null`, build the offerings list from `shared_assemblies` where `default_enabled = true` (the core easy-5 per trade) for the fallback case. Catalogue extras still decline (matches v1 behaviour: they only offer if a tenant has ticked them on). That would unbreak T024 below too.

Also affected by the same root cause (different symptom — the agent still engaged but classified as `out_of_scope`):

| Test | Service | Note |
|---|---|---|
| T024 | Hand rod blocked drain | Classified `out_of_scope` but dialog still asked "completely blocked or slow draining?" — recovered. Should classify as `blocked_drain` (easy-5 plumbing). |

## Bug Cluster B — Inspection bypass on services with mandated clarifying questions

Migration 032/033 added per-row `clarifying_questions` to every catalogue service with the explicit goal "dialog blocks quote until answered". The agent is **skipping those questions and offering the $199 inspection straight away** for the install-existing-wiring / outdoor electrical / specialist plumbing services.

Affected (13 services):

| Test | Service | Mandated qs in DB | Reply |
|---|---|---:|---|
| T003 | Hardwire induction cooktop | 3 | "needs a sparky on-site… $199 inspection" |
| T004 | Hardwire oven | 3 | "needs a sparky on-site… $199 inspection" |
| T005 | Install aircon power point | 3 | Asked generic GPO Q ("replace or add") not aircon-specific qs |
| T007 | Install cooktop (existing wiring) | 3 | "needs a sparky on-site to check the existing circuit" — but THAT is mandated question #2 |
| T009 | Install EV charger | 3 | "too many variables to quote blind" — but mandated qs cover them |
| T013 | Install outdoor IP-rated GPO | 3 | "new outdoor circuit required" — but mandated q2 ASKS this |
| T014 | Install outdoor IP-rated LED light | 0 (none defined) | Same pattern as T013, defensible |
| T015 | Install oven (existing wiring) | 3 | Same as T007 |
| T021 | CCTV drain inspection | 3 | "needs someone on-site" without asking purpose / report / length |
| T023 | Gas appliance connection | 3 | Defensible (licensed gasfitter) but mandated qs not asked |
| T034 | Jet blast blocked drain | 0 | Tree-roots → inspection without asking recurring / surface / depth |
| T035 | Leak detection | 3 | Inspection without asking signs / location / actively flowing |
| T036 | Pressure reduction valve install | 3 | Inspection without asking pressure symptoms / replace vs first install |

**Diagnosis**: somewhere in `lib/sms/dialog.ts` the "should I offer inspection?" decision fires BEFORE the mandated-question check runs. Migration 032/033's whole point was to gate quote/inspection on those answers. Either:
1. The dialog reads `shared_assemblies.clarifying_questions` for the matched assembly but ignores them when the next decision step is "this looks complex → inspection"
2. The classifier is dropping the question step entirely for certain `category` values (oven_cooktop, ev_charger, gas, outdoor, prv, leak_detection, cctv)

**Proposed fix** (no commit): trace `lib/sms/dialog.ts` for where `shared_assemblies.clarifying_questions` is read. Add a phase where if any clarifying question hasn't been answered for the matched assembly, ask it BEFORE any inspection-route branch. Existing tests in `lib/estimate/min-labour.ts` and the mandated-questions migrations already encode this contract.

## Bug Cluster C — Classifier hallucinations on phrases that don't contain the service name

| Test | Customer said | Got classified | Should be | Why |
|---|---|---|---|---|
| T001 | "Half the power points in my kitchen stopped working — need someone to find the fault" | `smoke_alarms` | `fault_find` | "stopped working" / "find the fault" is the textbook fault-finding cue; classifier picked up "kitchen" + the count "4" instead |
| T006 | "Bathroom exhaust fan needs replacing" | `unknown` | `fan` (or new `exhaust_fan`) | "exhaust fan" doesn't match the `fan` regex pattern obviously |
| T035 | "Wet patch under the bathroom floor — need someone to find the leak" | `fault_finding` | `leak_detection` | The right service exists (`category=leak_detection`) but classifier picked `fault_finding` (electrical category!) |
| T037 | "Just need the shower head swapped" | `tap_replace` | `shower` | Shower category exists; classifier defaulted to tap_replace |
| T038 | "Toilet seat is cracked" | `toilet_repair` | `toilet` (or specifically `toilet_seat`) | Defensible — toilet_repair is close enough |

**Diagnosis**: the classifier prompt likely doesn't have enough explicit examples for migration-021 extras and the leak-detection / shower / exhaust-fan distinctions. The easy-5 categories (smoke_alarms, tap_replace, toilet_repair) dominate the few-shot bias and become catch-alls.

**Proposed fix** (no commit): add explicit classifier examples for each migration-021 extra category (fault_find, leak_detection, shower, strip_light, exhaust_fan…) in `lib/intake/structure.ts` or wherever the few-shot examples live.

## What worked (the PASS column, 14 services)

These all classified correctly AND asked an appropriate next question:

- T008 ceiling fan supply-mode (WP5 working)
- T010 LED downlight (canary repeat)
- T012 motion sensor flood light
- T016 premium DC fan with wall control (WP5 working)
- T019 Replace double GPO (asked wet-zone safety Q — that's the migration 036 mandated check)
- T020 Supply + install AC ceiling fan
- T026 Install electric HWS (asked location)
- T027 Install external garden tap (asked supply mode)
- T029 Install gas HWS (asked storage vs continuous + size)
- T030 Install heat pump HWS (asked current size)
- T032 Install washing machine taps (asked supply mode)
- T039 Stormwater drain unblock (asked completely-blocked vs slow)
- T040 Tap replacement (asked supply mode)
- T041 Tap washer replacement (asked diagnostic — spout vs body)
- T042 Toilet cistern repair (asked which toilet)
- T043 Toilet suite install (asked which toilet)

## Recommended next actions (no auto-commit)

In priority order:

1. **Fix Cluster A first** — it's a 5-line fix and unblocks 7 services. When `tenantByDestinationSms()` returns null, fall back to `shared_assemblies WHERE default_enabled = true` for the offerings set instead of empty-decline. File: probably `app/api/sms/inbound/route.ts` near line 290 where the tenant is resolved.
2. **Fix Cluster C classifier** — add explicit few-shot examples for the migration-021 extras and the distinguishable categories (leak vs fault, shower vs tap, exhaust vs ceiling fan). File: `lib/intake/structure.ts` or the SMS dialog system prompt in `lib/sms/dialog.ts`.
3. **Fix Cluster B inspection bypass** — biggest behavioural change; needs careful design. Audit `lib/sms/dialog.ts` for any direct path from "matched assembly" → "offer inspection" that doesn't pass through the `clarifying_questions` gate first. This is the highest-value fix because it affects 13 services + violates the migration 032/033 design contract.
4. **Retest T002 + T025** — they had no captured reply (likely slow LLM call past my 90s wait). Re-fire them via the direct-webhook runner.
5. **Cleanup** — close 43 test conversations + tag-delete the test customer row `+61489083371` so it doesn't pollute analytics / customer memory across future tests.

## Artefacts

- `scripts/sms-sweep-manifest.json` — 43 service prompts
- `scripts/sms-sweep-results.json` — n8n/Twilio sweep results (43 rows; 16 actually delivered)
- `scripts/sms-sweep-direct-results.json` — direct-webhook sweep results (27 rows, all delivered)
- `scripts/sms-sweep-grading.json` — auto-grader output (eyeball review supersedes)
- `scripts/sms-sweep-all-services.mjs` — manifest builder
- `scripts/sms-sweep-runner.mjs` — Twilio sweep runner
- `scripts/sms-sweep-direct-runner.mjs` — direct-webhook bypass runner (uses `TWILIO_AUTH_TOKEN` to forge a valid signature)
- `scripts/sms-sweep-evaluate.mjs` — auto-grader
- `scripts/show-sweep-replies.mjs` — human-readable transcript dump
- `scripts/investigate-sweep-cliff.mjs` — Twilio carrier-rate-limit diagnostic
