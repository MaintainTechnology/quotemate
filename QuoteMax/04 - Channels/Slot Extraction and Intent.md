---
title: Slot Extraction and Intent
type: component
area: channel
tags: [quotemax, sms, nlu, slots, intent, sonnet-5, parsing]
status: draft
updated: 2026-09-04
sources:
  - quotemate-automation/lib/sms/extract-slots.ts
  - quotemate-automation/lib/sms/intent.ts
  - quotemate-automation/lib/sms/roofing-intake.ts
  - quotemate-automation/lib/sms/assumptions.ts
  - quotemate-automation/lib/sms/dialog.ts
  - quotemate-automation/lib/sms/model.ts
---

# Slot Extraction and Intent

The NLU layers that sit *around* the conversation model on the SMS channel. Three
distinct jobs, three different techniques:

| Layer | Technique | Runs | File |
|---|---|---|---|
| Intent classification (tradie vs customer) | regex first, Sonnet 5 only on the ambiguous middle | turn 1 of a new conversation on the shared number | `lib/sms/intent.ts` |
| Slot extraction (electrical / plumbing) | Sonnet 5, `generateText` + manual JSON parse | once per inbound, **before** the dialog call | `lib/sms/extract-slots.ts` |
| Yes / no / stop / greeting parsing | pure regex, no model | first on every roofing + painting turn | `lib/sms/roofing-intake.ts` |

All three model-using layers share `SMS_RECEPTIONIST_MODEL` and
`SMS_RECEPTIONIST_MAX_TOKENS` from `lib/sms/model.ts` — see [[LLM Receptionist]]
for why the token ceiling MUST be explicit. The regex layer is deliberately
model-free: it decides opt-out and consent, and "compliance is not a judgement
call" (`lib/sms/llm-receptionist.ts:870-871`).

---

## 1 · Intent classification

`lib/sms/intent.ts`. Decides whether an inbound on the **shared** QuoteMax number
is `tradie_registration`, `customer_quote`, or `ambiguous`.

Hybrid, in three stages (`lib/sms/intent.ts:6-24`):

1. **Regex first** — 10 `TRADIE_PHRASES` and 7 `CUSTOMER_PHRASES` (`:27-51`).
   Sub-millisecond, no API call, catches ~80% of inbounds.
2. **Sonnet 5 fallback** only when regex is ambiguous **and** the message is
   >= 4 words (`:135-141`). Short messages are likely greetings and do not earn a
   model call.
3. **On any Sonnet failure → `'ambiguous'`**, which routes to the customer flow —
   the safer default (`:236-243`).

Deterministic tie-breaks that matter:

- Both a tradie phrase and a customer phrase match → **customer** (`:84-95`). The
  tradie can retry with clearer wording; a misrouted customer loses a lead.
- Fewer than 4 words with no regex match → `source: 'short_message'`, and the
  Sonnet call is skipped entirely (`:114-118`, `:139-140`).
- Sonnet returning `confidence: 'LOW'` is downgraded to `'ambiguous'` — "don't
  trust either classification" (`:222-231`).

`IntentClassification.source` (`:54-67`) is the debug trail:
`regex_tradie | regex_customer | regex_conflict | short_message | no_match |
sonnet | sonnet_failed`. Regex matches are implicitly HIGH confidence.

Two implementation details worth preserving:

- The AI SDK is **dynamically imported** inside `classifyIntentWithSonnet`
  (`:190-193`) so `classifyIntentSync` callers never pull the SDK bundle. The
  module's top-level imports are constants only (`:1-2`).
- The intent schema **does** use native structured output
  (`structuredOutputMode: 'outputFormat'`, `:212`) — safe here because it is
  "three enums and a capped string, with no numeric min/max for the API to
  reject" (`:208-211`). See the constraint note below.

⚠ The Sonnet system prompt names the platform "QuoteMax" but one of its
registration examples reads "become a quotemate" in the regex
(`lib/sms/intent.ts:31`, `/\bbecome\s+(a\s+)?quotemate\b/i`) — a leftover from
the old product name. It is harmless (an extra alias) but is not a live brand.

---

## 2 · Slot extraction (electrical / plumbing)

`lib/sms/extract-slots.ts`. Runs **once per inbound SMS, before the dialog Sonnet
call**, reading the current `conversation_state`, the agent's last outbound (for
context) and the new inbound, and returning a **partial** slot update
(`:1-16`). The route merges it with `mergeSlotUpdates()` and persists to
`sms_conversations.conversation_state`.

