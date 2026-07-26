# LLM-driven SMS roofing + painting receptionists (Sonnet 5), flag-gated

## Goal

Make the roofing and painting SMS receptionists **converse** — greetings, questions,
refusals, trade switches — by putting `claude-sonnet-5` in charge of every
customer-facing turn, while every dollar figure, area, structure count, measured
address, quote link and booking confirmation continues to come **only** from the
existing deterministic modules. Single measurable outcome: with
`SMS_LLM_RECEPTIONIST_ENABLED` **ON**, both live failure transcripts behave
correctly and scenarios A1/A2/A3/A5 produce **identical prices** to the pre-change
baseline; with the flag **OFF**, behaviour is byte-identical to today and all 986
`lib/sms` + `lib/customers` tests stay green.

Why: today a greeting books an inspection, a refusal reopens roofing, and a trade
switch is vetoed by a keyword — because the receptionists are regex state machines
with zero LLM (`lib/sms/model.ts` says so explicitly).

## Role

Principal engineer on this repo. Proactive on reversible edits and tests; act
directly. Confirm before anything destructive. Reuse the existing deterministic
modules as tools — do not reimplement or edit them.

## Context (grounded — files opened this session)

**The failing machine.**
`app/api/sms/inbound/route.ts:417` `handleRoofingTurn` and `:887`
`handlePaintingTurn` do all I/O. Both call a pure decision function and then
switch on its action:
- `lib/sms/roofing-receptionist.ts:525` `advanceRoofing(prev, inbound)` →
  `RoofingTurnDecision` (`:73`) = `ask | measure | inspection | send_saved |
  reconfirm | cancel | booking | passthrough`.
- `lib/sms/painting-receptionist.ts:124` `advancePainting(prev, inbound)` →
  `PaintingTurnDecision` (`:68`) = `offer_form | await_form | ask | estimate |
  inspection | cancel | booking | passthrough`.

**The four root causes, at their exact lines.**
1. `roofing-receptionist.ts:538-547` — at `last_step === 'await_booking'` the
   decision is `confirmed: !isNegative(inbound)`. A greeting is not negative, so
   `"Hi there"` books an inspection.
2. `roofing-intake.ts:197` `looksLikeRoofingEnquiry` keyword-matches `"roofer"`
   with no negation model, so `"No i dont want a roofer"` reopens roofing
   (`shouldEngageRoofing`, `roofing-receptionist.ts:933`).
3. `roofing-intake.ts:133-140` `namesOtherTrade` returns **false** when the text
   also contains a roof word (`:138` veto). `"Not roofer i want electrical work"`
   contains both, so the electrical switch is blocked and the message falls to the
   address parser → `"Sorry, I didn't catch a property address there"`.
4. Nothing on `RoofingConversationState` (`:47`) records a refusal, so `"Hey!"`
   re-asks the roofing address a third time.

**The deterministic machinery to call as tools (never edit).**
- `lib/sms/verify-address.ts:387` `screenConfirmAddress`, `:102` `verifyAuAddress`
  (Google + Geoscape, wrong-parcel guard, unit-address fix).
- `lib/roofing/measure.ts` `measureAndPriceRoofs`, `lib/roofing/pricing.ts`
  `priceMultiRoof`, driven by `lib/sms/roofing-measure-dispatch.ts:89`
  `measureAndDispatchRoofing`.
- `lib/sms/roofing-compose.ts:183` `buildRoofingReplyMessage`, `:219`
  `composeConfirmMessage`, `:314` `narrowQuoteToStructures`, `:293`
  `composeBookingMessage`, `:241` `composeCancelMessage`.
- `lib/painting/pricing.ts` via `lib/sms/painting-estimate-dispatch.ts`
  `estimateAndDispatchPainting`; `lib/sms/painting-compose.ts`.
- `notifyRoofingTradie` via the route's `notifyTradie` closure
  (`route.ts:497-533`).

**The LLM call pattern to mirror.** `lib/sms/dialog.ts:1798-1889`: `withRetry`
(3 attempts, 1s base) around `generateObject({ model: anthropic(
SMS_RECEPTIONIST_MODEL), maxOutputTokens: SMS_RECEPTIONIST_MAX_TOKENS, schema,
system: [{ role:'system', content, providerOptions:{ anthropic:{ cacheControl:{
type:'ephemeral' }}}}], messages:[{role:'user', …}] })`. Model consts in
`lib/sms/model.ts` (`claude-sonnet-5`, 8192).

