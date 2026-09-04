---
title: Voice Assistant Prompt and Tools
type: reference
area: channel
tags: [quotemax, voice, vapi, prompt, persona, drift]
status: draft
updated: 2026-09-04
sources:
  - quotemate-automation/lib/vapi/voice-prompt.ts
  - quotemate-automation/lib/vapi/trade-questions.ts
  - quotemate-automation/lib/vapi/assistant-patch.ts
  - quotemate-automation/lib/vapi/tenant-services.ts
  - quotemate-automation/lib/sms/assumptions.ts
  - quotemate-automation/scripts/deploy-vapi-voice-prompt.mts
  - quotemate-automation/scripts/sync-vapi-assistants.mts
  - quotemate-automation/scripts/update-vapi-prompt-confirm.mjs
  - quotemate-automation/scripts/update-vapi-speed-config.mjs
  - quotemate-automation/scripts/update-vapi-rename-jeff-to-jon.mjs
  - quotemate-automation/scripts/update-vapi-fix-ev-charger-fields.mjs
  - quotemate-automation/scripts/update-vapi-add-photo-tool.mjs
  - quotemate-automation/scripts/update-vapi-end-call-config.mjs
  - quotemate-automation/scripts/update-vapi-transcriber.mjs
---

# Voice Assistant Prompt and Tools

Two prompts exist. One is composed in the repo by `lib/vapi/voice-prompt.ts`. The other is the text
actually sitting on the live Vapi assistant, which a long series of one-off `scripts/update-vapi-*.mjs`
passes has hand-patched into a different document. **They are not the same prompt.** This note
describes both and the drift between them, because pushing one over the other is destructive.

Runtime plumbing lives in [[Voice Channel (Vapi)]].

## Part 1 — the composed prompt (`lib/vapi/voice-prompt.ts`)

One builder, three consumers: `provision.ts` (create), `update-assistant.ts` (settings change) and
`scripts/deploy-vapi-voice-prompt.mts` (manual push). The header states the reason plainly — a single
source "so the two cannot drift" and so trade types widen in one place (`voice-prompt.ts:1-7`).

### Exports

| Export | Purpose | Line |
|---|---|---|
| `buildVoiceFirstMessage(businessName, trades, override?)` | the assistant's spoken opening | `:97` |
| `buildVoiceSystemPrompt(businessName, trades, override?, customServices?)` | the system prompt | `:231` |
| `renderTradeLabel(trades)` | `['a','b','c'] → "a, b or c"` (Australian style, no Oxford comma) | `:85` |
| `VoicePromptOverride` | the `trade_prompts` hook: `voice_greeting` / `voice_system_prompt` | `:38` |
| `VoiceCustomService` | one tenant-enabled service + its DB `clarifying_questions` | `:50` |

An override, when non-empty, **replaces the composed text verbatim** and short-circuits everything
below (`:102-104`, `:237-239`). Electrical and plumbing supply neither, so they compose.

### The composed greeting

```
G'day, you've reached {businessName}. I'm the AI quoting assistant — I can take down details
for your {tradeLabel} job and get a quote across. This call may be recorded for quality and
quote drafting. Sound good?
```
(`voice-prompt.ts:106-110`)

The recording-consent sentence is here, not in config — this is what satisfies the recording-consent
line in `docs/strategy.md` §"Recording consent".

### Structure of the composed system prompt

Sections, in emission order (`voice-prompt.ts:256-312`):

