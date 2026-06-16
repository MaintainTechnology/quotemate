# Web-lead → SMS dialog bridge (dialog-first) + dispatch hardening

- **Date:** 2026-06-16
- **Status:** Approved (design) — ready for implementation plan
- **Author:** Claude (pair with Jeph)
- **Area:** marketing web-lead pipeline · SMS dialog engine · estimate dispatch

## Background — what was reported, and what's actually true

A tradie tested the public landing page (`/t/<slug>`), filled the lead form for "6 downlights",
uploaded a photo, hit **Get my quote**, and reported three problems:

1. **"It went straight to a $99 site visit"** instead of giving a real quote.
2. **"It didn't ask any back-and-forth questions"** — it went straight to a result; they
   expected the system to "continue the texting".
3. **In another run** it "went straight to site inspection, didn't even give the link, and the
   quote didn't arrive."

Root-cause investigation (workflow `wf_4fedcd9d-5ec`, plus live Supabase rows) found:

- **The file-store verification node is OFF and is not the cause.** `lib/estimate/kb-verify.ts`
  is gated by `KB_VERIFY_ESTIMATES`, which is unset → it returns `null` before any call and is
  provably inert. The estimator-beta filestore supplement (`lib/estimation/supplement.ts`) only
  corrects PDF-takeoff symbol counts, never prices/routing, and safe-degrades.
- **Symptom 1 is mostly correct behaviour.** The screenshot SMS was from the *Atomic Electrical*
  tenant in production for a **new install, no existing fittings, raked/high ceiling** — a job
  that legitimately needs a site visit (migration 069 lists raked ceiling + no existing switch as
  inspection triggers). The user's own `sparky` tenant most recently produced a full
  Good/Better/Best quote for 6 downlights (intake `0f312b9d` / quote `843c4b98`,
  `routing_decision=tradie_review`, all tiers populated). The engine grounds and prices correctly.
- **Symptom 2 is by design.** The web-lead route (`app/api/t/[slug]/lead/route.ts`) is one-shot:
  one POST → structure once → draft once → send once. The clarifying-question dialog
  (`decideNextTurn`/`extractSlots`) lives only on the SMS inbound path. Web leads are never asked
  follow-ups — and that under-specification is what pushes borderline jobs toward inspection.
  Symptoms 1 and 2 share this root cause.
- **Symptom 3 is a real, fixable fragility.** The customer SMS dispatch in
  `app/api/estimate/draft/route.ts` is fire-and-forget in `after()` with several **silent**
  failure modes: no-recipient skip, Stripe-link-creation failure, review-hold withholding,
  `APP_URL` with a non-null assertion and no origin fallback, a tenant with no FROM number, and
  (most likely in production) the Vercel Hobby 10s timeout killing the function before the SMS
  sends. No retry, no fallback-notify → a quote can vanish without a trace.

## Goal

1. **Make web leads conversational (dialog-first).** Every web-lead submission starts an SMS
   conversation that confirms the captured details and asks only the genuinely missing per-job
   questions, then drafts **one** quote at the end — reusing the existing SMS dialog engine.
2. **Never silently lose a lead or a quote.** Alert the tradie the instant a web lead arrives, and
   harden the estimate dispatch so a send failure is logged and falls back to a tradie notice
   instead of disappearing.

Non-goals: changing the inspection-escalation policy (it is the liability shield and is working);
relaxing the grounding validator; building a new dialog engine; fixing the Vercel-Hobby timeout in
code (infra change — documented only).

## Locked-in decisions

| Decision | Choice |
|---|---|
| When to engage Q&A | **Dialog-first** — every web lead starts an SMS conversation before any quote. |
| Abandoned lead (customer never replies) | **Alert tradie on submit + leave conversation open** in dashboard Chats. **No** auto-quote from partial info. |
| Implementation shape | **Shared `startWebLeadConversation()` helper** in `lib/sms/`. Web route stays thin; customer replies flow through the existing `/api/sms/inbound` unchanged. |
| Photos | Seed the form-collected photos onto the conversation so the dialog never re-asks and they survive to the intake. |
| Rollout safety | New path gated by `WEB_LEAD_DIALOG_ENABLED` (**default on**); flip off to revert to one-shot. |
| Schema | **No migration** — every column needed already exists. |

## Architecture & flow

