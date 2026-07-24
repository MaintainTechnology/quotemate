# Roofing SMS receptionist — B1–B9 from the live red-team evaluation

## Title
Stop the roofing receptionist quoting the wrong (old) address, unwinding a confirmed address, and mislabelling its state — the state-machine defects the S1–S10 eval surfaced.

## Goal
A re-run of `.scratch-audit/scenario-runner.mjs` S7/S8 shows a mid-gather new address (street+postcode) is re-confirmed and measured — never the previously-confirmed address (B1); S9 shows a stray/contradictory answer never resets a confirmed address (B4); S2 shows `roofing_state.last_step` matches the question the bot actually asked (B9). Why: the eval proved "price 12 Smith Street" quoted 670 London Road, a stray "flat no steep" reset the whole flow, and a fold left the state pointing at the wrong step.

## Role
Principal engineer. The roofing gather is a PURE, unit-tested state machine (lib/sms/roofing-receptionist.ts + roofing-intake.ts); the route only wires it. Money path tool-call-only; no em dashes in customer SMS.

## Context (grounded in code opened)
- Gather wiring — `roofing-receptionist.ts:577-631` (advanceRoofing step 5): per turn it tries, in order, `tryAddressFold` (311-338) → `shouldBailToDialog` (345-350) → `applyRoofingAnswer` → `crossStepFold` (356-403) → miss-budget→inspection.
- **B1 root cause** — `tryAddressFold:328`: `strong = slots.address_confirmed ? (cue || negatedAddr) : (streetOnAddr || cue)`. A CONFIRMED address only re-folds on an explicit ADDRESS_CUE/CORRECTION_CUE or a leading negation. "ok now can you price 12 Smith Street Bondi NSW 2026" has a street + postcode but no cue → not folded → the turn falls to the intent parser → miss-budget → intent 'unknown' → inspection route measures the OLD confirmed 670 London Road (S7/S8). The same-address guard at `:330` already blocks re-folding an identical restatement, so a DIFFERENT full address (street + postcode) is safe to fold without a cue.
- **B4 root cause** — a stray answer at a gather step that maps to nothing runs the miss path; at the `address`/`confirm_address` steps a miss re-asks the address (`:625`, `WRONG_BUILDING_REPROMPT`/`ADDRESS_RETRY`) — but the eval showed a confirmed address being reset by a later-step answer. Confirm and fix: a non-address gather step's miss must never clear `address_confirmed` or reset `address`.
- **B9 root cause** — after `tryAddressFold` re-folds an address (sets `address_confirmed:false`), advanceRoofing returns `nextRoofingStep(nextSlots)`; nextRoofingStep (roofing-intake.ts) returns `confirm_address` when an address is set but unconfirmed, so the ask step SHOULD be confirm_address. Verify the route persists `decision.step` (not the prior `last_step`) so a "yes" is processed at confirm_address, not the pre-fold step. If advanceRoofing already returns step confirm_address, B9 is a non-issue — confirm with a test.
- **B6** — an `inspection_required` measurement must present as an inspection (indicative range, "confirmed on site"), never a firm total, and the structure count in the SMS must match the measurement row. Composed in lib/sms/roofing-compose.ts (`buildRoofingReplyMessage`/`composeInspectionMessage`); check whether an unknown-intent inspection is rendering a firm-looking "$X / 2 structures".
- Live harness: `.scratch-audit/scenario-runner.mjs` (forged-sig webhook to quote-mate-rho.vercel.app, DB capture). Tests: lib/sms/*.test.ts (vitest).
- The parallel-session cross-step-intent work (tryAddressFold/crossStepFold/shouldBailToDialog) is already on main — extend it, do not break its tests.

## Task (most important first)
1. **B1** — in `tryAddressFold`, a DIFFERENT full address (street signal AND a postcode) folds even when `address_confirmed`, without a cue. Keep the same-address guard (a bare restatement of the confirmed address never folds). Result: "price 12 Smith Street Bondi NSW 2026" at any gather step → re-confirm 12 Smith Street, never measure 670 London Road.
2. **B4** — a stray/contradictory answer at a non-address gather step must not clear `address_confirmed` or reset `address`. Add the guard/test that pins it.
3. **B9** — pin (test) that after a mid-flow address fold the returned step is `confirm_address` and the route persists that step, so a "yes" confirms the new address.
4. **B6** — an unknown-intent / inspection-routed measurement never shows a firm total; the SMS structure count matches the measurement. Fix the compose path if it doesn't.
5. **B2 (bounded), B7, B8** — log the decision: B2 is bounded (out-of-order material/pitch DO fold via crossStepFold; unmet intent routes to inspection by design) — only fix if B1/B6 leave a real gap. B7 (question at bare address step) and B8 (await_booking non-negative = book) are accepted-by-design; record rationale.
6. **B3, B5** — general-dialog handoff (B3) and debounce timing (B5) are NOT cleanly unit-testable here; they need the live scenario-runner gate. Scope them to a follow-up unless a minimal deterministic fix is provable (e.g. B3: on passthrough from an ACTIVE roofing gather, re-ask the current roofing question rather than handing to the LLM name-gather).

## Constraints
- Minimal, correct, general fixes; no new files/abstractions beyond spec + tests; no unrelated refactors. Keep .scratch-audit/scenario-runner.mjs. Delete other scratch files.
- Do not break the parallel-session cross-step tests already green on main. Verification is a net not a gate (a map outage never blocks). AU/NZ formatting; no em dashes in customer SMS.

## Acceptance criteria & gates
- **B1**: unit — `tryAddressFold("ok now price 12 Smith Street Bondi NSW 2026", {address:'670 London Rd…', address_confirmed:true})` returns slots with address="12 Smith Street…", address_confirmed=false; a cue-less bare restatement of the SAME confirmed address returns null; a street-without-postcode restatement returns null. advanceRoofing at the `intent` step with that message → action 'ask', step 'confirm_address', slots.address the NEW address. Live: S7/S8 re-run → the SMS names the NEW address, and no measurement row is created for the OLD address after the change.
- **B4**: unit — at `pitch`/`material`/`intent` a junk answer that misses never returns slots with `address_confirmed` cleared or `address` nulled. Live: S9 → does not reset to "What's the property address?".
- **B9**: unit — the fold decision's step is `confirm_address`. Live: S2 → final state confirm_address (not material) while asking the address yes/no.
- **B6**: unit — an inspection-routed / unknown-intent quote message contains the inspection framing (indicative / confirmed on site) and the correct structure count, not a bare firm total.
- **Gates each iteration**: `npx vitest run lib/sms lib/customers` green; `npx tsc --noEmit` clean; /review + /code-review no blocker/major; live scenario-runner re-run of S7/S8 (B1), S9 (B4), S2 (B9) after deploy.

## Examples
<example>
B1 mirrors the existing 'quoted'-step reopen at roofing-receptionist.ts:554 — `const newAddress = !!extractStreetAddress(inbound) && !!parsePostcode(inbound)` — apply the SAME street+postcode "different full address" signal inside tryAddressFold's confirmed branch, guarded by the existing same-address `normAddr` check at :330.
</example>
<example>
B9/B4 closest code — nextRoofingStep (roofing-intake.ts): address set + not address_confirmed → returns { step:'confirm_address', question:'Just to confirm, the property is "…". Is that right?' }. The fold sets address_confirmed:false, so the returned step is already confirm_address; the risk is the ROUTE persisting the old last_step — the tests pin the pure decision, and route.ts:604 persists decision.step on 'ask'.
</example>
