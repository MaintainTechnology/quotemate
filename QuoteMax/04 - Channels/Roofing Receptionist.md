---
title: Roofing Receptionist
type: channel
area: channel
tags: [quotemax, sms, roofing, receptionist, state-machine, grounding]
status: draft
updated: 2026-09-04
sources:
  - quotemate-automation/lib/sms/roofing-receptionist.ts
  - quotemate-automation/lib/sms/roofing-intake.ts
  - quotemate-automation/lib/sms/roofing-compose.ts
  - quotemate-automation/lib/sms/roofing-measure-dispatch.ts
  - quotemate-automation/lib/sms/verify-address.ts
  - quotemate-automation/lib/sms/llm-receptionist.ts
  - quotemate-automation/app/api/sms/inbound/route.ts
---

# Roofing Receptionist

The roofing SMS receptionist is the second of the [[The Four Pipelines]] — a self-contained
measure-and-price flow that never touches the electrical/plumbing intake → estimate chain.
It gathers the same brief the dashboard Roofing tab collects (address, intent, material,
pitch, optional year built), runs `measureAndPriceRoofs`, and texts a priced quote plus a
`/q/roof/[token]` link.

This note covers the **decision layer**: who owns which module, how the receptionist decides
to engage, what the turn decision union is, and the guards the route bolts on top.
The turn-by-turn walk-through with the state keys lives in [[Roofing SMS Flow Steps]].

## Module map

| File | Purity | Owns |
|---|---|---|
| `quotemate-automation/lib/sms/roofing-intake.ts` (812 lines) | pure | `RoofingSlots`, `RoofingStep`, the plain-language mappers, `looksLikeRoofingEnquiry`, `isStopRequest`, `isAffirmative`/`isNegative`, `nextRoofingStep`, `toRoofingRequest` |
| `quotemate-automation/lib/sms/roofing-receptionist.ts` (1114 lines) | pure | `advanceRoofing` (the state machine), `shouldEngageRoofing`, `isActiveRoofingFlow`, structure-pick parsers, staleness expiry |
| `quotemate-automation/lib/sms/roofing-compose.ts` (462 lines) | pure | every outbound wording, `narrowQuoteToStructures`, `applySolarToTiers` |
| `quotemate-automation/lib/sms/verify-address.ts` (800 lines) | I/O | Google Address Validation + Geoscape map check, the read-back wordings, the three address budgets. Shared with [[Painting Receptionist]] |
| `quotemate-automation/lib/sms/roofing-measure-dispatch.ts` (216 lines) | I/O | measure → save `roofing_measurements` → roof-photo MMS → confirm SMS. Shared with the voice handover |
| `quotemate-automation/lib/sms/roofing-notify.ts` | I/O | the tradie alert (`quote_sent`, `inspection_booked`, `question_asked`) |
| `quotemate-automation/app/api/sms/inbound/route.ts:459-1197` | I/O | `handleRoofingTurn` — all persistence, sends, Stripe-free money-adjacent writes |

`advanceRoofing` and everything in `roofing-intake.ts` are pure by design so the conversation
logic is unit-testable — see `roofing-receptionist.test.ts` (659 lines), `roofing-stall.test.ts`
(1018 lines), `confirm-address-loop.test.ts` (657 lines).

## Where it sits in the inbound route

`handleRoofingTurn` is called from `app/api/sms/inbound/route.ts:2597`, inside the webhook's
`after()` block, and returns a boolean. `true` means "I handled this turn" and the route
returns at `:2638` — **before** `extractSlots` at `:2824`. So on a turn the roofing
receptionist claims, the general electrical/plumbing dialog never runs.

Ordering inside `after()`:

1. global opt-out check (`:2522`)
2. follow-up pin read (`:2564`)
3. **roofing** (`:2592-2650`) — gated on `tenantHasRoofingTrade(tenant.trades)` (`lib/roofing/tenant.ts:10`), or `SMS_ROOFING_ENABLED` when the inbound maps to no tenant
4. **painting** (`:2676`) — same shape, `tenantHasFeature(tenant.trades, 'painting')`
5. product-pick capture, then `extractSlots` → the general dialog