**Tenant facts available.** `lib/tenant/lookup.ts:13` `TenantRow`:
`business_name`, `owner_first_name`, `trades[]`, `state`, `status`,
`twilio_sms_number`. `owner_mobile` / `owner_email` exist on the row and are
**forbidden** in any customer-facing reply.

**Baseline (measured this session):** `npx vitest run lib/sms lib/customers` →
51 files, **986 tests passed**.

**Live verification harnesses (keep, do not delete):**
`.scratch-audit/scenario-runner.mjs` (20-scenario F1-F15 / A1-A5 suite, drives
`https://quote-mate-rho.vercel.app/api/sms/inbound` with a real Twilio
signature and reads Supabase state) and `.scratch-audit/repro-screenshot.mjs`
(replays transcript A against QM Sparky `+61468048422`).

## Task

1. **Reproduce first.** Run `.scratch-audit/repro-screenshot.mjs` against QM
   Sparky and capture, per turn: the reply text, `roofing_state.last_step`,
   `roofing_state.slots.address`, `painting_state.last_step`, and which handler
   produced the reply. Record the observed failures before writing any code. If
   the live endpoint is unreachable, say so explicitly and drive the same
   transcripts through the mocked-model path instead — never report a live PASS
   that was not observed.

2. **Add the flag** (`lib/sms/llm-receptionist.ts`):
   `llmReceptionistEnabled(tenantId: string | null): boolean` reading
   `SMS_LLM_RECEPTIONIST_ENABLED`. Unset / `0` / empty → **false**. `1` → all
   tenants. Anything else → a comma-separated allow-list of tenant ids; a
   `null` tenantId matches only the `1` form. One env var, one helper.

3. **Add the LLM turn** (`lib/sms/llm-receptionist.ts`). One `generateObject`
   call per turn returning a `TurnDecision`:
   - `tool`: `'ask_for_detail' | 'verify_address' | 'measure_and_price_roof' |
     'price_painting' | 'send_saved_quote' | 'book_inspection' |
     'answer_business_question' | 'deflect_and_notify' | 'hand_to_other_trade' |
     'end_conversation'`.
   - `slots`: the trade's slot patch the customer just supplied (roofing:
     address / postcode / state / intent / material / pitch / commercial /
     year_built; painting: the `PaintingSlots` set).
   - `reply_to_send`: string, max 320 chars — **only** used for the
     conversational tools (`ask_for_detail`, `answer_business_question`,
     `hand_to_other_trade`, `end_conversation`). Ignored for every tool whose
     message a deterministic composer owns.
   - `booking_consent`: `'yes' | 'no' | 'unclear'` (only meaningful at
     `await_booking`).
   - `declined_trade`: the trade the customer just refused, or null.
   - `structure_choices`: 1-based indices, `'all'`, or null.
   The prompt is given: the tenant's grounded fact block, `trades[]`, the current
   slots, the step the machine is waiting on, the slots still missing, the
   declined-trade list, and the full SMS history.

4. **Map the decision onto the existing unions** so the route's I/O layer is
   unchanged: `mapRoofingLlmDecision(decision, prev) → RoofingTurnDecision` and
   `mapPaintingLlmDecision(...) → PaintingTurnDecision`. `measure_and_price_roof`
   → `{action:'measure'}` (the route then runs `measureAndDispatchRoofing`);
   `send_saved_quote` → `{action:'send_saved', structureChoices}`;
   `book_inspection` → `{action:'booking', confirmed}`; `verify_address` →
   `{action:'ask', step:'confirm_address'}` so the route calls
   `screenConfirmAddress`; `answer_business_question` / `ask_for_detail` /
   `hand_to_other_trade` → `{action:'ask', reply}` (or `passthrough` for a
   hand-off); `deflect_and_notify` → `{action:'ask'}` with a **composed**
   deflect line plus a tradie notify.

5. **Grounding validator** (`assertGroundedReply`), applied to every
   LLM-authored reply before it reaches `sendReply`. Reject the reply when it
   contains a dollar figure, an area (`m2`/`sqm`/`square metres`), a structure
   count (`N buildings` / `N structures`), a street address, or a `/q/` or `/r/`
   link that is not present in the turn's grounded set (current slots + injected
   tenant facts + this turn's tool results). On rejection: log, discard the LLM
   decision, and use the deterministic `advanceRoofing` / `advancePainting`
   decision for that turn.

6. **Behaviour fixes carried by the LLM path** (each also a unit test):
   - Booking consent: `'yes'` books; `'no'` closes politely; `'unclear'`
     re-asks **once** (tracked as `booking_reask` on the state) and on a second
     unclear treats it as a live lead and confirms + notifies. Never drops.
   - `declined_trade` is appended to `declined_trades[]` on the conversation
     state; `shouldEngageRoofing` / `shouldEngagePainting` return **false** for a
     declined trade unless the customer explicitly re-requests it.
   - A trade switch works when the message contains both trades' words — the LLM
     path never consults `namesOtherTrade`.
   - A question is answered, never parsed as an answer or counted as a miss.