Its reason for existing is a real incident: without it "I'm in Chandler" arrives
as plain text in `sms_messages`, nothing tracks the change, and the dialog has to
re-derive from the transcript every turn — "which is exactly how Con's bug
(2026-05-11) became a 4-round-trip ordeal" (`:11-15`).

### The slot vocabulary

`SlotsSchema` (`:26-108`). Two classes:

- **Persistent profile slots** — `PERSISTENT_PROFILE_SLOTS = ['first_name',
  'suburb', 'address', 'email']` (`:109`). Pre-seeded from the `customers` row and
  **eagerly written back** when `source === 'customer_corrected'`, because a
  customer expects "update my address to X" to stick across conversations rather
  than waiting for a finish (`:27-31`).
- **Per-job slots** — scoped to the current request: `job_type`, `count`, `room`,
  `ceiling_type`, `replace_or_new`, `colour`, `supplied_by`, `verified`, plus the
  Phase 4 price-band slots `distance_to_existing_power` and the circuit
  amperage/phase slot (`:76-108`).

`job_type` is an enum spanning both trades on one line: 8 electrical values
(including `ev_charger` and `fault_finding` — see [[EV Charger Jobs]]), 9 plumbing
values, plus `unknown` and `out_of_scope` (`:37-49`).

⚠ **`count` is `z.number()`, deliberately NOT `.int()`** (`:50-57`). Anthropic's
structured-output validator rejects *every* integer-range constraint (`minimum`,
`maximum`, `exclusiveMinimum`, `exclusiveMaximum`), and the AI SDK silently adds
safe-integer bounds the moment `.int()` is called — so any `z.number().int()`
schema fails with *"For 'integer' type, properties maximum, minimum are not
supported"*. Plain `z.number()` compiles to `{"type":"number"}` and is accepted;
the value is `Math.trunc`'d server-side wherever it is used as an integer.

This is the **same constraint** that keeps the roofing/painting receptionist off
native structured output: its `structure_choices` field is
`z.number().int().min(1).max(20)`, so `structuredOutputMode: 'outputFormat'` would
400 on every turn — which is precisely why `llm-receptionist.ts` has to
hand-recover text answers via `recoverTextObject`
(`lib/sms/dialog.ts:1919-1924`). The general dialog **can** use native output
because `TurnDecisionSchema` has no such constraint.

### Why `generateText`, not `generateObject`

A production incident, documented inline at `:648-682`:

> 2026-05-27 hotfix — "Schema is too complex" production error. Anthropic
> tightened JSON-schema complexity validation on the `tool_use` path. The
> 16-field `SlotsSchema` ... crossed the new threshold and started rejecting
> every call. Three retries x Sonnet timeout = 300s Vercel function timeout =
> dialog dies.

The fix keeps identical typed output with three layered safeguards:

1. `generateText` (no `tool_use`) bypasses Anthropic's complexity check entirely —
   Sonnet writes JSON, we parse it and validate against the **same** Zod schema.
2. `maxAttempts: 2` (`:707`) so a hopeless retry chain cannot burn 300s.
3. A fail-safe `try/catch` that returns `{ updates: {} }` on any failure, so the
   dialog turn still completes with the prior state — "customer gets a reply, not
   a 300s timeout" (`:737-751`).

`extractJsonObject` (`:767-795`) is the pure parser that recovers JSON from the
two shapes Sonnet occasionally produces despite the strict-JSON instruction:
markdown fences, and a leading preamble. It falls back to a **balanced-brace
scan** from the first `{`. Three failure branches each return an empty extraction
with a distinct `reasoning` string, so the logs say which one fired
(`:719-736`).

### Tenant trade scoping

`extractSlots({ tenantTrades })` (`:585-601`, built at `:617-641`). On a
single-trade tenant the prompt gains a `TENANT TRADE SCOPE` line instructing the
model to classify off-trade jobs as `job_type: 'out_of_scope'` rather than
writing the wrong-trade value into `conversation_state`. Undefined or empty is
**permissive** (extract any trade) for legacy pre-v6 single-pilot traffic.

The enum itself is shared across tenants — scoping is a *prompt* directive, not a
schema change (`:613-616`). See [[Trades Registry]] and [[Tenancy Model]].

### `mergeSlotUpdates` and source attribution