Roofing running first is the structural cause of the painting-hijack blocker below.

Both receptionists are skipped entirely when `inflightContinuation` is true (`:2410`), the
resumed-lock path.

## shouldEngageRoofing — verified

`quotemate-automation/lib/sms/roofing-receptionist.ts:1046-1114`.

⚠ **Drift.** The repo `CLAUDE.md` cites this function at `roofing-receptionist.ts:968` and
describes it as returning true "on `isActiveRoofingFlow(prev)` alone". Both are stale: the
function starts at **line 1046**, and three gates have been added since. The *shape* of the
complaint still holds — the resume arm does not read the inbound text — but the guards
around it are real and worth knowing.

Signature:

```
shouldEngageRoofing(
  prev: RoofingConversationState | null,
  inbound: string,
  followupPinActive: boolean,
  roofingOnly = false,
  generalMidGather = false,
): boolean
```

Arms, in order:

| # | Condition | Result | Line |
|---|---|---|---|
| 0 | `prev.declined_trades` includes `'roofing'` | `false`, unconditionally | :1058 |
| 1 | `isActiveRoofingFlow(prev) && !followupPinActive` | `true` — **the inbound text is never read** | :1059 |
| 2 | `!generalMidGather && looksLikeRoofingEnquiry(inbound)` | `true` | :1093 |
| 3 | `roofingOnly && !followupPinActive` | `true` — single-trade roofing tenant needs no keyword | :1114 |

Arm 0 exists because the refusal itself carries the keyword: "no I don't want a roofer"
re-opened roofing on 2026-07-25 (QM Sparky). `declined_trades` is written only by the LLM
receptionist and carried across every persist by the `merged` shape at `route.ts:700-708`.

Arm 1 is the capture behaviour: **once a roofing thread is open, every subsequent turn is
routed to `advanceRoofing` regardless of what the customer wrote.** Escaping is
`advanceRoofing`'s job, not the gate's — it returns `passthrough` for a topic switch, an
interrupt, a question, or a named other trade (see *Escape hatches* below).

Arm 2's `generalMidGather` gate (from `generalDialogIsMidGather`,
`lib/sms/general-gather.ts:78`) closes the 2026-07-31 hijack class: the general dialog had
gathered `count=16 / room=patio / job_type=downlights`, asked for the ceiling type, and the
answer "it's a 125mm insulated panel roofing" substring-matched `'roofing'` in
`ROOFING_KEYWORDS`. The comment at `:1063-1091` states the accepted trade-off explicitly — a
customer mid-electrical-gather who genuinely adds "and quote my roof" now stays with the
general dialog.

Arm 3 exists because a roofing-only tenant has nothing to route to. "Bills roofing"
(`trades = ['roofing']`) received "test from owner" and the general dialog started an
electrical intake. `tenantIsRoofingOnly` is at `lib/roofing/tenant.ts:22`.

## isActiveRoofingFlow — verified

`quotemate-automation/lib/sms/roofing-receptionist.ts:1029-1033`. Three lines:

```ts
if (!prev || !prev.slots) return false
const step = prev.last_step ?? null
return step !== null && step !== 'closed'
```

So *every* non-null step is "active", including the terminal-ish ones: `quoted`,
`await_booking`, `confirm_roof`. That is deliberate — a warm `quoted` thread must still catch
"give me 2 and 3" — but it is why the capture window is as wide as it is.

Two functions close a flow from outside:

- `expireIdleRoofingState(prev, idleMs)` (`:985`) — `ROOFING_STALE_IDLE_MS` is **1 hour**
  (`:954`). Only steps in `ROOFING_STALE_REPLAY_STEPS` (`:963`) expire: `confirm_roof`,
  `quoted`, and the whole mid-gather set. `await_booking` is deliberately **excluded** so a
  late "yes book it" still books.
