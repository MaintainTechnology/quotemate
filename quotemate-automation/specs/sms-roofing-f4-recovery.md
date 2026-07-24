# Roofing SMS receptionist — F4 rapid-burst address recovery net

## Title
Recover a rapid-burst address dropped by the conversation-start leader/debounce race, without re-harvesting a rejected or unfindable address.

## Goal
A live re-run of `.scratch-audit/scenario-runner.mjs` F4a/F4b/F4c (`__BURST__ "can you do my roof|670 London Road Chandler QLD 4155|thanks heaps mate"`) advances past the `address` step and reads back 670 London Rd, instead of "Sorry, I didn't catch a property address". Why: the address is the money-path entry and a rapid burst is a common real pattern.

## Role
Principal engineer. The roofing turn-input selection is a PURE, unit-tested function; the route only wires it. The deeper webhook/leader-election + debounce race (60s inflight-lock debt) is OUT OF SCOPE and must not be touched — the shared SMS route carries all eight trades.

## Context (grounded in code opened)
- `roofingTurnInput` (`lib/sms/roofing-receptionist.ts:455`) picks the `decision` input; `latestInboundBurst` (:432) returns inbounds since the last outbound. Live F4: the burst-race left "670 London Rd" BEHIND the leader's racy "what's the address?" ask, so `latestInboundBurst` on the next turn is just `["thanks heaps mate"]` and the address is dropped (the already-shipped burst-at-address-step fix only helps when the burst still contains it).
- `extractStreetAddress` (`roofing-intake.ts:356`) — a street-number test, already imported here. Read-back wordings from `confirmAddressQuestion` (`verify-address.ts:331-334`): "Just to confirm, the property is" / "The closest address I can find is". Not-found wording from `addressNotFoundReply` (:337): "Sorry, I can't find …".

## Task
1. Add `recoverDroppedAddress(turns)`: newest-first, return the most recent inbound with an `extractStreetAddress` match whose subsequent outbounds contain NO `ADDRESS_READ_BACK` match; else null.
2. `ADDRESS_READ_BACK` matches both confirm read-backs AND the not-found reply (`can't find`), so an address the customer rejected OR the map refused is never re-harvested.
3. In `roofingTurnInput`, when `awaitingAddress` (`address`/`confirm_address`) and the chosen `decision` has no address, replace it with `recoverDroppedAddress(turns)` when non-null.

## Constraints
- Pure roofing layer only; NO route/lock/debounce changes; reuse `extractStreetAddress` + the read-back/not-found wordings; no em dashes in customer SMS; AU/NZ; net-not-gate.

## Acceptance criteria & gates
- Unit: recovery returns 670 for the F4 burst-then-filler; returns null when the address was read back then rejected; returns null when the address got a "can't find" reply; never fires at a non-address step (confirm_roof decision stays last-line). `npx vitest run lib/sms` green; `npx tsc --noEmit` clean; /review + /code-review no blocker/major. Live: F4a/b/c reach `confirm_address` on 670; no regression to F15a/b/c, F7, A1/A2.

## Examples
<example>
Recover: `[in "can you do my roof", in "670 London Road…", out "…What's the property address?", in "thanks heaps mate"]` at step 'address' → decision "670 London Road…" (the ask is not a read-back).
</example>
<example>
Do NOT recover (rejected): `[in "670…", out 'Just to confirm, the property is "670…"', in "no", out "…What's the property address?", in "hmm"]` → null (670 was read back).
</example>
<example>
Do NOT recover (not-found): `[in "123 Fakey St 9999", out 'Sorry, I can\'t find "123 Fakey St 9999"…', in "one sec"]` → null (map refused it).
</example>
