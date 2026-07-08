# Restore quote confirmation & send-to-customer actions (dashboard) and make roofing "Reply to book" CTAs live

## Goal

A tradie looking at any quote in the dashboard Quotes tab sees a working **Confirm & Send / Send
to Customer** action next to the "Awaiting your review" badge, and a customer on the roofing quote
page can actually act on the tier CTAs instead of seeing dead "Reply to book" pills. Why: after
the UI redesign these affordances were dropped — quotes tagged "Awaiting your review" have no
confirm button and the roofing tier CTAs render as non-interactive labels (transcript issues A–D,
25:36–34:20).

## Role

Principal engineer on QuoteMate. Act autonomously on reversible edits; follow repo conventions
(pure policy in `lib/` with direct unit tests, node-only vitest — **no jsdom/component tests**,
chainable-builder route mocks, AU English, no emoji, square-corner Command Centre design system).

## Context (all claims verified in code, 2026-07-09)

State of each transcript issue in the current working tree:

- **Issue C (send to customer) — already built for the PDF viewer, missing from the Quotes tab.**
  `app/api/quote/[id]/send/route.ts` exists (SMS + email w/ PDF, owner-auth, `canSendQuote` gate,
  lifecycle advance) and `app/dashboard/quote/[token]/QuoteReportViewerClient.tsx:189` mounts
  `SendQuotePanel` in its toolbar. But the **dashboard Quotes tab detail pane** — `QuoteDetail` in
  `app/dashboard/page.tsx` (~line 8673), whose pinned action bar (~8941–8985) has View customer
  page / Copy deposit link / View PDF·Edit / Download PDF / Delete — has **no send control at
  all**.
- **Issue A (confirmation button missing).** `quoteBadges()` (`app/dashboard/page.tsx:8541`) shows
  "Awaiting your review" for every pre-`sent` status, but no confirm action exists anywhere in the
  pane. The send endpoint explicitly treats a manual send from a held quote as the tradie's
  approval (`canSendQuote` in `lib/quote/send-customer.ts` allows every pre-payment status; route
  comment "a send from a held quote is the tradie's approval"), so **one panel serves both A and
  C** — labelled "Confirm & Send" pre-send, "Send to Customer" for a resend.
- **Issue B (Reply-to-Book dead).** `app/q/roof/[token]/page.tsx` builds tier cards with
  `ctaLabel: 'Reply to book' / 'Reply to confirm'` and **`ctaHref: null`** (lines ~369, 391, 433);
  `TierCards` (`app/q/_chrome/parts.tsx:408-416`) renders a null-href CTA as a non-interactive
  grey div, and `QuoteChrome`'s sticky bar (`QuoteChrome.tsx:158-163`) renders **no CTA at all**
  when `ctaHref` is null. Meanwhile the same page already renders the real money action directly
  below the tiers: `<AcceptBlock … />` (line ~664, "Accept & book $99 site visit", mig 165), whose
  `<section>` (`app/q/_chrome/AcceptBlock.tsx:61`) has **no `id`** to anchor to. When the confirm
  gate hides prices, the tier CTA is "Reply YES to see prices" — the gate genuinely opens by SMS
  reply, and the page loads `identity` via `loadTenantIdentity` (`lib/quote/tenant-identity.ts`),
  which does **not** currently expose the tenant's `twilio_sms_number`.
- **Issue E (edit banner) — already restored.** `TradieEditor` (`app/q/[token]/TradieEditor.tsx`)
  portals a floating "Tradie · {business}" banner to `document.body` (portal fix comment lines
  161–167) unless `hideBanner`; `/q/[token]/page.tsx:823` mounts it banner-on. Nothing to build —
  verify in the browser only.
- **SendQuotePanel** (`app/dashboard/quote/[token]/SendQuotePanel.tsx`) props: `quoteId`,
  `customerPhone`, `customerEmail`, `paid`. Dropdown opens **downward** (`top-full mt-2`) — inside
  the pane's `sticky bottom-0` action bar it would clip below the viewport, so it needs an
  open-upward option there. Button label is hardcoded "Send to Customer".
