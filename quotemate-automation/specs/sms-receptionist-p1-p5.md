# SMS receptionist reliability — P1–P5 from the live end-to-end evaluation

## Title
Stop the SMS receptionist remembering a rejected address, advertise the tenant's real trades, and engage roofing on a burst.

## Goal
A live scenario run (`.scratch-audit/scenario-runner.mjs` against QM Sparky) shows: (P1) an address the map check refused is never written to `customers.address/suburb`; (P2) the greeting lists the tenant's actual enabled trades, not a hardcoded "electrical + plumbing"; (P3) a rapid burst whose first message is a roofing enquiry engages the deterministic roofing receptionist. Why: the evaluation proved a refused address ("45 Wimbledon Crescent, Faketon") became the customer's remembered address and resurfaced in a later conversation, the greeting mis-advertised a cross-trade tenant, and a roofing burst fell to the general LLM which then leaked that stale address.

## Role
Principal engineer for this repo. Deterministic receptionist logic is pure and unit-tested; the general dialog is LLM-driven and verified with scenario runs, not only vitest. Act directly on reversible edits; the money path stays tool-call-only.

## Context (grounded in code opened)
- **P1 write path** — `app/api/sms/inbound/route.ts:2104-2157`: the general-dialog slot extraction merges updates (`mergeSlotUpdates`), and when a `PERSISTENT_PROFILE_SLOTS` entry (`suburb`/`address`) is sourced `customer_corrected`, `writeCustomerCorrections({customerId, fields})` (`lib/customers/lookup.ts:213-249`) persists it to `customers` with **no address verification**. `updateCustomerFromIntake` (`lib/customers/lookup.ts:142-191`) is the finish-time twin with the same gap. The map check that already knows an address is bogus lives in `lib/sms/verify-address.ts` (`verifyAuAddress` → `{outcome:'not_found'|'match'|'unavailable'}`).
- **P2 blurb** — `lib/sms/dialog.ts:138-139` ("Aussie trade contractor (electrical + plumbing)") and the fallback at `:412` ("We do electrical …"). The tenant's real trades are on `tenants.trades` (already threaded into the route as `tenant?.trades`, passed to the extractor at `route.ts:2102`).
- **P3 engagement** — `app/api/sms/inbound/route.ts`: adaptive debounce coalesces a burst (`~:1804`); `shouldEngageRoofing(prevState, latestInbound, followupPinActive, roofingOnly)` (`lib/sms/roofing-receptionist.ts:506-535`) decides roofing engagement off `latestInbound`. On a coalesced burst the "latest inbound" is the LAST message ("its colorbond"), not the roofing opener, so `looksLikeRoofingEnquiry` may miss.
- Pure receptionist modules: `lib/sms/roofing-receptionist.ts`, `roofing-intake.ts`, `painting-*`. Tests in `lib/sms/*.test.ts` (vitest). Live runner: `.scratch-audit/scenario-runner.mjs` (posts forged-signature webhooks to `quote-mate-rho.vercel.app`, reads the DB).

## Task (most important first)
1. **P1 — verification gate on remembered addresses.** Add a pure helper that, given the corrected profile fields plus the address-verification outcome, drops `address` (and a `suburb` that arrived in the same turn as the rejected address) when the address is `not_found`. Wire it into the `writeCustomerCorrections` trigger in the route (verify the corrected `address` with `verifyAuAddress` before persisting) and apply the same guard to `updateCustomerFromIntake`'s address/suburb. A `match`/`unavailable`/absent-address turn keeps today's behaviour (never block on an outage). Name/email are never gated.
2. **P2 — trades-aware greeting.** Derive the capability sentence from `tenant.trades` (map trade keys → customer-facing labels) and inject it into the dialog system prompt / fallback instead of the hardcoded "electrical + plumbing". A tenant with only electrical+plumbing reads exactly as before.
3. **P3 — roofing burst engages roofing.** Make `shouldEngageRoofing` see the WHOLE coalesced burst (or the opener), not just the last message, so a burst that contains a roofing enquiry engages the roofing receptionist. Prefer a pure change to the engagement input; do not weaken the cross-trade keyword routing.
4. **P4/P5 — log as accepted design** (question at the bare address step; `await_booking` treating any non-negative as a booking). Record the decision in this spec's Constraints; only implement if P1–P3 land with budget and the change is provably low-risk.

## Constraints
- Minimal, correct, general fixes — no new abstractions/flags/files beyond the spec + tests. No refactoring unrelated code. Delete scratch files created (keep `.scratch-audit/scenario-runner.mjs`, it is the eval gate).
- Pure logic stays in `lib/sms/*` / `lib/customers/*`; the route only wires. Money path tool-call-only. AU/NZ formatting; **no em dashes in customer-facing SMS**.
- Verification is a net, never a gate that blocks a lead: an `unavailable` map result must not stop a write or a reply.
- **P4 accepted-by-design**: at the bare `address` step a question re-asks for the address (re-reading the address is the natural next step); not changed.
- **P5 accepted-by-design**: `await_booking` treats any non-negative as a live lead (never drop a lead); not changed.
- Confirm before destructive/irreversible actions; do not discard the parallel-session in-progress work already on `main`.

## Acceptance criteria & gates
- **P1**: new unit tests — a `not_found` address ⇒ the persisted field set excludes `address` and the co-arriving `suburb`; a `match` ⇒ both persist; `unavailable`/no-address ⇒ unchanged behaviour; name/email always persist. Live: scenario A (refuse "45 Wimbledon Crescent Faketon") then inspect the `customers` row — `address`/`suburb` NOT updated to the rejected value.
- **P2**: unit test — the capability sentence for a `['roofing','painting']` tenant contains "roofing"/"painting" and not "electrical"; for `['electrical','plumbing']` it is unchanged. Live: scenario H "Hi" to Sparky lists roofing among the trades.
- **P3**: unit test — `shouldEngageRoofing` returns true for a coalesced burst whose opener is a roofing enquiry even when the last line ("its colorbond") is not; existing cross-trade routing tests stay green. Live: scenario E burst ends with `roofing_state` non-null (engaged), not a general-dialog reply pulling stale memory.
- **Gates each iteration**: `npx vitest run lib/sms lib/customers` green; `npx tsc --noEmit` clean; `/review` + `/code-review` no blocker/major findings; live `.scratch-audit/scenario-runner.mjs` re-run of A/E/H after deploy.

## Examples
<example>
Closest existing guard to imitate for P1 — `lib/sms/verify-address.ts` `screenConfirmAddress`: it calls `verifyAuAddress` and, on `not_found`, returns revised slots that DROP the bad address rather than storing it. P1 applies the same "not_found ⇒ don't keep it" rule to the customer-memory write.
</example>
<example>
P3 shape — `lib/sms/roofing-receptionist.ts:506-535` `shouldEngageRoofing`; the fix feeds it the coalesced burst text (as the route already concatenates inbounds for the general dialog at `route.ts:2083-2095`) instead of only the last message, mirroring how the general dialog already sees the whole burst.
</example>