```
POST /api/t/[slug]/lead  (app/api/t/[slug]/lead/route.ts)
  1. validate form (name, mobile, suburb, description, 1–5 photos)  [unchanged]
  2. upload photos → photoPaths (storage) + photoUrls (signed)      [unchanged]
  3. findOrCreateCustomer(mobile, 'web', tenant.id)                 [unchanged]
  4. Response.json({ ok: true })  → homepage "You're all set, we'll text you"  [instant ack]
  5. after():
       if WEB_LEAD_DIALOG_ENABLED (default):
         startWebLeadConversation({ tenant, form, photoPaths, photoUrls, customer, origin })
       else:
         <legacy one-shot path: structureIntake → insert intake → POST /api/estimate/draft>

startWebLeadConversation()  (lib/sms/start-web-lead-conversation.ts)
  a. dedupe: find an OPEN customer_quote conversation for (from_number, tenant_id); reuse if found
  b. classify job_type from the form description (best-effort; dialog re-confirms)
  c. seed conversation_state.slots from form fields, sources = 'from_transcript'
  d. insert sms_conversations row (see "Seeded row" below) — intake_id stays NULL
  e. insert a synthetic INBOUND sms_messages row carrying the form description (+ photo refs)
  f. decideNextTurn(state, transcript) → first outbound (greeting + first MISSING question,
     or a "sound right?" confirmation if nothing is missing)
  g. dispatch first SMS to the customer FROM the tenant's number  [hardened dispatch]
  h. persist outbound sms_messages row + updated conversation_state + turn_count
  i. notify tradie: buildTradieWebLeadAlert()  → "New web lead — <name>, <suburb>: <desc>…"
  returns { conversationId, reused, firstReply }

Customer replies  →  POST /api/sms/inbound   [UNCHANGED]
  → match conversation by (from_number, tenant_id | to_number) → continue dialog
  → on action='finish' → POST /api/intake/structure
       → structureIntake() creates intakes row; aggregates conversation photo_urls/photo_paths
         onto intakes.photo_paths (structure/route.ts:215-235)
       → links intake_id back onto the conversation
       → POST /api/estimate/draft → runEstimation → quote SMS   [hardened dispatch]
```

**Key invariant:** the web route in dialog-first mode must **not** create an `intakes` row or call
`/api/estimate/draft`. The SMS pipeline owns intake creation; pre-creating it would make the inbound
flow's `!hasExistingIntake` precondition false and break the handoff / duplicate rows.

## Components

### New: `lib/sms/start-web-lead-conversation.ts`
A single focused, HTTP-agnostic function. The web route is its only caller (for now).

- **Input:** `{ tenant, form: { name, mobile, suburb, description }, photoPaths: string[], photoUrls: string[], customer: { id } | null, origin: string }`
- **Output:** `{ conversationId: string, reused: boolean, firstReply: string }`
- **Depends on:** `@/lib/supabase` (service-role client), `decideNextTurn` from `lib/sms/dialog.ts`,
  the slot-seeding helpers from `lib/sms/extract-slots.ts` (`seedStateFromKnownFields` /
  `mergeSlotUpdates` shapes), `dispatchQuoteMessage`/SMS dispatch from `lib/sms/dispatch.ts`,
  a new tradie-alert template, and a job-type classifier (reuse existing `lib/intake/schema.ts`
  `deriveTradeFromJobType` for trade, and a lightweight keyword/LLM job_type guess for the slot).
- **Side effects (all best-effort, logged via `pipelineLog`):** one `sms_conversations` insert (or
  reuse), one synthetic inbound `sms_messages` insert, one outbound `sms_messages` insert, one
  customer SMS, one tradie SMS.

### Changed: `app/api/t/[slug]/lead/route.ts`
The `after()` block branches on `WEB_LEAD_DIALOG_ENABLED`. Default branch calls
`startWebLeadConversation()` and returns. Legacy branch keeps the current
structure→intake→draft code verbatim (so the flag is a true revert).

### New: tradie web-lead alert template — `buildTradieWebLeadAlert()` in `lib/sms/templates.ts`
One short SMS to the tenant owner mobile:
`"New web lead — <first_name>, <suburb>: <short description>. We're texting them now to finalise the quote. — QuoteMate"`.
Sent from the platform/tenant number to `tenant.owner_mobile` (the same recipient the existing
tradie-notify path uses). Best-effort; failure is logged, never throws.

### Changed: `app/api/estimate/draft/route.ts` (dispatch hardening — independent of the bridge)
1. Replace `const appUrl = process.env.APP_URL!` (line 464) with
   `process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? origin` (origin threaded in or read
   from the request) — matches the lead route's existing fallback.