- **Dashboard quote data**: the `Quote` type (`app/dashboard/page.tsx:294-295`) already carries
  `customer_phone`; `/api/tenant/me` (`app/api/tenant/me/route.ts:437-439`) builds
  `customer_phone` from `intake.caller` but does **not** emit the caller's email, so the panel's
  email row would start empty in the Quotes tab.
- **Tests/gates**: vitest is node-only (`vitest.config.ts`: `environment: 'node'`, includes
  `lib/**/*.test.ts`, `app/**/*.test.ts`; no @testing-library). Existing homes:
  `lib/quote/send-customer.test.ts` (has `canSendQuote` describe),
  `app/api/tenant/me/route.get.test.ts` (locks the quotes-query/response contract). Gates:
  `npm test`, `npm run typecheck` (**there is no `npm run check`**), `npm run test:e2e`
  (Playwright) exists but the loop's browser gate is the `verify` skill (`.claude/skills/verify`)
  driving the authed dashboard.
- Baseline: `npm run typecheck` passes on the current working tree.

## Task

1. **Pure CTA policy (TDD first).** Add `confirmSendCta(status, depositPaid)` to
   `lib/quote/send-customer.ts` (same module as `canSendQuote`) returning
   `{ show: boolean; label: string }`:
   - `deposit_paid` true, or status `paid`/`accepted` → `show: false` (endpoint 409s these; the
     bar already hides Delete the same way).
   - status `sent` or `viewed` → `show: true, label: 'Send to Customer'` (resend/nudge).
   - anything else (`draft`, `awaiting_tradie_approval`, null, legacy) →
     `show: true, label: 'Confirm & Send'`.
   Unit-test in `lib/quote/send-customer.test.ts` before wiring UI.
2. **Mount the panel in the Quotes tab.** In `QuoteDetail` (`app/dashboard/page.tsx`) render
   `SendQuotePanel` in the pinned action bar as the **first (primary) action**, gated by
   `confirmSendCta(q.status, q.deposit_paid)`. Extend `SendQuotePanel` with two optional props,
   defaulting to current behaviour: `label?: string` (button text) and `dropUp?: boolean`
   (dropdown positions `bottom-full mb-2` instead of `top-full mt-2`). Pass
   `customerPhone={q.customer_phone}`, `customerEmail={q.customer_email ?? null}`,
   `paid={false}` (visibility already handled by `show`).
3. **Expose customer email to the dashboard.** In `/api/tenant/me` add `customer_email` to each
   quote (from `intake.caller.email`, trimmed-or-null, mirroring how `customer_phone` is built)
   and add the field to the dashboard `Quote` type. Extend `app/api/tenant/me/route.get.test.ts`
   to lock the new field.
4. **Roofing CTAs (TDD first).** Add a pure helper `roofQuoteCta` in `lib/roofing/quote-cta.ts`:
   inputs `{ showPrices, indicative, acceptActionable, smsNumber }` → `{ label, href }` for the
   tier cards and the sticky bar:
   - `showPrices && acceptActionable` → `href: '#accept'`, label `'Book site visit'` when
     `indicative`, else `'Accept & book'` (the on-page AcceptBlock is the real action; keep the
     `'Reply to …'` wording out — it described a dead end).
   - `showPrices && !acceptActionable` (accept view mode `paid`/`expired`) → `href: null`, keep
     the current label behaviour (label-only pill, unchanged).
   - gate closed (`!showPrices`) → label `'Reply YES to see prices'` (unchanged);
     `href: smsNumber ? 'sms:<number>?&body=YES' : null` (the `?&body=` form works on both iOS
     and Android).
   Unit-test the matrix in `lib/roofing/quote-cta.test.ts`. `acceptActionable` =
   `roofAcceptView.mode === 'deposit' || roofAcceptView.mode === 'inspection'`.