1. **Identity** — "You are the AI phone receptionist for {businessName}, an Australian {trades joined with 'and'} contractor." Note: **no name**. The composed prompt never says "Jon".
2. **YOUR JOB** — capture, read back, end; "you do NOT price anything on the phone".
3. **TONE & COMMUNICATION (Australian)** — understate not oversell; no Americanisms; "mate" at most once; explicitly bans "fair dinkum", "she'll be right", "crikey", "ripper"; use "sparky" for electrical and "plumber" for plumbing only once the job is known.
4. **HOW YOU RUN THE CALL** — one question per turn; listen first (don't re-ask what was volunteered); read-back handshake; caller's mobile comes from caller ID and is never asked for; declare defaults so they can be corrected; accept a decline once; never quote a price or promise a specific attendance day.
5. **OPENING** — first name → suburb → "what can we help you with today?".
6. **WHAT TO ASK — by trade** — the composed per-trade blocks (below).
7. **ANSWERING QUESTIONS** — callers can ask, not just answer; answer from the prompt's own facts, then steer back; never invent a price, brand, warranty or timeframe; if a service is not listed, say the business does not do it and offer what it does.
8. **INSPECTION TRIGGERS** — rendered directly from `UNIVERSAL_INSPECTION_TRIGGERS` (`lib/sms/assumptions.ts:362`).
9. **EMERGENCY OVERRIDE** — burning smell, smoke, sparks, shock, gas, burst pipe, ceiling water: one calm "is that happening right now?", make-safe instruction, capture name + suburb only, end fast.
10. **CLOSING & ENDING THE CALL** — one short line, then "call the endCall tool"; do not end while a MUST-ASK is unanswered, the scope is unread-back, or the caller is mid-sentence.

### Per-trade blocks are composed from data, not hand-written per trade

`trades` comes from `tenants.trades[]`, so a trade added there is spoken with no code change
(`voice-prompt.ts:9-11`). Three renderers:

| Renderer | Applies to | Source of the questions | Line |
|---|---|---|---|
| `renderAutoQuoteBlock` | `electrical`, `plumbing` only | `mustAskLines(jobType)` + `ASSUMPTION_RULES[jt].inspectionTriggers` from `lib/sms/assumptions.ts` — **verbatim, so voice and SMS cannot drift** | `:116` |
| `renderQualifyBlock` | any trade with a `VOICE_TRADE_QUESTIONS` entry | `lib/vapi/trade-questions.ts` | `:150` |
| `renderGenericBlock` | any other registered trade (e.g. signage, a future admin-loaded trade) | 3 hard-coded lead-capture questions | `:168` |

`AUTO_QUOTE_JOB_TYPES` (`:67-70`) enumerates which easy-set job types belong to each auto-quote
trade: electrical = downlights, power_points, ceiling_fans, smoke_alarms, outdoor_lighting;
plumbing = blocked_drain, hot_water, tap_repair, tap_replace, toilet_repair, toilet_replace.
Everything else in those trades is inspection-only, and the block says so in prose
(`:122-125`). Electrical additionally gets a carve-out: plans / drawings / a tender for a commercial
plan take-off must **not** be inspection-routed — offer an upload link instead (`:128-133`).

### `VOICE_TRADE_QUESTIONS` (`lib/vapi/trade-questions.ts`)

Five trades, each a `VoiceTradeBlock` with `mode`, ordered spoken `questions`, an `inspectionNote`,
a `closing`, and `howItWorks` facts for "how does this work?" questions.

| Trade | `mode` | What forces a site visit | Closing promises |
|---|---|---|---|
| `roofing` | `lead_qualify` | fibro / cement / asbestos sheet, very steep or unknown pitch, a leak trace. **"Never ask the year the house was built."** | measured off satellite imagery, quote sent — no price on the call |
| `painting` | `lead_qualify` | poor / flaking surfaces, raked or extra-high ceilings, 3+ storeys | measure confirmed, quote across — no price on the call |
| `solar` | `lead_qualify` | address + postcode + state are the only mandatory answers; "not sure" is a valid answer on grade and phase — accept and move on | installer confirms roof from satellite, design and quote sent |
| `aircon` | `assessment` | sizing **always** needs a site assessment; keep it indicative | site assessment first, quote straight after |
| `commercial_painting` | `tender_lead` | priced off the plan set; no surface-by-surface Q&A on the phone | send plans on the texted upload link, estimator builds the tender |

Why these are literal strings rather than imports: roofing/painting are deterministic step-machines
whose reply text is SMS-typed and coupled to their state enums, and solar/aircon/commercial have no
customer SMS conversation at all — so there is no single SMS question array to import
(`trade-questions.ts:7-12`).

**Invariant — a qualify-block trade MUST never promise a price on the call.** The `mode` and
`closing` fields encode it, `renderQualifyBlock` prints the header "(lead capture — no price on the
call)" (`voice-prompt.ts:152`), and the shared prompt repeats the ban. Voice has no grounding
validator equivalent to the SMS `assertGroundedReply`, so this prompt-level ban is the only guard.

### Tenant services injected from Supabase

