# AI Chat-Edit Quote — Spec

> Status: ready to build · Trade scope v1: electrical + plumbing · Surface: `/q/[token]`
> Source: meeting feature #9 ("edit the PDF via an AI chat box before downloading"), grounded against the live codebase 2026-06-25.

## Objective

Let a tradie edit a live quote by typing plain English instead of hand-filling a
form. On the quote page the tradie already views (`/q/[token]`), add an
owner-only chat box: the tradie types a change ("add a second downlight to
Better", "drop the smoke-alarm line", "bump labour by an hour"), an AI turns it
into a **proposed, catalogue-grounded** edit to the Good/Better/Best line items,
shows it as a reviewable diff, and on one explicit **Save** the change runs
through the existing edit pipeline — which recomputes totals, re-issues Stripe
deposit links, **regenerates the PDF**, and (optionally) re-notifies the
customer. The goal is to make quote revisions faster while keeping the same
money-safety and human-in-loop guarantees the form editor already enforces.

This is for the **tradie** (the quote's owner), not the customer.

## Context / background

The meeting framed this as "there's already an AI PDF chatbot; the tradie types
what to change and it regenerates." Two of those premises are wrong, and this
spec is grounded in the actual code (the project `CLAUDE.md` is stale — it claims
"PDF — None", which is false):

- **PDF generation already exists.** HTML→PDF via Gotenberg. `lib/quote/pdf.ts`
  exposes `ensureQuotePdf(quoteId, { regenerate? })`, `downloadQuotePdf`,
  `quotePdfUrl`, `signQuotePdfUrl`; the HTML template is `lib/quote/report-html.ts`;
  the customer download route is `app/api/q/[token]/pdf/route.ts` (GET, token =
  `quotes.share_token`, lazy-renders on first hit). "Regenerate the PDF" is a
  one-line call that the edit endpoint already makes.
- **The existing chatbots are read-only and are NOT the thing to extend.**
  `app/dashboard/_components/EstimatorChatbot.tsx` + `app/api/filestore/chat/route.ts`,
  and the FilesTab "Ask your documents" chat, answer questions via Gemini File
  Search. None of them mutate a quote. The `lib/sms/dialog.ts` SMS dialog is
  backend receptionist logic, not a UI chat box. A write-capable NL→edit bridge
  does not exist yet — that is the work this spec describes.
- **The real edit path is structured.** Today the tradie edits via the form modal
  `app/q/[token]/TradieEditor.tsx`, which POSTs structured tiers to
  `app/api/quote/[id]/edit/route.ts`. That endpoint recomputes subtotals,
  re-grounds, re-issues Stripe sessions for changed tiers, calls
  `ensureQuotePdf(quoteId, { regenerate: true })`, and runs the `notify_customer`
  confirm flow. **This feature is a natural-language front-end onto that exact
  path** — it must not replace the validation, Stripe, or PDF logic, only feed it.
- **Money is grounded by a hard backstop.** `app/api/quote/[id]/edit/route.ts`
  runs `validateQuoteGrounding` + `detectCrossTierDuplicates`
  (`lib/estimate/validate.ts`) against catalogue candidates from
  `loadCandidatePrices` (`lib/estimate/run.ts`), scoped to the intake's `trade`.
  Ungrounded edits return HTTP 422 with `failures[]`, unless `force: true` (which
  persists but stamps a `tradie_edit_ungrounded:*` risk flag for audit). Per
  `CLAUDE.md`, every money-touching LLM step is tool-calling/catalogue-grounded
  only — never free-form prices.

### Locked design decisions (from the spec interview)

| Decision | Choice |
|---|---|
| Surface | `/q/[token]` (where `TradieEditor` mounts); owner-gated; customer/non-owner view untouched. |
| Interaction model | Propose → review diff → one explicit Save. Human-in-loop; no auto-apply. |
| Catalogue reach for AI proposals | Any `shared_assemblies` / `shared_materials` row for the quote's trade, plus `tenant_custom_assemblies` and `pricing_book` rates. Fully grounded. |
| Edit scope | Full edits: add lines, remove lines, change quantity, change grounded price, edit labels/descriptions/timeframes, across all three tiers. |

## Requirements

The reviewable units the build must satisfy. Each is intended to be specific
enough that two builders would produce the same thing.

### Chat-edit endpoint (propose-only)

1. Create `POST /api/quote/[id]/chat-edit`. It **proposes** an edit and persists
   nothing — no DB write, no Stripe call, no PDF render, no SMS.
2. Reuse the auth + ownership guard pattern from `app/api/quote/[id]/edit/route.ts`:
   `Authorization: Bearer <supabase-access-token>` → `supabase.auth.getUser(token)`
   → load the quote → load its tenant → require `tenant.owner_user_id === userId`.
   Any other authenticated user, or anon, gets `403`.
3. Apply the same pre-conditions the edit endpoint enforces, with the same status
   codes and machine-readable `error` strings: `paid_at` set → `409
   quote_already_paid`; `needs_inspection` true → `409
   cannot_edit_inspection_quote`; `pricing_book` missing `hourly_rate` or
   `default_markup_pct` → `409 pricing_book_misconfigured`.
4. Request body: `{ instruction: string (1..1000 chars), currentTiers?: { good?, better?, best? } }`.
   When `currentTiers` is supplied, the AI edits exactly those (what the tradie
   sees on screen); when omitted, the endpoint loads `good`/`better`/`best` from
   the quote row and edits those.
5. The AI step calls Claude with **tool-calling only for prices**. Give it the
   same catalogue-lookup tools the draft path uses (`lib/estimate/tools.ts`, which
   reads `shared_assemblies` + `shared_materials` + `tenant_custom_assemblies`)
   plus the tenant's `pricing_book` rates, all scoped to the quote's `trade`
   (from `intakes.trade`, falling back to `pricing_book.trade`).
6. Every `unit_price_ex_gst` in the proposal must come from a catalogue tool
   result, a `pricing_book` rate, or a line already present on the quote. The AI
   must never emit an invented/free-form price. If an instruction needs a price
   that cannot be grounded, the corresponding `diff` line is returned with
   `grounded: false` and a `reason`, and the proposal's `anyUngrounded` is `true`
   — the AI does not silently substitute a guess.
7. Response (HTTP 200): the proposed tiers in the **exact shape
   `POST /api/quote/[id]/edit` already accepts** plus diff metadata —
   ```json
   {
     "ok": true,
     "assistantMessage": "string — plain-English summary of the proposed change",
     "proposedTiers": {
       "good":  { "label": "...", "timeframe": "...", "line_items": [ /* {description, quantity, unit?, unit_price_ex_gst} */ ] },
       "better": { /* ... or omitted if unchanged */ },
       "best":  { /* ... or omitted if unchanged */ }
     },
     "diff": [
       { "tier": "good|better|best", "op": "add|remove|change",
         "description": "string",
         "oldUnitPriceExGst": 0, "newUnitPriceExGst": 0,
         "oldQuantity": 0, "newQuantity": 0,
         "grounded": true, "reason": "string (present when grounded=false)" }
     ],
     "anyUngrounded": false
   }
   ```
8. The endpoint declares `runtime = 'nodejs'`, `dynamic = 'force-dynamic'`, and
   `maxDuration = 300` (Opus + tool-calling is slow; match the edit route).
9. Validation errors return `400` with the same envelope the codebase uses
   (`{ ok: false, error: '...' }`); invalid JSON → `400 invalid_json`; empty or
   missing `instruction` → `400`.

### Apply path (reuse, do not rebuild)

10. "Apply & save" POSTs the chosen `proposedTiers` to the **unchanged**
    `POST /api/quote/[id]/edit`. The chat feature must not duplicate the edit
    endpoint's grounding, subtotal recompute, Stripe re-issue, PDF regeneration,
    or notify logic.
11. The existing `notify_customer` confirm step is preserved: after the tradie
    accepts a proposal, they pick "Send update · full quote SMS" or "Save quietly
    · no SMS", exactly as `TradieEditor` does today.
12. If `/edit` returns `422 grounding_failed`, the chat surfaces the `failures[]`
    back to the tradie (which lines failed and why) and offers two resolutions:
    edit the numbers to a catalogue price and retry, or explicitly re-submit with
    `force: true` (which the tradie must consciously choose, mirroring the
    endpoint's documented behaviour and stamping the `tradie_edit_ungrounded`
    risk flag).

### Chat UI

13. Add an owner-gated chat box to the `/q/[token]` page — either inside
    `app/q/[token]/TradieEditor.tsx` or a sibling component mounted from the same
    page — reusing the existing owner check (`/api/quote/[id]/check-owner`). It
    renders nothing for non-owners and for the customer.
14. Style it consistent with the Maintain dark theme and the existing
    `EstimatorChatbot.tsx` (panel/border tokens, accent `#FF5F00`).
15. The thread shows: the tradie's instruction, the assistant's
    `assistantMessage`, and the `diff` rendered as a human-readable change list
    (per tier: added/removed/changed lines with old→new price/qty, and a clear
    badge on any `grounded: false` line).
16. The tradie can send follow-up instructions to refine the proposal before
    saving (the latest proposal becomes the working set). Saving applies the
    current working set via requirement 10; `router.refresh()` runs on success so
    the page tiers, headline total, Stripe buttons, and the "Download PDF" link
    (`/api/q/[token]/pdf`) reflect the change.
17. Loading, empty, and error states are handled (request in flight, no
    instruction yet, endpoint/network error) without throwing — degrade to a
    friendly message like the existing chatbot does.

## Non-goals

- **Other trades.** Roofing, solar, residential/commercial painting, aircon, and
  signage quotes are out of scope for v1 — they have separate PDF routes
  (`/api/q/{roof,solar,paint,plan}/[token]/pdf`) and different quote shapes. v1
  is electrical + plumbing Good/Better/Best only.
- **Auto-apply.** The AI never persists an edit without an explicit tradie Save.
- **Reimplementing the pipeline.** No new grounding logic, Stripe code, PDF
  renderer, or notify path — the chat-edit endpoint proposes; `/edit` does the
  writing.
- **Customer-facing chat.** The customer never sees or uses this chat box. The
  read-only "ask about this estimate" chatbots are unchanged.
- **Conversational memory across sessions / quotes.** The chat is scoped to one
  quote; no persistent thread history requirement beyond the current page session.
- **Editing inspection ($99) or paid quotes.** Explicitly refused (see edge cases).
- **Changing the customer's `share_token` / quote URL.** The URL is stable; only
  the contents and deposit links change (same guarantee as `TradieEditor`).

## Constraints

- **Stack:** Next.js 16 App Router (`quotemate-automation/`), React 19, Vercel AI
  SDK v6 (`ai`, `@ai-sdk/anthropic`) calling Claude directly via
  `ANTHROPIC_API_KEY`. Before writing code, read `quotemate-automation/AGENTS.md`
  and the relevant guide under `quotemate-automation/node_modules/next/dist/docs/`
  — Next 16 has breaking changes vs. training-data knowledge.
- **Money-safety (hard rule):** money-touching LLM output is tool-calling /
  catalogue-grounded only; the grounding validator in `lib/estimate/validate.ts`
  is the backstop; inspection-fallback is the safe failure mode. The chat-edit
  endpoint must not weaken any of this.
- **Auth:** Bearer Supabase access token; ownership = `tenants.owner_user_id`.
  Server routes use the service-role key (RLS bypassed), so tenancy is enforced in
  the route, exactly like `/edit`.
- **Currency:** stored ex-GST, displayed inc-GST; GST treatment comes from
  `pricing_book.gst_registered`. Line items live denormalized in
  `quotes.good/better/best` jsonb — there is no normalized `quote_line_items` use.
- **Trade scoping:** candidates and prompts are scoped by `trade` everywhere; an
  electrical quote must validate only against electrical catalogue rows.
- **Model:** use the project's configured Anthropic model for money/estimation
  steps (Opus tier, consistent with `lib/estimate`), not the cheap dialog model —
  grounded pricing is the priority over latency.
- **Vercel runtime:** Opus + tool-calling exceeds Hobby's 10s limit; the route
  needs `maxDuration = 300` and Pro/Railway to run in production (same as `/edit`).

## Edge cases to handle

- **Non-owner / anon hits `chat-edit`** → `403 not_owner` (or `401` if no/!valid
  Bearer); chat box never renders for them anyway.
- **Quote already paid (`paid_at` set)** → `409 quote_already_paid`; chat shows
  "this quote is paid and can't be edited".
- **Inspection-required quote (`needs_inspection`)** → `409
  cannot_edit_inspection_quote`; chat explains it's a flat $99 with no tiers.
- **Misconfigured `pricing_book`** (missing `hourly_rate`/`default_markup_pct`) →
  `409 pricing_book_misconfigured`; chat tells the tradie to fix the Pricing tab.
- **Instruction needs an ungroundable price** (e.g. "add a $5 callout" under the
  `call_out_minimum`) → proposal returns that line `grounded: false` + reason,
  `anyUngrounded: true`; on Save, `/edit` returns `422` and the chat surfaces the
  failures with correct-or-force options.
- **Instruction would empty a tier** ("remove every line from Good") → the
  proposal keeps at least one line per tier (the edit endpoint/schema requires
  ≥1 line item); chat explains a tier can't be emptied.
- **Ambiguous instruction** ("make it cheaper") → the assistant asks a
  clarifying question rather than guessing a number, and proposes nothing until
  the tradie specifies.
- **Instruction targets a tier that doesn't exist on the quote** → assistant says
  which tiers exist and proposes only against those (the edit endpoint rejects
  `cannot_edit_missing_tier`).
- **Cross-tier duplicate introduced** (same catalogue item at differing
  quantities across tiers with no scope framing) → `/edit`'s
  `detectCrossTierDuplicates` flags it on Save; chat surfaces it like any other
  grounding failure.
- **AI returns malformed/empty JSON** → endpoint returns a `502`-style "couldn't
  draft a change, try rephrasing"; chat degrades gracefully, no crash.
- **Concurrent edit** (tradie edited via the form modal between proposal and
  Save) → Save still goes through `/edit` against current DB state and recomputes
  from the submitted tiers; the page `router.refresh()` reconciles. (No optimistic
  lock required for v1; document the behaviour.)
- **Stripe session re-issue partially fails** → handled by `/edit` as today (it
  logs and continues for the failed tier); chat reports success/failure from the
  `/edit` response unchanged.

## Definition of done

- [ ] `POST /api/quote/[id]/chat-edit` exists, requires owner Bearer auth, and
      returns `401/403` for non-owners/anon.
- [ ] The endpoint persists nothing: no DB write, Stripe call, PDF render, or SMS
      occurs on a `chat-edit` request (verifiable by inspection + a test asserting
      no mutation).
- [ ] A grounded instruction (e.g. "add a second downlight install to Better")
      returns a correct `proposedTiers.better` with the new catalogue-priced line
      and a matching `diff` entry; applying it via `/edit` updates the Better
      subtotal, `total_inc_gst`, re-issues only the Better Stripe link, and
      regenerates the PDF so `/api/q/[token]/pdf` shows the new line and total.
- [ ] An ungroundable instruction is returned with `anyUngrounded: true` and a
      `grounded: false` diff line; it cannot be silently persisted — Save yields
      `/edit` `422`, and only an explicit `force` resubmit persists it (with the
      `tradie_edit_ungrounded` risk flag stamped).
- [ ] Paid quotes, inspection quotes, and misconfigured-pricing_book quotes are
      each refused with the documented `409` and a clear chat message.
- [ ] The chat box renders only for the quote owner on `/q/[token]`; the customer
      and non-owner views are byte-for-byte unchanged.
- [ ] The tradie can send a follow-up instruction to refine a proposal before
      saving, and the `notify_customer` confirm step (send SMS vs. save quietly)
      is preserved on Save.
- [ ] After a successful Save, the page reflects new tier subtotals, headline
      total, Stripe buttons, and the regenerated downloadable PDF without a manual
      reload.
- [ ] No new free-form pricing path is introduced: a unit test feeds an
      "add a cheap line" instruction with the price tools mocked and asserts the
      endpoint never returns a price absent from the catalogue/`pricing_book`.
- [ ] Tests pass: unit (NL→patch never leaks an ungrounded price; diff-builder
      correctness), integration (`chat-edit` → `/edit` round-trip on a seeded
      electrical quote asserting subtotal, `total_inc_gst`, Stripe re-issue, PDF
      regeneration), and guard tests (non-owner 403, paid 409, inspection 409,
      ungrounded 422-then-force). The exact run command is documented in the PR.
- [ ] `runtime = 'nodejs'` and `maxDuration = 300` are set on the new route.

## Open questions

- **Diff granularity in the UI.** Is a per-line "added/removed/changed (old→new)"
  list enough, or do we want a side-by-side before/after of each full tier? (v1
  assumes the per-line list; revisit if tradies find it hard to read.)
- **Follow-up turns vs. fresh proposals.** When the tradie sends a second
  instruction, does it build on the current proposal (assumed) or start from the
  saved quote again? Confirm the "build on current working set" behaviour is what
  tradies expect.
- **Telemetry.** Should we log accepted vs. abandoned proposals and grounding-fail
  rates to evaluate the feature? (Out of scope for the build, but worth a flag.)
- **Doc drift (separate task).** `CLAUDE.md` still says "PDF — None"; it should be
  corrected so the next engineer isn't misled. Tracked outside this spec.
