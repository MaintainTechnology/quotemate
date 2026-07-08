# Send a drafted quote to the customer via SMS or email (with PDF) from the dashboard quote viewer

## Goal

A tradie viewing any quote at `/dashboard/quote/[token]` can send (or resend) that quote to the
customer by SMS and/or by email with the quote PDF attached, in one click. Why: today the send
machinery only fires automatically inside the pipeline (or via the one-tap approve link for
review-held quotes) — there is **no manual send control anywhere in the dashboard**, so a quote
like Jon's $31k roofing quote can be drafted and viewed but never reach the customer.

## Role

Principal engineer on QuoteMate. Act autonomously on reversible edits; follow existing repo
conventions (result unions, pure-policy extraction, chainable-builder route tests, best-effort
side effects, AU English, no emoji).

## Context (all claims verified in code)

- **The viewer**: `quotemate-automation/app/dashboard/quote/[token]/page.tsx` loads a `quotes` row
  by `share_token` (service role), resolves the trade adapter, and renders
  `QuoteReportViewerClient.tsx` — a toolbar (Edit Report · Download PDF · Edit with AI) + report
  iframe. **No send control exists.** The registry (`lib/quote/report-adapters/registry.ts`) gives
  electrical/plumbing/solar/roofing/painting/commercial_painting `manualEdit: true`, so
  `TradieEditor` mounts and resolves ownership for all live trades including roofing.
- **SMS send machinery already exists** in `app/api/quote/[id]/approve/route.ts` (mig 078): auth
  via `resolveTenantRequest` (dual Clerk/Supabase bearer), ownership check, caller-number lookup,
  `/r/`-gated pay links, `ensureQuotePdf(id, { regenerate: true })`, price-hold refresh
  (`computePriceHoldUntil`), `buildQuoteSms(...)` + `dispatchQuoteWithPdf(...)` (MMS best-effort),
  `advanceQuoteStatus(supabase, id, 'sent')`, best-effort `quote_followup_events` insert. **But it
  only sends when `status === 'awaiting_tradie_approval'`** — every other status is a no-op — and
  it has no UI trigger in the dashboard (the link arrives by SMS notification only).
- **Phone resolution**: the approve route uses a 2-source chain (sms_conversations → calls). The
  edit route (`app/api/quote/[id]/edit/route.ts:645-705`) uses the fuller 4-source chain
  (intake.caller.phone → sms_conversations.from_number → calls.caller_number → customers.phone),
  added after a real prod miss ("no phone resolvable" 2026-05-28). The 4-source chain is the
  correct one to share.
- **Email**: `lib/email/resend.ts` `sendEmail()` posts to the Resend REST API and returns a result
  union — **it has no attachment support** (Resend's API accepts
  `attachments: [{ filename, content }]`, content base64). `lib/quote/pdf.ts` already exports
  `downloadQuotePdf(path): Promise<Buffer>` and `quotePdfUrl(shareToken)`. Customer email lives at
  `intake.caller.email` (optional, `lib/intake/schema.ts:98`) and `customers.email`.
- **Lifecycle**: `lib/quote/lifecycle.ts` — canonical ladder draft→sent→viewed→paid→accepted,
  monotonic `advanceQuoteStatus` never throws; `awaiting_tradie_approval` ranks -1 (freely
  advanceable).
- **Client auth**: `getAuthToken()` from `lib/auth/client-token.ts` (already imported by the
  viewer); requests carry `Authorization: Bearer <token>` (pattern in `TradieEditor.tsx:178,336`).
- **Test conventions**: pure policy extracted to lib with direct unit tests (e.g.
  `lib/quote/notify-policy.ts`); route handlers tested with the hoisted chainable-builder Supabase
  mock (e.g. `app/api/quote/[id]/complete/route.test.ts`); `lib/email/resend.test.ts` stubs global
  fetch.
- **Gates**: `npm test` = `vitest run --testTimeout=20000`; `npm run typecheck` = `tsc --noEmit`.
  There is **no** `npm run check` script. E2E = `npm run test:e2e` (Playwright), not used as a gate
  here (see Constraints).

## Task