2. Convert the silent skips into explicit `dispatch.warn/err` logs with the quote id and reason:
   no `caller_number`, Stripe-link creation failed, held-for-review, and **no tenant FROM number**.
3. On a customer-send failure (or no-recipient), emit a tradie fallback notice ("couldn't reach the
   customer automatically — quote ready at `<view url>`") so a quote is never lost without a trace.
4. Document (code comment + this spec) that the production Vercel-Hobby 10s timeout requires Pro or
   Railway; code hardening reduces but does not eliminate that class of failure.

## Seeded `sms_conversations` row (no migration — all columns exist)

| Column | Value |
|---|---|
| `from_number` | customer mobile (E.164) |
| `to_number` | `tenant.twilio_sms_number ?? process.env.TWILIO_SMS_NUMBER` |
| `status` | `'open'` |
| `conversation_type` | `'customer_quote'` (migration 016 default; set explicitly) |
| `tenant_id` | `tenant.id` |
| `customer_id` | `customer?.id ?? null` |
| `photo_request_token` | `randomBytes(16).toString('hex')` |
| `photo_urls` | web signed URLs (so the dialog's photo gate is satisfied) |
| `photo_paths` | web storage paths (carried to `intakes.photo_paths` later) |
| `intake_id` | `null` (SMS pipeline sets it on finish) |
| `conversation_state` | `{ slots, sources, last_extracted_at }` — see below |

`conversation_state.slots` seeded from the form: `first_name` (name), `suburb`, `job_type`
(classified from description), and `count`/`room` when extractable. Every seeded slot's
`sources[key] = 'from_transcript'` so the dialog treats them as freshly stated (echo-back +
customer-correctable) and asks only the missing per-job MUST-ASK fields. The synthetic inbound
`sms_messages` row carries the raw description so the dialog and the later `structureIntake` have
full context.

## Error handling

- Every DB write and SMS send in `startWebLeadConversation` is wrapped and logged; a failure at any
  step logs the reason and does not throw out of the `after()` block (the homepage already acked).
- If `decideNextTurn` errors, fall back to a fixed first-question SMS ("Thanks <name> — got your
  request for <desc>. Quick question to price it accurately: …") so the customer still hears back.
- If the tenant has no usable FROM number and `TWILIO_SMS_NUMBER` is also unset, skip the customer
  SMS but still fire the tradie alert and log a clear error (the lead is not lost).
- Dedupe prevents duplicate conversations on double-submit; the existing inbound idempotency
  (10-min intake window) prevents duplicate intakes downstream.

## Testing

- **Unit (`lib/sms/start-web-lead-conversation.test.ts`, vitest, Supabase + dispatch mocked):**
  seeded-row shape (incl. `conversation_type`, photo seeding, slot `sources='from_transcript'`),
  dedupe reuse path, FROM-number fallback, `decideNextTurn` error → fixed-question fallback, tradie
  alert fired, and the invariant that **no intake is created / no `/api/estimate/draft` call** is
  made.
- **Unit (job-type classification):** form description → `job_type` slot mapping for the common
  electrical/plumbing jobs (downlights, power_points, hot_water, blocked_drain).
- **Unit (dispatch hardening, `app/api/estimate/draft` send path):** `APP_URL` fallback resolves
  links from origin; each silent-skip branch now emits a log; customer-send failure triggers the
  tradie fallback notice.
- No live SMS/LLM in tests. A manual `scripts/` smoke against the dev tenant is optional follow-up.

## Risks / constraints

- **Tenant SMS number required for clean two-way threading.** `sparky` has only a Vapi number; in
  dev the send falls back to the shared `TWILIO_SMS_NUMBER` and inbound matching leans on the
  `to_number` fallback. Add a clear warning log when a tenant has no `twilio_sms_number`; production
  tenants must be provisioned (Twilio provisioning is the v6 onboarding path).
- **Vercel-Hobby 10s timeout** can still kill heavy `after()` work in production — needs Pro or
  Railway. Documented, not code-fixed here.
- **Flag default.** `WEB_LEAD_DIALOG_ENABLED` defaults on per decision; flip off to revert to the
  one-shot path with zero data changes.

## Out of scope

- Inspection-policy / grounding-validator changes.
- Activating `KB_VERIFY_ESTIMATES` (leave off; `apply` mode is the only risky setting).
- Multi-step web form fields (we chose the SMS dialog instead).
- A reminder/nudge SMS to quiet customers (possible future enhancement).