5. **Wire the roof page.** In `app/q/roof/[token]/page.tsx` use `roofQuoteCta` for all three CTA
   sites (priced tier cards, gate-closed tier cards, sticky bar). Add `twilio_sms_number` to
   `TenantIdentity` + the base select in `lib/quote/tenant-identity.ts` (additive; existing
   callers unaffected) and feed it as `smsNumber`. Add `id="accept"` to the AcceptBlock `<section>`
   (`app/q/_chrome/AcceptBlock.tsx:61`) so `#accept` lands on it.
6. **Verify end-to-end** (the loop's `/verify` step, browser evidence via the repo `verify` skill /
   Playwright): (a) dashboard Quotes tab — a pre-sent quote shows **Confirm & Send**, the dropdown
   opens upward, a send succeeds (or surfaces a clean per-row error) and the badge flips to "Sent
   to customer" on refresh; a sent quote shows **Send to Customer**; a paid quote shows neither.
   (b) `/dashboard/quote/[token]` panel still works unchanged. (c) roof page — priced view: tier
   CTA + sticky CTA are live and scroll to the accept block; gate-closed view: CTA is an
   `sms:` link when the tenant has an SMS number. (d) Issue E: `/q/[token]` as the signed-in owner
   still shows the floating tradie banner and opens the editor.

## Constraints

- Reuse `SendQuotePanel` and `/api/quote/[id]/send` — do **not** build a second send endpoint or a
  parallel confirm endpoint; sending IS confirming for held quotes.
- No jsdom/component tests — pure helpers carry the unit coverage (repo convention).
- Do not touch the painting page's `'Contact us to book'` null-href CTAs, the solar/aircon/plan
  surfaces, or `/q/[token]`'s deposit CTAs — Jon's report is the roofing surface + dashboard.
- Do not change SMS templates, the approve route, lifecycle, or Stripe wiring.
- Keep `SendQuotePanel` prop additions optional with defaults so
  `QuoteReportViewerClient.tsx:189` compiles and behaves unchanged.
- All new UI copy: AU English, no emoji, existing Tailwind token classes (accent/ink-line/etc.).

## Acceptance criteria & gates

- `confirmSendCta`: hidden for deposit-paid/paid/accepted; "Send to Customer" for sent/viewed;
  "Confirm & Send" for draft/awaiting_tradie_approval/null — unit-tested.
- `/api/tenant/me` quotes payload includes `customer_email` (caller email, trimmed-or-null) —
  locked in `route.get.test.ts`.
- `roofQuoteCta` matrix unit-tested: `#accept` when priced+actionable, null-href when
  paid/expired, `sms:` link (or null without a number) when gated.
- AcceptBlock section carries `id="accept"`; roof page passes real hrefs so `TierCards` renders
  `<a>` CTAs and `QuoteChrome` renders the sticky CTA.
- Dashboard QuoteDetail action bar mounts the panel per `confirmSendCta`, dropdown opens upward.
- Gates, all green each iteration and at completion:
  - `npm test` (vitest, node)
  - `npm run typecheck` (tsc --noEmit)
  - `/verify` browser pass per Task 6 (verify skill / Playwright against the dev server)
  - `/review` (this spec, requirement by requirement) and `/code-review` — no blocker/major
    findings outstanding.

## Examples

<example>
`lib/quote/send-customer.ts` — `canSendQuote` + its `describe` block in
`lib/quote/send-customer.test.ts`: the pure-policy pattern `confirmSendCta` should copy (result
object, exhaustive status cases, no mocks).
</example>

<example>
`app/dashboard/quote/[token]/QuoteReportViewerClient.tsx:189-194` — the existing SendQuotePanel
mount: exactly the wiring shape QuoteDetail's action bar should reuse (quoteId + contact props).
</example>

<example>
`app/dashboard/page.tsx:8980-8983` — DeleteQuoteButton's visibility gate
(`!q.deposit_paid && !['accepted','paid'].includes(status)`): the same hide-don't-disable
convention `confirmSendCta`'s `show` follows in the action bar.
</example>

<example>
`app/q/paint/[token]/page.tsx:236-254` — per-tier `ctaLabel`/`ctaHref` derivation feeding
`TierCards`: the shape `roofQuoteCta`'s output plugs into on the roof page.
</example>
