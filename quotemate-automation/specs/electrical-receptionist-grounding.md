# Phase 1b — the electrical receptionist cannot state a figure no tool produced

## Goal

No SMS the electrical receptionist sends contains a price, product name, count or link that
did not come from a tool result, and no legitimate electrical question is blocked in the
process. Today the model can text a customer "Clipsal 2000, about $180 each" with nothing
checking it, and the prompt actively asks it to write dollar amounts.

## Role

Principal engineer. This is customer-facing text on a live number, so a false positive
(blocking a good reply) is as harmful as a false negative. The guard must be proven in both
directions before it is allowed to reject anything.

## Context

All paths relative to `quotemate-automation/`. Every claim verified by reading the file.

**The guard exists and is unreachable from here.** `lib/sms/llm-receptionist.ts:280-284`
`assertGroundedReply(reply: string, authoritative: string[], conversational: string[] = []):
GroundingResult`, returning `{ ok: true } | { ok: false; reason: string }` (`:262`). It has
exactly one production call site, `:947`, inside `runTurn`, reached only via
`roofingTurnViaLlm` and `paintingTurnViaLlm`. `app/api/sms/inbound/route.ts:43-51` imports five
symbols from that module and this is not one of them.

**Money is unconditionally fatal — six patterns, not three.** `:189-201` defines `MONEY_SIGN`
`/\$\s?\d/`, `MONEY_WORD`, `PERCENT`, `SPELLED_AMOUNT`, `SPELLED_COMPOUND`, and `MONEY_CONTEXT`.
The chain at `:287-298` runs *before* any grounding lookup, so no amount of authoritative context
can permit a figure. `MONEY_CONTEXT` includes the token `each`, and fires whenever the reply also
contains any number.

**Non-money rejection is per category** (`:344-350`): ungrounded area, ungrounded count, then
`everyNumber()` — every digit run must appear in authoritative + conversational — then address,
then link. Links ground against `authoritative` only (`:349`), so a customer cannot authorise a
URL by typing it. `FREE_QUESTION_NUMBER = 10` (`:222`) exempts a number below 10 in a reply
containing `?`.

**Three things the current prompt does that the guard rejects.** These were confirmed by running
the real guard, not inferred:

1. The `$99 inspection booking` offer appears at four prompt sites. `MONEY_SIGN` rejects it.
2. `lib/sms/dialog.ts:657` `Reply with its link (and figure if asked).` invites a figure.
3. Legitimate electrical questions are caught: `600mm` (the wet-area clearance the prompt
   mandates asking about — 600 is far above `FREE_QUESTION_NUMBER`), and `9W each`
   (`MONEY_CONTEXT` `each` plus a number). Also `2 mins` and `11/05`.

So this is **not a deletion job**. The $99 line must be composed by the route rather than the
model, and the spec-value questions need their numbers grounded.

**Roofing's `authoritative` construction must NOT be copied.** Roofing seeds it from tenant facts
plus its own last 8 outbound bodies, which is safe only because a deterministic composer wrote
every one of them. On the electrical path every outbound body is unguarded model text, so reusing
that pattern would launder one hallucinated figure into permanent authority.

**There is no deterministic fallback machine on this path.** Roofing rejects a turn via `bail()`
→ `advanceRoofing(prev, inbound)`, a pure state machine. Electrical has no equivalent. What it
does have is `buildDialogFallbackReply` at `app/api/sms/inbound/route.ts:387` — already the
throw-path holding line, digit-free, and verified to pass the guard.

**Post-model processing today is cosmetic only** — `lib/sms/dialog.ts:1929-1945` runs
`scrubVoiceWording`, a suburb re-ask rewrite and `repairQuoteLinks`. None inspects a number.
The reply then goes to Twilio unmodified at `route.ts:3439-3443`.

## Task

1. Export `assertGroundedReply` usage into the electrical branch: import it in
   `app/api/sms/inbound/route.ts` and call it on `decision.reply_to_send` after the existing
   deterministic overrides (GPO guard, name/suburb force) and before dispatch.