1. **`quotemate-automation/lib/quote/send-customer.ts`** (new; pure policy + injected-client
   resolver, one module):
   - `canSendQuote(status: string | null | undefined): { ok: true } | { ok: false; reason: string }`
     — pure. Deny `paid` and `accepted` (customer already committed); allow everything else
     (draft, sent, viewed, awaiting_tradie_approval, legacy/unknown — resend is legitimate).
   - `resolveCustomerContact(supabase, args: { caller: { phone?: string; email?: string } | null; intakeId: string | null; callId: string | null; customerId: string | null })`
     → `{ phone: string | null; email: string | null }`. Phone = the edit route's 4-source chain
     (intake.caller.phone → sms_conversations.from_number by intake_id → calls.caller_number by
     call_id → customers.phone by customer_id), empty strings treated as missing. Email =
     intake.caller.email → customers.email. Never throws; missing tables/rows resolve to null.
   - `buildQuoteEmail(args: { businessName: string | null; customerName: string | null; jobType: string | null; quoteUrl: string; pdfAttached: boolean })`
     → `{ subject, html, text }` — pure. Plain, branded-light HTML: greeting by first name (or
     "Hi there"), one sentence naming the business + job, a prominent "View your quote" link to
     `quoteUrl`, a line noting the attached PDF only when `pdfAttached`. AU English, no emoji.
2. **Extend `lib/email/resend.ts`**: add optional
   `attachments?: Array<{ filename: string; content: string }>` (content = base64) to
   `SendEmailOptions`, passed through to the Resend request body only when non-empty. No other
   behaviour change.
3. **`app/api/quote/[id]/send/route.ts`** (new): `POST` with JSON body
   `{ channel: 'sms' | 'email', to?: string }`.
   - Auth + ownership exactly like the approve route (`resolveTenantRequest` with
     `'id, twilio_sms_number, business_name'`; 401 / 403 / 404 / `unscoped_quote` 403).
   - 400 `invalid_channel` unless channel is `sms` or `email`.
   - Status gate via `canSendQuote` → 409 `{ error: 'not_sendable', reason }`.
   - Load intake (`id, caller, suburb, job_type, scope, call_id, customer_id, trade`) and
     pricing_book (`quote_display, gst_registered, quote_tier_mode`) like approve.
   - Recipient: `to` (trimmed, non-empty; for email must match `/.+@.+\..+/` → else 400
     `invalid_recipient`) else `resolveCustomerContact(...)`; missing → 400 `no_customer_phone` /
     `no_customer_email` with a human message.
   - **SMS path** = the approve route's send tail, reused verbatim in behaviour: display mode +
     tier mode resolution, `/r/`-gated pay links, deposit pct default 30,
     `ensureQuotePdf(id, { regenerate: true })` unless `needs_inspection`, price-hold restamp
     before building the body, `buildQuoteSms` + `dispatchQuoteWithPdf` (from = tenant Twilio
     number else `TWILIO_SMS_NUMBER`). Dispatch failure → 502 `dispatch_failed` (status
     untouched). Success → `advanceQuoteStatus(supabase, id, 'sent')`, best-effort
     `quote_followup_events` insert (`outcome: 'sent_to_customer'`, note naming the channel),
     `{ ok: true, channel, sid, status: 'sent' }`.
   - **Email path**: the same price-hold restamp as the SMS path (an emailed quote link must not
     arrive already expired at the /r + booking gates); `ensureQuotePdf(id, { regenerate: true })` unless `needs_inspection`; if a
     path came back, `downloadQuotePdf` → base64 attachment `quote-<first 8 of share_token>.pdf`
     (a render/download failure degrades to a link-only email — never blocks the send);
     `buildQuoteEmail` (quoteUrl = `${APP_URL}/q/<share_token>`; APP_URL default
     `https://www.quotemax.com.au` as in approve); `sendEmail` with
     `replyTo: resolved.identity.email ?? undefined`. Failure union → 502 `email_failed` with the
     reason. Success → same advance + followup event, `{ ok: true, channel, messageId, status: 'sent' }`.
4. **Refactor `app/api/quote/[id]/approve/route.ts` phone lookup only**: replace its 2-source
   caller-number block with `resolveCustomerContact(...).phone` (a strict superset — closes the
   same "number on file but not found" gap the edit route already fixed). No other approve
   behaviour changes.