7. **Preserve the hard gates deterministically, ahead of the model**:
   `isStopRequest` (opt-out) runs **before** the LLM call on every turn and
   short-circuits to `{action:'cancel'}`. The reply scrubber strips em dashes and
   normalises to AU spelling on every LLM-authored reply.

8. **Wire the route** (`handleRoofingTurn`, `handlePaintingTurn`): when
   `llmReceptionistEnabled(tenantId)`, compute the LLM decision; on **any**
   throw, timeout, schema failure, or grounding rejection, fall back to the
   existing deterministic decision for that turn. Flag off → the existing call is
   the only call made, unchanged.

9. **Docs, per CLAUDE.md**: append a new `docs/strategy.md` iteration entry
   explaining the architecture change, update the "Roofing — deterministic SMS
   receptionist … Zero LLM in the customer-facing flow" description in
   `CLAUDE.md`, update the note in `lib/sms/model.ts`, and document the
   enable/disable procedure. Run the `strategy-reviewer` agent afterwards.

## Constraints

- **S1 — flag-gated, default OFF.** `SMS_LLM_RECEPTIONIST_ENABLED` unset ⇒ zero
  behaviour change and zero extra LLM calls. Disable takes effect on the next
  inbound with no redeploy.
- **S2 — fail-open.** Model error, timeout, malformed output, refusal, or a
  grounding violation falls back to the deterministic machine **for that turn**.
  A model outage must never drop a lead, block a write, or dead-end a customer.
  Exactly one outbound SMS per turn — the fallback must not double-send.
- **S3 — money path untouched.** No edits to `lib/roofing/pricing.ts`,
  `lib/roofing/measure.ts`, `lib/sms/roofing-compose.ts`,
  `lib/sms/roofing-measure-dispatch.ts`, `lib/painting/pricing.ts`. Verify with
  `git diff --name-only`.
- **S4 — the model never emits money.** No price, area, structure count,
  measured address, quote link or booking confirmation may originate in model
  text. Enforced by the grounding validator, not by prompt instruction alone.
- **S6 — 986 existing tests stay green** with the flag off.
- No em dashes in customer SMS. AU/NZ idiom, spelling, dates, addresses.
- Never surface licence number, ABN, insurance, owner mobile or owner email.
- Minimal footprint: one new module + one new test file. Reuse
  `withRetry`, `SMS_RECEPTIONIST_MODEL`, `SMS_RECEPTIONIST_MAX_TOKENS`. No new
  dependency, no new abstraction layer over the existing decision unions.
- Keep `.scratch-audit/*.mjs`. Delete any other scratch file created.
- Do not regress the fixes already on main: F1-F15, U1/U2/U3, B1, P1-P3, the F4
  recovery net, the F12 unit fix, the round-4 drain/G6/G7/G10/R1/R5 work, and
  the round-5 trade-switch/greeting work.

## Acceptance criteria & gates

**Gate commands (all must be run; none may be reported as passing unrun):**
```
npx vitest run lib/sms lib/customers      # ≥986 passing, 0 failing
npx tsc --noEmit                          # clean
git diff --name-only                      # none of the S3 files listed
node --env-file=.env.local .scratch-audit/repro-screenshot.mjs
node --env-file=.env.local .scratch-audit/scenario-runner.mjs
```

**Unit tests (mocked model — London school; the model is mocked, the
deterministic functions are real):**
- `AC1` A greeting at `await_booking` yields `booking_consent:'unclear'` → the
  mapped decision re-asks; it does **not** return `{action:'booking',
  confirmed:true}`. A second unclear confirms + notifies (lead safety).
- `AC2` `"No i dont want a roofer"` records `declined_trade:'roofing'`;
  `shouldEngageRoofing` then returns false for that conversation.
- `AC3` `"Not roofer i want electrical work"` maps to a hand-off to the general
  dialog (`passthrough`), **not** an address re-ask — asserted on a state where
  `namesOtherTrade` returns false for that string.
- `AC4` `"You do paint?"` on a painting-enabled tenant maps to
  `answer_business_question` with a reply grounded in `trades[]`; it does **not**
  produce `offer_form` / start a painting intake.
- `AC5` Grounding validator: a model reply containing `$11,682` when no tool
  returned it is rejected and the deterministic decision is used instead.