2. Build the `authoritative` array from tool-produced values only: the tenant facts block via
   the existing `buildTenantFacts`, the merged `conversation_state.slots` JSON, and the
   product-options SMS body when one was composed this turn. **Do not include prior outbound
   bodies.** Build `conversational` from inbound bodies plus the current inbound text.
3. On rejection, keep `decision.action` and `ready_for_intake` exactly as the model returned
   them and replace only `reply_to_send` with `buildDialogFallbackReply`. Log the guard's
   `reason`. Do not re-prompt the model and do not drop the turn.
4. Remove the money instruction at `lib/sms/dialog.ts:188` and the figure invitation at `:657`.
5. Move the `$99 inspection` amount out of the model's hands: have the route compose that reply
   when `decision.action === 'escalate_inspection'`, following the existing composition precedent
   at `route.ts:3105`. The model may say an inspection is needed; it may not say what it costs.
6. Ground the spec-value questions rather than banning them: add the clarifying-question numbers
   the prompt legitimately needs (the 600 mm wet-area clearance, wattage values) to
   `authoritative`, sourced from the same clarifying-question data the prompt is built from.

## Constraints

- Do not weaken `assertGroundedReply` itself. It is shared with roofing and painting and is
  covered by `lib/sms/grounding-corpus.test.ts`; a change there is a change to two live trades.
- Do not add prior outbound bodies to `authoritative` (see Context).
- Do not introduce a deterministic electrical state machine in this change. Swapping the reply
  text is the whole intervention.
- Ship behind no flag. A guard that is off is not a guard; the fallback line is safe enough to
  be unconditional.
- Do not touch the roofing or painting branches.

## Acceptance criteria & gates

Gate commands, confirmed from `package.json`:

```
npm test          # vitest run --testTimeout=20000
npm run typecheck # tsc --noEmit
npm run lint      # eslint
```

Required tests, following the corpus pattern in `lib/sms/grounding-corpus.test.ts` exactly —
inline `const` arrays, both directions, no mocks, no model:

- A new co-located corpus test asserting **must-reject**: an invented price (`$180 each`), an
  invented brand-plus-price, a percentage, a spelled amount, an ungrounded count, an ungrounded
  link.
- The same test asserting **must-pass**, which is the half that matters most here: the ordinary
  gather questions the electrical prompt actually emits, the `600 mm` clearance question, a
  wattage question, and every reply that echoes a figure the customer themselves supplied.
- A test that on rejection `action` and `ready_for_intake` are unchanged and only
  `reply_to_send` differs, and that `buildDialogFallbackReply` itself passes the guard.
- A test that the composed `$99` escalation reply is produced by the route and passes the guard.

Because this change edits a prompt, also run the live companion, which is `describe.skipIf`
gated and documents its own command:

```
LIVE_LLM=1 node --env-file=.env.local ./node_modules/vitest/vitest.mjs run lib/sms/live-llm-turns.test.ts --testTimeout=300000
```

Completion bar: the three gates pass, the corpus test passes in both directions, `/verify`
confirms a real electrical SMS turn still gathers and still escalates, and `/review` plus
`/code-review` report no blocker or major findings.

## Examples

<example>
The corpus shape to copy exactly — `lib/sms/grounding-corpus.test.ts:1-2,64-78`. Four inline
const arrays (`AUTH`, `CUST`, ~50 must-reject, ~39 must-pass), two `it()` blocks looping into
`toMatchObject({ ok: false })` / `{ ok: true }`. Its header states why both directions are
asserted: a false positive silently reverts the turn. That reasoning applies here with more force,
because electrical has no state machine to revert to.
</example>

<example>
The scripted-model seam to use rather than calling Sonnet —
`lib/sms/llm-receptionist.test.ts:41-51` `scripted(...)` returns a `vi.fn` decider that throws on
an unscripted extra call, so an unexpected model call fails the test loudly. Pair it with
`expect(decide).not.toHaveBeenCalled()` wherever a deterministic path must pre-empt the model.
</example>

<example>
The route-side composition precedent for step 5 — `app/api/sms/inbound/route.ts:3105` already
composes an outbound body in the route instead of trusting the model's text. Follow that shape
for the `$99` escalation rather than inventing a new templating path.
</example>