`:226-272`. Pure, no LLM. Rules:

- `null` / `undefined` values are **skipped**, never written — a missing slot
  means "unchanged", not "clear".
- `requested_specs` is an **accumulating map**: deep-merged so an earlier "15 amp"
  is not lost when a later turn adds "weatherproof". New keys win on conflict
  (`:236-250`).
- Every write stamps a `SlotSource` (`:114-122`):
  - `from_memory` — pre-seeded from the `customers` row at conversation start
  - `from_transcript` — extracted fresh this conversation
  - `customer_corrected` — the extracted value **differs from** a previously
    stored value
- `verified` is always `from_transcript` even when it changes (`:262-263`) —
  affirming a summary is not a correction.

The source attribution is load-bearing twice over: it drives the dialog prompt
(so the model knows to *acknowledge* a correction) and the scrub (so it bails on
values the customer just corrected) (`:114-116`).

⚠ `normaliseState` (`:153+`) returns a **fresh literal**, so any key not named in
it is silently dropped. The clarify-gate fields `clarify_gate_count` and
`clarify_missing` had to be added explicitly — before that, every read of
`conversation_state` reset the route's own persisted counter to 0 and its missing
set to `[]` on every turn (`:159-166`). Adding a new persisted field to
`ConversationState` means adding it to `normaliseState` in the same commit.

---

## 3 · Deterministic parsing — yes, no, stop, greeting

`lib/sms/roofing-intake.ts`. Shared by the roofing and painting receptionists and
by `runTurn` in the LLM path. **No model is involved.** These decide opt-out and
consent, which are the two things that must never depend on a model being awake.

### Affirmation and negation

```
AFFIRM = /\b(yes|yep|yeah|yup|correct|right|that'?s right|that'?s it|
             confirmed|sure|ok|okay|👍)\b/            :433
DENY   = /\b(no|nope|nah|wrong|incorrect|not right|different)\b/   :434
```

`deEmphasise()` (`:452-469`) collapses runs of 3+ identical letters to one before
a second match attempt, so "Noooo" → "no" and "yesss" → "yes". The incident that
forced it (QM Sparky, Jeff, 2026-08-07): at `confirm_address` the customer
answered "NO", "No", then "Noooo". The elongated one parsed as **neither** affirm
nor deny, nothing cleared the address, `address_confirmed` was already true from
an earlier turn, and `nextRoofingStep` went straight to `'ready'` and **measured
the roof the customer had just rejected three times**. Runs of exactly two are
untouched, so "all", "correct" and "address" survive.

`NEGATION_CUE` (`:437-443`) is a separate vocabulary consulted **only to block a
confirm**, never to cause one. It catches "not quite right" / "isn't right" /
"not sure", which carry an AFFIRM token (`right`, `sure`) but no DENY token and
therefore wrongly confirmed at `confirm_address` (live 2026-07-24). It is
explicit contractions only — a bare `n'?t\b` suffix wrongly matched the trailing
"nt" of *apartment*, *front*, *point*.

`rejectsReadBack(msg)` (`:445-448`) = `isNegative(msg) || NEGATION_CUE.test(msg)`.
One vocabulary, so "the state machine and the rejection budget cannot disagree
about what a 'no' is".

⚠ **"no wait yes" deliberately does not confirm** (`:481-489`). Three independent
adversarial reviews each proved that every minimal last-signal / strong-flip
heuristic **false-confirms a real rejection** on the wrong-roof money path: a
negated weak affirm ("no that isn't correct") and a trailing agreement tag
("that's wrong, yeah") are indistinguishable from a genuine flip by token
position alone. The baseline stays `isAffirmative && !isNegative`; "no wait yes"
safely re-asks. Doing it properly needs a real intent classifier, and is deferred
in `specs/sms-roofing-u1-u5.md`.

### Stop / opt-out

```
STOP_RE        = stop|cancel|cancelled|unsubscribe|quit|end this|end the|
                 not interested|leave me alone|go away|never ?mind|forget it   :495
FRUSTRATION_RE = profanity, stfu, piss off, bugger off, bullsh, shut up        :496
STOP_OUTCOME   = (stop|end) …{0,3} (leak|drip|water|rain)                      :501
```

`isStopRequest` (`:504-509`) checks `STOP_OUTCOME` **first and returns false** on
a match. F11, live 2026-07-24: *"will the old roof stop leaking after this?"*
cancelled the thread. A bare "no" is deliberately **not** a stop — it is a valid
answer to a confirm question (`:492-494`).