- `AC6` Tool-contract routing: a scripted `measure_and_price_roof` decision maps
  to `{action:'measure'}` with the gathered slots, so the route calls
  `measureAndDispatchRoofing` with exactly those slots — the composer, not the
  model, produces the dollar figures.
- `AC7` Fail-open: a model that throws yields the byte-identical deterministic
  decision, and exactly one reply is dispatched.
- `AC8` Flag off ⇒ `decideLlmTurn` is never called.
- `AC9` `isStopRequest` short-circuits before the model: bare `STOP` cancels;
  `"will it stop leaking?"` does not.
- `AC10` No em dash appears in any LLM-authored reply after scrubbing.

**Transcript regression fixtures (through the mocked-model path):**
- `T-A` QM Sparky transcript A: `"Hi there"` → no booking; `"No i dont want a
  roofer"` → roofing disengaged and remembered; `"I am not wanting a roofer"` and
  `"Not roofer i want electrical work"` → electrical hand-off, never the address
  re-ask; `"Hey!"` → roofing address is **not** re-asked.
- `T-B` `"You do paint?"` answers the question; `"How about electrical"` is
  answered about **electrical**, and no roofing inspection is booked at a stale
  address.

**Live gates (flag ON, then OFF):**
- `S5` baseline diff — A1 (12 Smith St, `$11,682`), A2 (670 London Rd, 3
  buildings, `$159,885`), A3 (asbestos → inspection, no firm price), A5 (booking
  confirmed) produce **identical addresses and identical prices** before and
  after. Any drift blocks the ship.
- Both customer transcripts behave per `T-A` / `T-B` against the live endpoint.
- The 20-scenario suite reports 0 blockers and 0 open majors.

**Review gates:** `/review` requirement-by-requirement against this file, then
`/code-review` over the diff. Every finding adversarially verified. Specifically
hunt: *the model emitted a price/address no tool returned*; *the fallback path
double-sends*; *a greeting still consents*; *a declined trade is re-asked*; *the
flag-OFF path changed*. Blockers and majors must be fixed; minors logged.

## Enable / disable procedure

- **Enable for one tenant:** set `SMS_LLM_RECEPTIONIST_ENABLED=<tenant-uuid>`
  (comma-separate for several) in the Vercel project env, redeploy or wait for
  the next lambda cold start. Effective on the next inbound SMS.
- **Enable everywhere:** `SMS_LLM_RECEPTIONIST_ENABLED=1`.
- **Disable (seconds, no code change):** set the value to `0` or delete the
  variable. The next inbound runs the deterministic machine. No migration, no
  state cleanup — `declined_trades` is additive and ignored by the old path.

## Examples

<example>
Deterministic decision union the LLM path must produce — `lib/sms/roofing-receptionist.ts:73`.
The route already switches on exactly these; mapping onto them is what keeps the
money path untouched.

  | { action: 'ask'; slots: RoofingSlots; step: RoofingStep; reply: string }
  | { action: 'measure'; slots: RoofingSlots }
  | { action: 'send_saved'; slots: RoofingSlots; structureChoices: number[] | null }
  | { action: 'booking'; slots: RoofingSlots; confirmed: boolean }
  | { action: 'passthrough'; slots: RoofingSlots; close?: boolean }
</example>

<example>
The bug AC1 encodes — `lib/sms/roofing-receptionist.ts:538-547`:

  if (rawLastStep === 'await_booking') {
    return { action: 'booking', slots, confirmed: !isNegative(inbound) }
  }

"Hi there" is not negative ⇒ `confirmed: true` ⇒ "A roofer will be in touch
shortly to lock in a time for the inspection." A greeting booked an inspection.
</example>

<example>
The veto AC3 encodes — `lib/sms/roofing-intake.ts:133-140`:

  export function namesOtherTrade(text: string): boolean {
    const t = (text ?? '').toLowerCase()
    if (!t.trim()) return false
    if (/\b(?:re-?)?roof|gutter|downpipe|eaves|fascia|ridge cap|sarking/.test(t)) return false
    return OTHER_TRADE.test(t)
  }

"Not roofer i want electrical work" contains "roof" ⇒ returns false ⇒ the switch
is vetoed and the address parser answers instead.
</example>

<example>
Closest existing code to imitate for the LLM call: `lib/sms/dialog.ts:1798-1889`
(`withRetry` + `generateObject` + ephemeral cacheControl on the static system
prompt, dynamic content in the user message) and its post-call deterministic
scrubs at `:1890-1945` (`scrubVoiceWording`, `repairQuoteLinks`) — the same
defence-in-depth shape the grounding validator takes.
</example>