`renderCustomServicesBlock` (`voice-prompt.ts:184`) prints the tenant's enabled services and their
DB-authored MUST-ASK questions, split by `always_inspection`:

- **AUTO-QUOTE services** — "treat like an easy job … don't route these to a $99 inspection, and
  don't say 'not something we do'". This block is declared **authoritative**, overriding the "not in
  the easy list → inspection" default (`:204-206`).
- **INSPECTION-ONLY services** — capture, then offer the $99 on-site inspection.

Caps mirror the SMS `customServicesDirective` so a large catalogue cannot blow the Vapi prompt
budget: 40 listed services per group, 6 MUST-ASK questions per service, 140 chars per question,
110 chars per description (`voice-prompt.ts:59-62`).

The rows are fetched by `fetchTenantVoiceServices` (`lib/vapi/tenant-services.ts`) through the same
`resolveEnabledSharedAssembliesForDialog` gate the SMS route uses — that shared gate is the reason
voice and SMS ask identical per-service questions.

### Tests that pin this

`lib/vapi/voice-prompt.test.ts` asserts the electrical-only prompt carries every easy-5 electrical
MUST-ASK line and **no** plumbing lines (and vice versa), that all seven trades compose without
collision, that a brand-new unscripted trade name still composes, and that the overrides replace
everything. `lib/vapi/voice-prompt-qa.test.ts` pins the "how it works" facts, that they render only
for enabled trades, and that the Q&A section does not open a price loophole
(`voice-prompt-qa.test.ts:55-59`).

## Part 2 — the tools the assistant can call

| Tool | Type | Endpoint | Returns |
|---|---|---|---|
| `send_sms_photo_link` | Vapi `function`, `async: false`, `server.timeoutSeconds: 20` | `${PROD_APP_URL}/api/vapi/tools/send-sms-photo-link` | one of three fixed strings the model speaks: sent / already sent / degraded |
| `endCall` | Vapi built-in (`{ type: 'endCall' }`) | n/a | hangs up |

`send_sms_photo_link` takes one optional parameter — `items`, an array of strings naming what to
photograph. It is **logged for context only and does not change the SMS content**
(`scripts/update-vapi-add-photo-tool.mjs:38-47`). The tool's own route is described in
[[Voice Channel (Vapi)]].

Both tools are attached by manual scripts, not by provisioning:

- `scripts/update-vapi-add-photo-tool.mjs` — probes the tool URL first and aborts on a 404, because
  Vapi cannot invoke a route that is not deployed. Idempotent: detects the tool and exits.
  `PROD_APP_URL` defaults to `https://quote-mate-rho.vercel.app`.
- `scripts/update-vapi-end-call-config.mjs` — merges `{ type: 'endCall' }` into the existing tools
  and sets `endCallPhrases` (33 Australian wrap-ups: "no worries thanks", "yeah that's everything",
  "I'll wait for the quote", …), `endCallMessage`, `silenceTimeoutSeconds: 30`,
  `maxDurationSeconds: 600`, and a `messagePlan` with two idle prompts at
  `idleTimeoutSeconds: 12`.

⚠ `lib/vapi/provision.ts` attaches **no tools at all** at create time. `buildAssistantPatch` sets
`endCallFunctionEnabled: true` on every update (`assistant-patch.ts:58`) precisely because "live
assistants had this unset", but nothing in the automated path ever adds `send_sms_photo_link`.

## Part 3 — ⚠ Drift: the live prompt is a different document

The `scripts/update-vapi-*.mjs` family GET the live assistant, string-patch its system message and
PATCH it back. Their verification checks are a de-facto inventory of what is actually deployed:

| Live-prompt marker | Asserted in | In the composed builder? |
|---|---|---|
| `You are Jon` / `I'm Jon, the AI receptionist for QuoteMate` | `update-vapi-rename-jeff-to-jon.mjs:99-100` | **No** — the builder emits "You are the AI phone receptionist for {businessName}" with no name |
| firstMessage `Jon here` + `what's your name` + **no** `Sound good?` | `update-vapi-rename-jeff-to-jon.mjs:101`, `update-vapi-speed-config.mjs:219-220` | **No** — `buildVoiceFirstMessage` ends with "Sound good?" |
| `CONFIRMATION PROTOCOL` | `update-vapi-fix-ev-charger-fields.mjs:100` | No |
| `CLARIFICATION PROTOCOL` (+ "by lights, do you mean", "after TWO clarifying re-asks") | `update-vapi-clarification.mjs:118-122` | No |
| `VERIFICATION PROTOCOL` | `update-vapi-jeff-verify.mjs:192` | No |
| `SPEED RULES` | `update-vapi-speed-config.mjs:214` | No |
| `EV_CHARGER` section | `update-vapi-rename-jeff-to-jon.mjs:104` | No |
| Field-routing directives (`scope.item_count`, `access.ceiling_type`, `property.phase`, `scope.description`) | `update-vapi-fix-ev-charger-fields.mjs:99` | No |
| `send_sms_photo_link` named inside the prompt text | `update-vapi-rename-jeff-to-jon.mjs:108` | No |
| `[tradie name]` placeholder | `update-vapi-rename-jeff-to-jon.mjs:109` | No |
| `═══ CALL TERMINATION` block | appended by `update-vapi-end-call-config.mjs` | No |

The live prompt is organised as ROLE / TONE / CONFIRMATION PROTOCOL / CLARIFICATION PROTOCOL /
SPEED RULES / OPENING / per-job-type question lists with schema field routing / INSPECTION-ONLY /
EMERGENCY OVERRIDE / CLOSING / CALL TERMINATION (`scripts/update-vapi-prompt-confirm.mjs` is the
closest thing to a full copy in the repo). The composed prompt has none of that shape.

### ⚠ The destructive consequence

**Invariant — running the composed-prompt deploy against a hand-patched live assistant OVERWRITES
every one of those sections.** `scripts/deploy-vapi-voice-prompt.mts:180-182` filters out the
existing system message and concatenates the freshly composed one; `sync-vapi-assistants.mts` does
the same for every tenant via `buildAssistantPatch`. Consequences of one such run:

- the persona name Jon disappears from the prompt (the ElevenLabs voice stays);
- the `Sound good?` gate that `update-vapi-speed-config.mjs` was written to delete is reinstated;
- the per-field schema routing (`scope.item_count`, `access.ceiling_type`, …) that the structurer
  relies on is gone;
- CALL TERMINATION, CLARIFICATION and CONFIRMATION protocols are gone;
- the tool itself survives (it lives in `model.tools`, which `buildAssistantPatch` preserves), but
  the prompt text telling the model when to call it does not.

Neither script warns about this. There is no test that compares live prompt to composed prompt;
`scripts/dump-vapi-prompt.mjs` is the only inspection tool and it just prints the live system
message and its char count.

### ⚠ Stale inspection classification: EV charger

The clearest instance of the live prompt lagging the code. The live prompt files `EV_CHARGER` under
`═══ INSPECTION-ONLY (always inspection_required=true)` (`scripts/update-vapi-prompt-confirm.mjs:157`,
`:169`). The repo has deliberately moved the other way:

> EV charger enquiries are a priced, review-required service when the tenant has enabled "Install EV
> charger". Do not make the job name itself an inspection trigger: the enabled service's MUST-ASK
> answers decide the route.
> — `lib/sms/assumptions.ts:374-378`

`lib/sms/assumptions.test.ts:118-128` locks that in, asserting that `ev charger`, `ev charging`,
`electric vehicle charger`, `tesla charger`, `wallbox` and `wall charger` are **not** in
`UNIVERSAL_INSPECTION_TRIGGERS`, while `three-phase` and `switchboard at capacity` still are. The
most recent commit on the branch (`75a64a40 fix(ev-charger)`) is further EV-charger SMS work.

So a customer asking about an EV charger gets a priced service over SMS and an inspection route over
the phone. The composed prompt would fix this (it renders `UNIVERSAL_INSPECTION_TRIGGERS` directly),
but deploying it costs everything in the table above.

A second, already-repaired instance is documented in the repo: `access.notes` was dropped from the
intake schema by hotfix `b3c1856` (2026-05-07) to fit Anthropic's 24-parameter `generateObject`
limit, yet two EV_CHARGER questions in the live prompt kept routing answers there, so "the
structurer silently drops that data". `scripts/update-vapi-fix-ev-charger-fields.mjs` repoints them
at `scope.description`. That is the shape of the failure: a live prompt field name that no longer
exists downstream fails **silently**.