**Invariant:** `isStopRequest` MUST be evaluated before the model is called.
`runTurn` does this at `lib/sms/llm-receptionist.ts:871-873` and returns
`source: 'deterministic'`, guaranteeing a bare STOP costs nothing and never
depends on a model turn succeeding.

### Greeting-only

`GREETING_ONLY` (`:182-188`) is anchored `^…$`: `hi | hey | hello | yo | gday |
g'day | good morning/afternoon/evening | hi there | hey there | thanks |
thank you | cheers`, optionally followed by `mate | guys | team | there`.
`isGreetingOnly` returns false outright if the text is affirmative or negative.

The exclusions are the interesting part (`:178-181`): `ok`, `okay`, `sure`,
`cool`, `great`, `sweet` and "no worries" are **deliberately not** greetings,
because they are AFFIRM tokens — matching them here swallowed a valid "ok" at
`confirm_address` into an unbounded re-ask loop (no miss counted, so it never
escalated) plus a live map lookup every turn.

Greeting handling is consent-critical: a greeting is never booking consent
(`SYSTEM_PROMPT` rule 2, `lib/sms/llm-receptionist.ts:546`; enforced in the
mapper at `:1449-1454` and in the fallback at `:899-907`), and a greeting is
never a structure pick (`:1429-1433`).

### ⚠ Drift against the debt register

`quoteMate/CLAUDE.md` lists under *Known debt* that "`y`/`👍`/`ya` not accepted as
yes" and "AU idiom ('no worries') parses as no". Checked against the current
source:

- **👍 is now accepted** — it is in `AFFIRM` (`lib/sms/roofing-intake.ts:433`).
  That part of the entry is stale.
- **`y` and `ya` are still not accepted** — neither appears in `AFFIRM`.
- **"no worries" still parses as a negative** — `DENY` contains `\bno\b`, which
  matches it. `isGreetingOnly` explicitly does not rescue it (`:178-181`). The
  debt is live.

See [[Known Debt Register]].

---

## 4 · Assumption rules (the MUST-ASK block)

`lib/sms/assumptions.ts` is loaded into the dialog system prompt. Per "easy 5"
job type it declares `safeDefaults` (fields the agent may fill silently),
`mustAsk` (fields that genuinely change the quote and have no safe default) and
`inspectionTriggers` (phrases that force inspection mode regardless of
confidence) (`:1-15`). `ASSUMPTION_RULES` covers 11 job types — 5 electrical,
6 plumbing (`:17-38`), plus `UNIVERSAL_MUST_ASK` (`:352`) and
`UNIVERSAL_INSPECTION_TRIGGERS` (`:362`). `rulesAsText(jobType)` (`:410`) renders
it for the prompt; `mustAskLines(jobType)` (`:443`) returns the questions alone.

The file carries an explicit maintenance instruction: **edit it when a tradie
corrects the agent** — every "I had to fix downlights to assume raked ceiling" is
feedback that belongs in `safeDefaults` or `mustAsk` (`:12-14`).

That rendered text is also fed to the grounding validator's authoritative bucket
on the dialog branch, so the legitimate spec numbers it carries (e.g. the 600 mm
wet-area clearance) are not mistaken for invented figures
(`app/api/sms/inbound/route.ts:3541-3547`). See [[Grounding and Safe Replies]].

---

## Open questions

- The exact route ordering between `classifyIntent`, `extractSlots` and the
  receptionist gates on a first inbound is in
  `app/api/sms/inbound/route.ts` and is documented in [[SMS Inbound Route]]
  rather than here.
- Nothing outstanding on the schema itself: `requested_specs` is
  `z.record(z.string(), z.string()).nullable().optional()`
  (`lib/sms/extract-slots.ts:103`) — an open key/value bag of any product spec the
  customer states verbatim ("15 amp" → `{amperage:"15A"}`), captured **alongside**
  `circuit_required` because that enum cannot represent 15A, and reconciled
  downstream against the chosen catalogue product in `lib/estimate/spec-reconcile`.

## Related
- [[LLM Receptionist]]
- [[Grounding and Safe Replies]]
- [[SMS Inbound Route]]
- [[SMS Channel Overview]]
- [[Model and Prompt Inventory]]
- [[Roofing Receptionist]]
- [[EV Charger Jobs]]
- [[Known Debt Register]]