- `closeStaleRoofingState(prev)` (`:1011`) — called when the tenant turns roofing off
  mid-thread (`route.ts:2646`) and on global opt-out (`route.ts:2538`).

Both preserve `declined_trades` across the close.

## The turn decision union

`RoofingTurnDecision` (`roofing-receptionist.ts:102-122`) — what `advanceRoofing` returns and
what the route switches on:

| Action | Meaning | Route handler |
|---|---|---|
| `cancel` | stop / opt-out, checked first at any step | `route.ts:815` |
| `ask` | next question (+ optional `handoff: true`) | `route.ts:833` |
| `measure` | brief complete → run the pipeline | `route.ts:1113` |
| `inspection` | brief forces a site visit | `route.ts:1098` (brief-routed) / `:1113` (measured) |
| `send_saved` | customer confirmed → serve the saved measurement | `route.ts:930` |
| `reconfirm` | reply to the roof photo was unclear → re-ask | `route.ts:930` |
| `booking` | reply to "shall we book the inspection?" | `route.ts:820` |
| `passthrough` | hand the turn back to the general dialog (+ optional `close`) | `route.ts:799` |

`nextRoofingConversationState(decision)` (`:927`) is the pure mapping decision → persisted
step. The route overrides it where it owns extra state (`pending_quote_token`,
`pending_structure_count`).

## LLM conversation, deterministic money

⚠ **Drift.** `quotemate-automation/lib/sms/model.ts:16-19` still says the roofing/painting
LLM layer is "default OFF". It is **default ON**: `llmReceptionistEnabled`
(`lib/sms/llm-receptionist.ts:104-110`) returns `true` for an unset
`SMS_LLM_RECEPTIONIST_ENABLED`. `0`/`false`/`off`/`no` is the kill switch; anything else is a
comma-separated tenant-id allow-list. `docs/strategy.md` v17 and the repo `CLAUDE.md` have
this right; `model.ts`'s header comment does not.

At `route.ts:522`:

```
const useLlm = !!args.tenantFacts && llmReceptionistEnabled(tenantId)
const turn = useLlm ? await roofingTurnViaLlm({...}) : null
let decision = turn ? turn.decision : advanceRoofing(prevState, decisionInput)
```