### ⚠ Transcriber drift

`scripts/update-vapi-transcriber.mjs` exists because testers called voice "flakey and inconsistent"
after a Vapi account migration: new accounts default to `nova-2` with generic English and no keyword
boosts, so trade jargon ("downlights", "GPO", "RCD"), Aussie place names and acronyms get
mis-transcribed, which then makes the assistant ask follow-ups or produce garbled scope. The script
sets Deepgram `nova-3` + `en-AU` + ~52 boosted keywords (`downlight:2`, `GPO:3`, `switchboard:2`,
`bollard:1`, …).

Vapi's `keywords` field accepts **single tokens only** — multi-word entries like "power point" or
"Surry Hills" are rejected with HTTP 400, so compound terms are left unboosted and rely on the en-AU
model (`update-vapi-transcriber.mjs:50-55`).

`lib/vapi/provision.ts:74-78` still creates on `nova-2` with no keywords. Every auto-provisioned
tenant starts in the state the script was written to repair.

## Part 4 — the manual tuning scripts, as an inventory

`scripts/update-vapi-jon-tuning.mjs` is the master runner; each child is idempotent and order matters
slightly.

| Order | Script | What it sets |
|---|---|---|
| 1 | `update-vapi-transcriber.mjs` | Deepgram nova-3, en-AU, keyword boosts, endpointing |
| 2 | `update-vapi-end-call-config.mjs` | `endCall` tool, `endCallPhrases`, `endCallMessage`, `silenceTimeoutSeconds`, `maxDurationSeconds`, idle `messagePlan`, CALL TERMINATION prompt block |
| 3 | `update-vapi-speed-config.mjs` | drops the "Sound good?" gate, adds SPEED RULES, caller-ID mobile rule, one-line CLOSING |
| 4 | `update-vapi-stop-speaking-plan.mjs` | `numWords: 2`, `voiceSeconds: 0.3`, `backoffSeconds: 1.5` |

Others outside the runner: `update-vapi-add-photo-tool.mjs`, `update-vapi-clarification.mjs`,
`update-vapi-streamline-readbacks.mjs` (4 readbacks → 1 — name/suburb readbacks dropped, the
scope+specs readback kept because "16 downlights" heard as "6" is a real money mistake),
`update-vapi-prompt-confirm.mjs`, `update-vapi-rename-jeff-to-jon.mjs`,
`update-vapi-fix-ev-charger-fields.mjs`, `update-vapi-server-url.mjs`,
`reroute-legacy-vapi-numbers.mjs`, `patch-vapi-assistants.mjs`.

Diagnostics: `dump-vapi-prompt.mjs`, `inspect-vapi-assistant.mjs`, `check-vapi-phone.mjs`,
`inspect-bad-vapi-ids.mjs`, `simulate-vapi-call.mjs`, `audit-vapi-orphan-calls.mjs`,
`diag-voice-all-tenants.mjs`, `diag-voice-extraction.mts`.

Every one of these targets the single assistant named by `VAPI_ASSISTANT_ID`. There is no
multi-tenant equivalent except `sync-vapi-assistants.mts`, which pushes the *composed* prompt.

## Open questions

- Which live assistants have had the tuning scripts applied, and which are pure
  `provisionVapiAssistant` output? Not recorded in the repo; `scripts/diag-voice-all-tenants.mjs`
  presumably answers it at runtime.
- The intended end state is unresolved: either fold the CONFIRMATION / CLARIFICATION / CALL
  TERMINATION / field-routing sections into `buildVoiceSystemPrompt` so the composed prompt is
  finally safe to push everywhere, or stop composing and treat the live prompt as source of truth.
  Nothing in the repo states which.
- `trade_prompts.voice_greeting` / `voice_system_prompt` is the override hook, but no trade row is
  known here to populate it — whether any live trade uses the override path is unverified.

## Related

- [[Voice Channel (Vapi)]]
- [[Voice to SMS Trade Handover]]
- [[Model and Prompt Inventory]]
- [[LLM Receptionist]]
- [[Grounding and Safe Replies]]
- [[Trades Registry]]
- [[Known Debt Register]]
- [[Intake Structuring]]