5. **UI — `app/dashboard/quote/[token]/SendQuotePanel.tsx`** (new client component) mounted in the
   `QuoteReportViewerClient` toolbar:
   - A "Send to Customer" toolbar button (accent style, matching existing button classes) that
     toggles an inline panel below the toolbar. Disabled with a title tooltip when `paid`.
   - Panel: an SMS row (phone on file displayed read-only when present, else a phone input) with a
     "Send SMS" button; an email row (input prefilled with email on file) with a "Send Email (PDF
     attached)" button; per-row pending/disabled state, success ("Sent ✓ …" in text, no emoji —
     use words) and error messages surfaced from the API (`message` field when present). Buttons
     POST to `/api/quote/<quoteId>/send` with `Authorization: Bearer ${await getAuthToken()}`;
     401/403 render "Sign in as the quote owner to send."
   - Props: `quoteId`, `customerPhone`, `customerEmail`, `paid`. Keep it self-contained; no new
     dependencies.
6. **Thread contact props**: in `page.tsx`, widen the intake select to
   `trade, job_type, caller, call_id, customer_id`, call `resolveCustomerContact` with the
   service-role client, pass `customerPhone` / `customerEmail` into `QuoteReportViewerClient`,
   which forwards them (plus `quoteId`, `paid`) to `SendQuotePanel`.

## Constraints

- Do not touch the edit route's inline phone chain, the SMS pipeline, or the estimator. Do not
  rebuild templates — `buildQuoteSms` is the SMS body, unchanged.
- Currency/copy: AU English; no emoji in customer-facing copy (design system).
- The route must never send when status is `paid`/`accepted`; a send from
  `awaiting_tradie_approval` is an intentional release (the tradie is the approver).
- Best-effort side effects (PDF, followup event, ingest) must never fail the send response;
  dispatch/email failure must not advance status.
- Verification must not text or email a real customer: dev `.env.local` holds live Twilio/Resend
  keys. /verify + Playwright exercise the UI and the endpoint's auth/validation surface only
  (unauthenticated 401, invalid channel 400) — no authenticated live dispatch.
- No new npm dependencies. Keep `sql/` untouched — no schema change is needed.

## Acceptance criteria & gates

- **A1** `lib/quote/send-customer.test.ts`: `canSendQuote` denies paid/accepted, allows
  draft/sent/viewed/awaiting_tradie_approval/null/legacy; `resolveCustomerContact` walks all four
  phone sources in order, treats `''` as missing, resolves email from caller then customers, never
  throws on query errors; `buildQuoteEmail` subject names the business, html contains the quote
  URL, PDF line present only when `pdfAttached`.
- **A2** `lib/email/resend.test.ts` (extended): attachments array is included in the POSTed body
  when provided and absent otherwise; existing tests unchanged and passing.
- **A3** `app/api/quote/[id]/send/route.test.ts` (chainable-builder mock, dispatch/pdf/email
  mocked): 401 no token; 403 wrong tenant; 404 unknown quote; 409 paid quote; 400 invalid
  channel; 400 no phone on file (sms, no override); SMS happy path → dispatch called with resolved
  number + tenant from-number, status advanced to 'sent'; dispatch failure → 502 and **no**
  advance; email happy path → sendEmail called with attachment + recipient override respected,
  status advanced; email with no address anywhere → 400.
- **A4** Approve route still compiles and its phone lookup goes through
  `resolveCustomerContact` (covered by typecheck + A1; approve has no existing test file).
- **Gates (every iteration, all must pass):** `npm test`, `npm run typecheck` — run from
  `quotemate-automation/`. UI gate: Playwright(-cli) drives `/dashboard/quote/<token>` on the dev
  server — Send to Customer button renders, panel opens, rows show the on-file contact state, and
  an unauthenticated send renders the sign-in message (no live dispatch).

## Examples

<example>
`app/api/quote/[id]/approve/route.ts` — the exact send tail to reuse for the SMS path (display
mode, pay links, ensureQuotePdf regenerate, hold restamp, buildQuoteSms, dispatchQuoteWithPdf,
advanceQuoteStatus, followup event).
</example>
<example>
`app/api/quote/[id]/complete/route.test.ts` — the hoisted chainable-builder Supabase mock +
partial module mock pattern the new route test must follow.
</example>
<example>
`lib/quote/notify-policy.ts` + `.test.ts` — the pure-policy extraction convention for
`canSendQuote` / `buildQuoteEmail`.
</example>
<example>
`app/api/quote/[id]/edit/route.ts:645-705` — the authoritative 4-source phone chain to lift into
`resolveCustomerContact` (including the `'' → null` trim rule and priority order).
</example>