- Model: `claude-sonnet-5`, `maxOutputTokens: 8192` explicitly (`lib/sms/model.ts:31,57` —
  the pinned `@ai-sdk/anthropic@3.0.71` has no capability entry for this id and would
  otherwise substitute 4096, which Sonnet 5's adaptive thinking eats into). See
  [[Model and Prompt Inventory]].
- `tenantFacts` is required, so a **tenant-less inbound always runs the deterministic path**.
- `roofingTurnViaLlm` (`llm-receptionist.ts:992`) returns a `RoofingTurnDecision` — the model
  picks a *tool*, not words on the money path. Any throw, timeout, bad shape or grounding
  violation falls back to `advanceRoofing` **for that turn only** (`fallback:` at `:1015`).
- `assertGroundedReply` (`llm-receptionist.ts:291`, called `:962`) discards any reply text
  that states a price, area, structure count, measured address, quote link or booking
  confirmation no tool produced. See [[Grounding and Safe Replies]].
- `settleRoofing` (`:1060`) re-imposes the deterministic readiness check: once
  `nextRoofingStep` says `ready`, the job is priced on this turn whatever the model wanted to
  say (four of ten measured scenarios ended a turn behind without it).

## Route-level guards over the model

Three of them, all in `handleRoofingTurn`, all documented as responses to live incidents:

1. **Re-measure guard** (`route.ts:545-583`). Keyed on *same property*, not `last_step`. If
   the LLM returns `measure`/`inspection` while `pending_quote_token` is set and the target
   address normalises equal to the measured one, the deterministic decision wins. Live
   2026-08-07 (QM Sparky, 12 Smith St): four `roofing_measurements` rows and four quote SMS
   for one property because the model answered "Are you doing roofing?" by measuring.
   *Deciding to spend is not the model's decision.*
2. **Rejection-consume guard** (`route.ts:585-673`). Keyed on the **transcript**
   (`lastOutboundAskedAddress`, `verify-address.ts:512`), not on `last_step` — on the
   incident state the read-back went out with `last_step` at `'closed'`, so every step-keyed
   consumer was dead code. Forces `consumeAddressRejection` when the customer rejected the
   read-back and the budget did not move.
3. **Repeat backstop** (`route.ts:677-690`). `dedupeConsecutiveReply` prefixes rather than
   drops a byte-identical repeat, and logs `console.error`. It is the visibility net, not the
   fix.

## Escape hatches — how a customer gets out of a roofing thread

`advanceRoofing` returns `passthrough` (route returns `false`, the general dialog handles the
turn) in these cases:

| Trigger | Function | Line | Closes the gather? |
|---|---|---|---|
| Customer names another trade ("electrician", "downlights" with no water context) | `namesOtherTrade` | `roofing-intake.ts:165` | No — one turn only |
| Topic switch ("also", "another", "one more thing") | `shouldBailToDialog` → `TOPIC_SWITCH` | `roofing-receptionist.ts:341,412` | **Yes** (`close: true`) |
| Interrupt ("wait", "hold on") off the address steps | `INTERRUPT` | `:343` | No |
| A question (`?` or a `QUESTION_LEAD` word) off the address steps | `QUESTION_LEAD` | `:345` | No |
| Warm `quoted` thread, message is not a pick / new address / new job | arm (3.5) | `:651-720` | **Yes** — warm window ends |

`namesOtherTrade` refuses to fire on any message containing a roof word (`:177`), and the
`SOFT_OTHER_TRADE` list (downlight/GPO/switchboard/ceiling fan) only counts as a switch when
`ROOF_PROBLEM_CONTEXT` (water/leak/drip/stain/damp) is absent — "water coming through around
the downlights" stays roofing.

**Invariant:** a mid-gather bail MUST NOT close the state, because closing discards the
confirmed address and everything else gathered; only a genuine topic switch or a warm
`quoted` thread closes (`route.ts:799-812`).

## Known blockers

Each of these is pointed at code that is live today. Where a documented blocker has since
been fixed, that is said too.

### 1. Stop-word false positives cancel a live thread

`isStopRequest` (`roofing-intake.ts:504`) is checked **first on every turn**
(`roofing-receptionist.ts:568-570`), and `STOP_RE` (`:495`) matches its vocabulary anywhere in
the message with plain `\b` boundaries. The only carve-out is `STOP_OUTCOME` (`:501`), which
protects `stop|end` within three words of `leak|drip|water|rain`.

Verified against the live regexes — all of these cancel the conversation and send
`composeCancelMessage`:

| Message | `isStopRequest` |
|---|---|
| "never mind the shed just the house" | true |
| "forget it I will send the address again" | true |
| "can you stop by tuesday" | true |
| "I had to cancel my old roofer" | true |
| "the gutters quit working" | true |
| "not interested in tiles, colorbond please" | true |
| "12 Cancel St Bondi 2026" | true |
| "when will you stop the leak" | false (carve-out works) |

The last row of that table is a second-order failure: `extractStreetAddress`
(`roofing-intake.ts:530`) itself returns `null` when `isStopRequest(t)`, so a street name
containing a stop word cannot be captured as an address at all.

### 2. `y`, `ya` and 👍 are not accepted as yes

`AFFIRM` (`roofing-intake.ts:433`):

```
/\b(yes|yep|yeah|yup|correct|right|that'?s right|that'?s it|confirmed|sure|ok|okay|👍)\b/
```

- `y` and `ya` are simply absent. Verified: `isAffirmative('y') === false`,
  `isAffirmative('ya') === false`.
- **`👍` is in the alternation but can never match.** The whole group is wrapped in
  `\b(...)\b`, and `👍` is not a word character, so no word boundary exists on either side of
  it. Verified: `isAffirmative('👍') === false`. The token is decorative.

Consequence at `confirm_roof` (`roofing-receptionist.ts:634`): a bare "👍" is neither
affirmative, a pick, nor a roofing enquiry, so it falls to `reconfirm` and the customer is
asked the same question again. At `confirm_address` (`roofing-intake.ts:641`) it confirms
nothing and burns a miss.

`deEmphasise` (`:468`) does fix the elongation case — "Noooo" now parses as a deny, after the
2026-08-07 incident where it parsed as neither and the already-`true` `address_confirmed`
sent `nextRoofingStep` straight to `ready`.

### 3. AU idiom "no worries" parses as a rejection

`DENY` (`roofing-intake.ts:434`) matches bare `\bno\b`. Verified: `isNegative('no worries')`
and `isNegative('no dramas')` are both **true**.

Three consequences, all reachable:

- At `confirm_roof` (`roofing-receptionist.ts:588-597`) `isNegative` wipes `address`,
  `postcode`, `state` and `address_confirmed`, then re-asks for the address — a customer
  saying "no worries" to "is this your roof?" loses the whole measurement.
- At `confirm_address` (`roofing-intake.ts:641-651`) the same clear happens.
- `isGreetingOnly` (`:184`) short-circuits to `false` when `isNegative` is true, so the
  free-re-ask path that exists precisely to avoid burning budget on a pleasantry does not
  cover it.

The comment at `roofing-intake.ts:180-183` records that `ok`/`sure`/`cool`/`no worries` were
deliberately excluded from `GREETING_ONLY` because "they are AFFIRM tokens" — but "no
worries" is not in `AFFIRM`, and it *is* in `DENY`. The exclusion note and the vocabulary
disagree.

### 4. Multi-pick truncation survives in the long-sentence case

The obvious case is fixed: at `confirm_roof` the receptionist runs `parseStructureFollowup`
**before** `parseStructureChoice` (`roofing-receptionist.ts:621-628`), specifically because
the single-pick digit regex grabbed the first number and silently narrowed "2 and 3" to
structure 2 — a money bug of the same class as the 2026-07-22 `included_indices` fix.

The residue: `parseStructureFollowup` (`:214`) only returns a multi-pick when the message
either carries a `STRUCTURE_CUE` (`:194`) or is a "pure pick" — nothing left after stripping
`PICK_TOKENS` and `FOLLOWUP_FILLER` (`:187-192`). Any word outside that filler list defeats
the gate, and the message then falls to `parseStructureChoice`, whose digit regex at `:177`
is `t.match(/\b#?(\d{1,2})\b/)` — **first match wins**.

So "can you do 1 and 2 please for me mate" (nine words, "mate" is not filler, no structure
cue) returns `null` from the multi parser, then `[1]` from the single parser, and the
customer is quoted one building while believing they asked for two. Widening `FOLLOWUP_FILLER`
is a per-word patch of the same shape as the four `roofing-intake.ts` vocabulary patches
recorded at `:1071-1074`.

### 5. Roofing trigger words still take painting enquiries

`ROOFING_KEYWORDS` (`roofing-intake.ts:107-126`) includes `'gutter'`, `'downpipe'`,
`'eaves'`, `'fascia'` — all shared with painting.

The narrow case **is** fixed: `PAINT_ENQUIRY` (`:218`) plus the `ROOF_SPECIFIC` exclusion
(`:219`) at `:246` means an explicit paint word with no roof-specific term returns `false`, so
"quote painting my gutters, eaves and fascia" no longer runs a roofing measure.

What remains:

- A message that names the shared parts with **no paint word** — "how much to replace my
  gutters and fascia?" — matches `ROOFING_KEYWORDS`, and on a tenant holding both trades
  roofing runs first (`route.ts:2592` vs `:2676`) and returns at `:2638`, so
  `handlePaintingTurn` never sees the turn.
- Once engaged, arm 1 of `shouldEngageRoofing` holds the thread for every later message.
- The second-line defence added 2026-08-07 (`roofing-receptionist.ts:686-700`,
  `correctedAwayFromRoofing`) only applies on a warm `quoted` thread, not mid-gather.

### 6. The address-correction loop is bounded — except through `tryAddressFold`

Three budgets now exist, all capped at `MAX_ADDRESS_VERIFY_REJECTS = 2`
(`verify-address.ts:98`):

| Counter | Event | Consumer |
|---|---|---|
| `addr_verify_misses` | the **map** could not find the address | `screenConfirmAddress` (`:672`) |
| `addr_confirm_rejects` | the **customer** said no to the read-back | `consumeAddressRejection` (`:602`) |
| `addr_confirm_misses` | the reply was neither yes nor no | `consumeAddressMiss` (`:641`) |

Each ends at `step: 'await_booking'`, `handoff: true`, an `addressHandoffReply` and a tradie
notify. That is a real fix for the 2026-08-07 four-identical-read-backs incident.

⚠ The hole: in `advanceRoofing`, `tryAddressFold` is tried **first** (`:744`) and
`consumeAddressRejection` only on the `else if` (`:747`). `tryAddressFold` (`:369`) fires on a
leading negation over a real street address (`negatedAddr`, `:394`) and on any different full
address, and it ends with `delete s.misses` (`:407`). So a rejection that *carries a
replacement address* moves **no counter at all**.

Loop shape: customer types A → Google corrects to B → read-back names B → customer replies
"no, it's A" → `tryAddressFold` folds A and clears the counters → `screenConfirmAddress`
re-verifies (A ≠ `addr_verified` B, so no cache hit) → Google corrects to B again → identical
read-back. Nothing in the cycle increments `addr_confirm_rejects`, `addr_verify_misses` or
`addr_confirm_misses`, because `planConfirmAddress` returns `kind: 'confirm'` every time and
only the `'reject'` arm counts. The `dedupeConsecutiveReply` backstop (`route.ts:679`) logs
it but still sends.

### 7. Both map providers are called inline with no timeout

`screenConfirmAddress` (`verify-address.ts:672`) is awaited **inside the SMS turn** at
`route.ts:862`, before the reply is composed. It calls `verifyAuAddress` (`:115`), which
awaits Google Address Validation (`:166`) and then Geoscape (`:224`); a `not_found` adds a
third call to `suggestAuAddress` (`:314`).

All three use the same default `fetchImpl`:

```ts
opts.fetchImpl ?? ((u: RequestInfo | URL, init?: RequestInit) => fetch(u, init))
```

No `AbortSignal`, no `signal: AbortSignal.timeout(...)`, no wall-clock guard anywhere in the
module. Each is individually try/caught so a *rejection* degrades gracefully — but a hung
socket does not reject, it hangs, and it hangs inside a webhook turn that already competes
with the 60-second inflight lock (see [[Known Debt Register]]). The failure mode is a second
webhook taking the lock and replying concurrently, which is the duplicate/out-of-order-reply
class.

## Open questions

- `parseStructureFollowup` is called at `confirm_roof` (`:621`) without `alreadyServed`, and
  at `quoted` (`:655`) with it. Intentional (nothing has been served yet at `confirm_roof`),
  but worth an assertion.
- `nextRoofingStep` checks `slots.material === 'cement_sheet'` / `'unknown'` *before* the
  `!slots.material && slots.metal_hint` branch (`roofing-intake.ts:756-770`). Reachable
  ordering looks correct but the guard reads as accidental.
- No note yet on how `pipeline_traces` covers a roofing turn — see
  [[Observability and Tracing]].

## Related

- [[Roofing SMS Flow Steps]]
- [[SMS Inbound Route]]
- [[SMS Channel Overview]]
- [[LLM Receptionist]]
- [[Grounding and Safe Replies]]
- [[Painting Receptionist]]
- [[Roofing]]
- [[Known Debt Register]]
