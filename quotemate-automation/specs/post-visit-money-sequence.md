# Post-site-visit money sequence — Spec

> Jon's asks (onboarding week): "I will need to validate the sequence after the site visit…
> it seems to be stuck at site visit and I can't move it forward to full quote and deposit
> acceptance." Payment model: 2% fee on top of price · $99 site visit · acceptance + deposit
> (per job type — EV chargers 50% for him) **less** the $99 · final payment via Stripe,
> there and then on the job, triggered by the tradie, paid by the customer.
> Lead entry: "the consumer will receive a Meta message from the tradie to text their number"
> — SMS via the tradie's QuoteMax number is the entry point. **No GHL workflow for now.**
>
> **Revision 2 (2026-09-02).** Every citation below was adversarially verified against the
> code by six independent readers. Revision 1 got the fee maths wrong, assumed the
> post-payment routing was reusable (it forces a booking calendar), missed that
> `/r/<child>/inspection` would mint a second $99, and named a column (`public_token`)
> that `quotes` does not have. All fixed here.

## Objective

Unblock the job lifecycle after the paid $99 site visit for site-visit-first trades
(electrical/plumbing): the tradie issues a **final quote** against the same job, the customer
accepts by paying a **job-type-specific deposit less the $99 already paid**, and the tradie
triggers the **final balance payment** on the job — all through the existing Stripe Connect
machinery, with the **2% platform fee charged on top** of the deposit and balance so the
tradie nets exactly the quoted price. Today the job is structurally terminal at "site visit
paid"; this build gives it a forward path.

## Entry point (no build in this repo)

The Meta ad / Meta message tells the consumer to **text the tradie's QuoteMax number**.
Inbound SMS is handled by the **out-of-repo Front Desk + per-trade receptionist services on
Railway** (NestJS; `qm-front-desk-production.up.railway.app`, see
`lib/twilio/provision.ts:44-48`). This repo's `/api/sms/inbound` is a **retired stub** that
returns empty TwiML unless `SMS_RECEPTIONIST_ENABLED=1` (`app/api/sms/inbound/route.ts:1636-1680`).
CLAUDE.md still describes the pre-cutover in-app wiring — it is stale on this point.

Consequences the builder must respect:

- **Dependency to confirm before Thursday:** the external electrical receptionist must mint
  the initial `quotes` row through this app (`POST /api/estimate/draft`) so the chain has a
  root. Verify with a real test SMS on a live electrical tenant and check `quotes` for the row.
- **No receptionist changes are possible from this repo.** Customer *replies* to the
  final-quote / balance texts land at the external receptionist (which may open a fresh
  intake). Every SMS this build sends says **"tap the link"**, never "reply YES".
- GHL integration is explicitly deferred (see Non-goals).

## Context — what exists today (verified 2026-09-02)

Do not rebuild what's here; the blockers are precise:

- **One payment per `quotes` row, structurally.** `finalisePaidQuote` claims with
  `.is('paid_at', null)` (`lib/quote/paid-confirm.ts:78-96`); the webhook dedupes by session
  id then skips any session for a row that already has `paid_at`
  (`app/api/stripe/webhook/route.ts:206-214`). Both checks are **per row keyed by
  `metadata.quote_id`**, so a paid parent never blocks a child. There is no payments ledger.
- **Electrical/plumbing deposits are unreachable.** `SITE_VISIT_FIRST_TRADES` is a
  `ReadonlySet(['electrical','plumbing'])` (`lib/quote/mint-tier.ts:37`);
  `resolveGenericMintTier(tier, trade)` is pure and kind-blind (`:70-79`), applied at
  `app/r/[token]/[tier]/route.ts:324-337` on a `trade`-only intake read (`:325-329`).
- **The same trade-only allowlist is replicated at 8 other sites** (listed in the
  `quote_kind` table below): send/approve/edit SMS composition, both SMS builders, the `/q`
  page, and `resolveBookUnpaidAction`. Gating only `resolveGenericMintTier` leaves a child
  rendered and texted as a $99 site-visit quote.
- **The `inspection` tier is passthrough for every row** (`mint-tier.ts:76-78`) and
  `/r/<any>/inspection` mints a live $99 Session (`route.ts:189-196`). On a child that $99
  would claim the row's only `paid_at` slot with `paid_tier='inspection'` and permanently
  block the deposit.
- **A paid row is frozen.** Edit (`app/api/quote/[id]/edit/route.ts:178-183`), chat-edit
  (`:144`), document (`:62`), tier PATCH and DELETE 409 on `paid_at`. **Send** 409s on
  lifecycle *status* `paid|accepted` via `canSendQuote` (`lib/quote/send-customer.ts:21-29`),
  not on `paid_at`. Post-payment actions today: `POST /api/quote/[id]/complete` (releases
  held funds, never charges), the customer slot booking `POST /api/q/[token]/book`, and
  `/accept`.
- **Post-payment routing is booking-shaped.** `paidPageTarget` sends paid + no
  `scheduled_at` → `/book` (`lib/quote/booking.ts:125-131`; `app/q/[token]/paid/page.tsx:115-121`);
  `/thanks` bounces the same way (`lib/quote/thanks.ts:17-23`); `finalisePaidQuote` writes
  `booking_state='reserved'` (`paid-confirm.ts:120-133`) and `after()` texts "deposit received
  — pick a time … /book" (`lib/quote/booking-notify.ts:107-113`, `lib/sms/templates.ts:655-662`).
  The tradie gets **only a push** on payment; the tradie SMS fires only when a slot exists
  (`booking-notify.ts:141-181`).
- **"Credited toward your final quote" is copy, not code** (`lib/stripe/checkout.ts:393`).
  The only deposit maths is `depositCents(inc, pct) = round(inc×pct/100)`
  (`lib/quote/money.ts:64-68`). `INSPECTION_FEE_AUD_CENTS` lives at `money.ts:32`.
- **`quotes.deposit_pct`** is `numeric(5,2) default 30`, defined in
  `sql/02_stages_06_10_partial.sql:21` (outside the numbered migrations; absent from
  `sql/init.sql`), with **no CHECK**. `clampDepositPct` (`money.ts:101-104`) is a *fallback*,
  not a clamp: anything outside 1–90 becomes 30. The electrical draft INSERT never writes it
  (`app/api/estimate/draft/route.ts:508-540`) and site-visit-first rows get `NULL`; the literal
  30 is passed only to the Stripe/SMS helpers (`draft:653,667`; `edit:550,824`). Solar's
  `pricing_book.overlays.solar_rate_card.deposit_pct` is the config precedent; overlays
  additions need no migration (mig 044). `pricing_book` is UNIQUE on `(tenant_id, trade)`
  (mig 024), one row per trade, created at onboarding.
- **Job type**: `quotes` has no `job_type`; the link is `quotes.intake_id → intakes.job_type`;
  `'ev_charger'` is canonical (`lib/intake/schema.ts:19`). Mig 192 seeds a **platform-wide**
  `job_type_bounds` row (no `tenant_id`), marked provisional.
- **The 2% fee is deducted, not surcharged.** `PLATFORM_FEE_PCT = 2`,
  `platformFeeCents(x) = round(x×0.02)` (`lib/stripe/connect.ts:24-29`), applied as
  `application_fee_amount` on destination charges (`:79-85`) and mirrored into
  `metadata.application_fee_cents` (`:91-96`). The webhook stamps `paid_amount_cents =
  session.amount_total` and `platform_fee_cents = metadata.application_fee_cents`
  (`webhook/route.ts:221-233` → `paid-confirm.ts:100-114`); the payout release is **stored
  paid − stored fee** (`connect.ts:150`). Stripe's own processing fees are **platform-borne**
  (`fees_collector: 'application'`, `lib/stripe/provision.ts:64-73,107`).
- **Charges are inc-GST**; `totalIncGstCents` ×1.1 when `gst_registered`
  (`money.ts:55-61`). The `/r` route re-reads `gst_registered` live on every click
  (`route.ts:177-186`) and recomputes inc-GST cents from `good.subtotal_ex_gst`
  (`checkout.ts:241-244`).
- **Price hold**: 7-day default derived from `created_at` when `price_hold_until` is null
  (`lib/quote/hold.ts:14,82-104`); `/r` bounces expired priced tiers (`route.ts:117-119,343-348`);
  send re-arms it (`send/route.ts:365-377`).
- **Early-bird**: the generic `good` mint runs `resolveMintDiscount` and stamps
  `applied_discount_pct` (`route.ts:208-241`) from the row's `early_bird_*` columns.
- **Rows are addressed by `share_token`** (`generateShareToken()`, `lib/stripe/checkout.ts:87-89`);
  `/q`, `/dashboard/quote`, `/r`, `/pdf`, `/accept`, `/book`, `/paid` all resolve by it. There
  is no `public_token` on `quotes`. There is **no clone/duplicate/requote helper**; every
  quotes INSERT is ad hoc (canonical column set: `draft/route.ts:508-557`). The only
  create-from-existing precedent is roofing's promotion with a conditional-UPDATE claim
  (`app/api/roofing/save-as-quote/route.ts:173-232`). No DB constraint blocks multiple
  quotes rows per intake (only `share_token` is unique, mig 104).
- **Inspection-routed parents have NULL tiers** (`mint-tier.ts:27-31`; `draft:527-531`) and a
  row with `needs_inspection=true` is un-editable (`edit:187-196`) and un-PDF-able
  (`lib/quote/pdf.ts:326`).
- **Dashboard data lacks the fields to gate any of this**: `/api/tenant/me` selects
  `paid_at` but not `paid_tier` (`app/api/tenant/me/route.ts:170-178`); the viewer page
  select likewise (`app/dashboard/quote/[token]/page.tsx:34-40`).

### Design decision — chained quote rows, not a payments ledger

Each customer charge lives on its **own `quotes` row**, so the one-payment-per-row invariant,
the webhook claim, `payRedirectTarget`, and the Connect payout release all work as-is. A job
becomes a chain: initial row ($99 site visit, unchanged) → **final** row (deposit) →
**balance** row (final payment), linked by `parent_quote_id`. The "$99 less" credit is
**price math on the deposit charge**, not ledger math.

Alternatives weighed (touch-point counts, not vibes):

- **Balance as a second payment on the final row** (`balance_paid_at`,
  `balance_stripe_session_id`, `balance_amount_cents`, `balance_fee_cents`,
  `balance_payout_id`, `balance_completed_at` + a webhook branch on `metadata.purpose` with
  its own claim + a second `/complete` release path + a two-charge Payouts entry). That
  duplicates the entire payment column set and the release path — the exact money code where
  this repo has grown silent-failure bugs. **Rejected.** The third row costs one tier literal
  and a label.
- **Stripe Payment Links / Invoices** on the connected account (no 24h expiry, receipts).
  Rejected: idempotency and the release path are Checkout-Session-keyed throughout.
- **Proper `quote_payments` ledger** — the named later upgrade, not this build.

### Surfaces that must branch on `quote_kind`

Revision 1 claimed only the mint gate needed a `quote_kind` check. The verification found
these sites, ranked by blast radius. Each is a requirement below; this table is the checklist.

| # | Surface | Today | Required for `final` / `balance` |
| --- | --- | --- | --- |
| 1 | `lib/sms/templates.ts` `buildQuoteSms` (`:1036-1148`) + `buildQuoteUpdatedSms` (`:98-207`); callers `send/route.ts:234-236,267-271`, `approve/route.ts:177-179,236-240`, `edit/route.ts:502-522,810-824` | Adds `/r/<token>/inspection`, prints the $99 CTA, hardcodes `deposit_pct 30` | Kind-aware; final-quote and balance templates; never an inspection link |
| 2 | `app/r/[token]/[tier]/route.ts` `:304` select, `:324-337` gate, `:343-348`+`:117-131` hold/slots gates, `:208-241` early-bird, `:244-269` mint | Trade-only gate; `inspection` passthrough | Select `quote_kind`; refuse `inspection` on children; skip hold, slots and early-bird; new session builders |
| 3 | `lib/quote/paid-confirm.ts` `:120-145,187,192-212` → `booking-notify.ts:107-113` | Writes `booking_state`, texts "pick a time" | Skip booking state; kind-specific customer + tradie SMS |
| 4 | `/paid` (`app/q/[token]/paid/page.tsx:109-121`, `booking.ts:125-131`), `/thanks` (`thanks.ts:17-23`) | → `/book` calendar | → the final row's `/q` page |
| 5 | `app/q/[token]/page.tsx` `:267-269` and dependents (`:632,648,729-738,776,799-805,858-877,1609-1610,1754,1787-1796,1857-1865,1879-1891`), `app/q/_chrome/QuoteChrome.tsx:163`, `lib/quote/accept.ts:104,125` | $99 CTA, "Pick your visit time", `confirmsSiteVisit` true | Final-quote accept block, deposit stack with credit + fee, per-kind paid states |
| 6 | `app/q/[token]/book/page.tsx:104-114` + `resolveBookUnpaidAction` (`mint-tier.ts:101-114`); `POST /api/q/[token]/book` (`:82-99`) | Unpaid child → $99 mint; paid child can book a phantom slot | 409 / 302 for non-initial |
| 7 | Dashboard data + KPIs: `me/route.ts:172`, `dashboard/page.tsx:2784-2817,4805-4811,8987-9000`, `lib/dashboard/tradie-analytics.ts:213-217`, `lib/admin/metrics.ts:316-338`, `app/api/tenant/calendar/route.ts:195-203`, `app/api/tenant/payouts/route.ts:234-243` | No kind field; children triple-count; calendar "to schedule" lists paid children | Expose kind; count root only; label by kind; exclude children from calendar |
| 8 | `lib/stripe/checkout.ts:143,250` product description "balance due on completion" | Copy | New builders own their copy |
| 9 | Follow-ups: `app/api/tenant/followups/route.ts:77-84`, `app/api/cron/followup-2h/route.ts:170-180` | Chase any sent unpaid row | Chase unpaid **finals** (desired); never balances |
| 10 | Low: `app/api/upload/[token]/route.ts:247-253` (newest quote by intake), `lib/dashboard/recent-activity.ts` | Picks/list children | Prefer root / label |

Every quotes select on the funnel omits `quote_kind` and must add it: `r/route.ts:304`,
`book/page.tsx:71`, `paid/page.tsx:49`, `me/route.ts:172`, `edit/route.ts:170`,
`send/route.ts:125`, `calendar/route.ts:83`, `followup-2h/route.ts:170`.

## Money — the single source of truth

All amounts in integer cents. `T` = the final row's stored `total_inc_gst` converted to cents
(the figure the customer was shown); `CREDIT = INSPECTION_FEE_AUD_CENTS` (9900);
`pct` = the final row's `deposit_pct`.

```text
deposit_base  = max(0, round(T × pct / 100) − CREDIT)
balance_base  = T − CREDIT − deposit_base
surcharge(x)  = platformFeeCents(x) = round(x × 0.02)       // lib/stripe/connect.ts:27-29
charged(x)    = x + surcharge(x)
application_fee_amount = metadata.application_fee_cents = surcharge(x)   // the SAME variable
```

Invariants (tested, R12): `CREDIT + deposit_base + balance_base === T` in every case
including the R8 edge; for every child charge the tradie nets **exactly** `base`
(`paid_amount_cents − platform_fee_cents === base`); the platform receives exactly
`surcharge(base)`. Never write `round(base × 1.02)` and `platformFeeCents(charged)` — two
roundings of two bases leave the tradie 0.04% short. `MIN_STRIPE_CHARGE_CENTS = 50` (Stripe
rejects AUD charges under $0.50) governs R8.

New pure helpers in `lib/quote/money.ts` (the repo rule is one money module for page + SMS +
PDF + Stripe): `finalDepositBaseCents(T, pct)`, `finalBalanceBaseCents(T, pct)`,
`surchargeCents(x)` (re-exporting `platformFeeCents`), `chargedCents(x)`.

## Requirements

**R1 — Schema (migration 193).** `sql/migrations/193_quote_chain.sql` + `193_down.sql` +
`scripts/run-migration-193.mjs` (copy `run-migration-192.mjs`: dry-run default, `--apply`,
`--rollback`) + a PGlite migration test in `tests/` (pattern `tests/ev-charger-migration.test.ts`).
Adds to `quotes`:
- `parent_quote_id uuid NULL REFERENCES quotes(id) ON DELETE SET NULL`
- `quote_kind text NOT NULL DEFAULT 'initial' CHECK (quote_kind IN ('initial','final','balance'))`
- partial unique index `quotes_open_child_uniq ON quotes(parent_quote_id, quote_kind) WHERE
  paid_at IS NULL` — at most one unpaid child of each kind per parent; this is the R3/R7
  idempotency guarantee (DB constraint over app code).
Also add both columns to the `quotes` DDL in `sql/init.sql` per repo rule, noting in the
migration header that `init.sql`'s quotes DDL already lacks `share_token`, `paid_*`,
`deposit_pct`, `tenant_id` (they live in `sql/02_stages_06_10_partial.sql`, `sql/04_f3_finish.sql`
and later migrations) — do not treat `init.sql` as prod schema.

**R2 — Per-job-type deposit % config.** Store a map in the tenant's trade pricing book:
`pricing_book.overlays.deposit_pct_by_job_type`, keyed by `intakes.job_type` **verbatim**,
e.g. `{"ev_charger": 50, "default": 30}` (zero-migration, mig-044 precedent). A pure resolver
`resolveDepositPct(map, jobType): number` — exact key, else `"default"`, else 30; values
outside 1–90 fall back to 30 (documented `clampDepositPct` semantics — a 100 becomes 30, so
the seed script **rejects** out-of-range entries at seed time). Hook: in the issue-final route
(R3), read `pricing_book.overlays` with `.eq('tenant_id', …).eq('trade', intake.trade)` —
**no any-row fallback** (solar's `loadSolarRateOverlay:306-315` has one; a multi-trade tenant
would pick another trade's book) — and stamp `deposit_pct` on the child INSERT (mirror
`lib/solar/persist-helpers.ts:192-195`). The `/r` mint reads `quotes.deposit_pct`
(`route.ts:254-260`), never overlays. Thursday seed for Jon:
`UPDATE pricing_book SET overlays = overlays || '{"deposit_pct_by_job_type":{"ev_charger":50,"default":30}}' WHERE tenant_id=<jon> AND trade='electrical'`.
No editor UI (non-goal).

**R3 — "Issue final quote" tradie action.** New authed route (self-auth via
`resolveTenantRequest` like `complete/route.ts:46-50`; `proxy.ts` gates nothing) surfaced in
the `/dashboard/quote/[token]` toolbar next to Send (`QuoteReportViewerClient.tsx:167-224`),
shown when `paid_tier === 'inspection' && quote_kind === 'initial' && isSiteVisitFirstTrade(trade)`.
Preconditions (409 with a code): parent `tenant_id` NULL (`parent_unscoped`); tenant not
Connect-ready — `stripe_connect_payouts_enabled` false (`connect_required`; a deposit must be
Connect-routed or it can never be released, see Edge cases). It INSERTs ONE child row:

- copied from the parent: `intake_id`, `tenant_id`, `scope_of_works`, `scope_short`,
  `assumptions`, `risk_flags`, `estimated_timeframe`, `gst_note`, `display_mode`,
  `optional_upsells`;
- set: `quote_kind='final'`, `parent_quote_id`, `share_token=generateShareToken()`,
  `status='draft'`, `needs_inspection=false`, `inspection_reason=null`,
  `selected_tier='good'` (DB default is `'better'`), `better=null`, `best=null`,
  `stripe_links={}`, `price_hold_until=null`, `deposit_pct` from R2;
- `good` = parent's `selected_tier ?? better ?? good ?? best` tier JSON when present; when the
  parent is inspection-routed (tiers NULL — the common electrical case) seed **one
  whole-of-job line at $0** in the `seedLineItems` shape (`lib/quote/tier-materialise.ts:19-36`)
  for the tradie to price; `subtotal_ex_gst/gst/total_inc_gst` recomputed from `good` with
  `pricing_book.gst_registered` (mirror `edit/route.ts:475-481`);
- **never copied**: `paid_*`, `stripe_links`, `pdf_*`, `sent_at`, `followup_2h_sent_at`,
  `booking_state`, `scheduled_*`, `customer_accepted_*`, `early_bird_discount_pct`,
  `early_bird_expires_at`, `applied_discount_pct` (else `resolveMintDiscount` silently
  discounts the deposit).

Idempotency: insert; on unique violation (23505 from R1's index) select and return the
existing open child. Not read-then-insert. The route returns the child's `share_token`; the
dashboard navigates to `/dashboard/quote/<child token>`.

**R4 — Editing a final row.** The existing editor loads by `share_token` and posts to
`/api/quote/[id]/{edit,send,tier}`; it works on the child with these kind-aware changes to
`edit/route.ts`: (a) select `quote_kind`, `deposit_pct` (`:170`); (b) for `quote_kind !==
'initial'` skip the catalogue grounding gate (`:331-472`; tradie-owned price, like solar/
roofing) — an on-site lump sum would otherwise 422 and need `force:true`; (c) ignore
`notify_customer` and do **not** auto-bump `draft→sent` on price change (`:597-600,672-679`;
`lib/quote/notify-policy.ts:24`) — final quotes are sent only by the explicit Send; (d) the
site-visit-first branches at `:502-522` and `:810-824` use the kind-aware predicate (R6) and
the row's `deposit_pct`, never 30. The parent stays frozen (existing `paid_at` 409). AI
chat-edit may propose `better/best` on a single-slot row (`lib/quote/chat-edit.ts:473-489`) and
Save 400s `cannot_edit_missing_tier` — acceptable; hide "Edit with AI" on children.

**R5 — Final quote shape and rendering.** One confirmed price, stored **ex-GST** in
`good.subtotal_ex_gst` (`checkout.ts:56`); inc-GST derived once via `totalIncGstCents` and
stored on the row. The `/q/[token]` page already renders a single populated tier without
crashing (`lib/quote/tier-visibility.ts:108-127`; eyebrow "Your quote" when `tierCount===1`,
`page.tsx:1644`). Required changes in `app/q/[token]/page.tsx`:
- select `quote_kind`; `siteVisitFirst = isSiteVisitFirstRow({trade, quoteKind})` (`:267`);
  suppress the price-hold banner and early-bird offer for children (`:632-648`);
- `quote_kind='final'` unpaid: greeting "Your final quote after the site visit. Price
  includes GST. Accept with a {pct}% deposit — your $99 site visit is credited."; stack rows
  `Deposit ({pct}%)` / `Less $99 site-visit credit` / `QuoteMax platform fee (2%)` /
  **`Deposit due now`** / `Balance on completion`; card CTA and sticky bar "Accept & pay
  $C deposit" → `/r/<token>/deposit`; section 05 "Next steps: pay the deposit to confirm the
  job; the balance is requested by your tradie on completion"; `resolveAcceptView` gets
  `visitDone: true` → `confirmsSiteVisit: false`, CTA "Accept & pay deposit"; AcceptBlock
  posts tier `'good'` explicitly (the `/accept` default is `'better'`);
- `quote_kind='final'` R8 variant: "Your $99 site visit covers the deposit — nothing to pay
  now; balance $B on completion";
- **paid states on the final row's page** (this page is the job's single customer surface
  after the visit): deposit paid → "Deposit received — your tradie will confirm the job date"
  (**no** `/book` link, no "Pick your visit time"); balance requested (an unpaid balance child
  exists) → "Balance due $B" + CTA → `/r/<balance token>/balance`; balance paid → "Paid in
  full — thanks"; hero/sticky/`QuoteChrome.tsx:163` copy per state, never "Deposit paid" on a
  paid balance;
- `/q/<balance token>` → 302 to the final row's `/q`; `/q/<initial token>` on a paid initial
  row that has a final child → 302 to the final row's `/q` (the customer's SMS thread still
  holds the initial link);
- PDF (`lib/quote/report-html.ts`): for `final` print the tier marker as "FINAL QUOTE"
  (`:160`), swap please-note line 2 "Final pricing is confirmed on site" (`:200-204`) for
  "Price confirmed at your site visit. Deposit {pct}% less $99 credit; balance on
  completion."; bump `REPORT_TEMPLATE_VERSION` (`:52`). No deposit block in the PDF (non-goal).

**R6 — One kind-aware predicate for site-visit-first.** Add
`isSiteVisitFirstRow({ trade, quoteKind }): boolean` in `lib/quote/mint-tier.ts` (false for
`final|balance`) and thread `quoteKind` through **every** existing `isSiteVisitFirstTrade`
caller: `resolveGenericMintTier(tier, trade, quoteKind = 'initial')` (keeps
`lib/quote/mint-tier.test.ts`'s 17 two-arg calls green), `resolveBookUnpaidAction`
(`:101-114`), `send/route.ts:234,270`, `approve/route.ts:177,239`, `edit/route.ts:502,820`,
`lib/sms/templates.ts:107,1044` via a new `QuoteSmsOptions.quoteKind`, `page.tsx:267`.

**R7 — Deposit mint (`/r/<final token>/deposit`).** Tier literals: children never use
`good/better/best/inspection`. Add `'deposit'` and `'balance'` to `VALID_TIERS`
(`route.ts:82`) and `NEXT_PAY_TIERS`/`resolveNextTier` (`booking.ts:85-103`); the webhook
**drops sessions with an empty `metadata.tier`** (`webhook/route.ts:188-193`), so child sessions
always carry it; `/paid`'s fallback defaults a missing tier to `'better'` (`paid-confirm.ts:47`).
`/r` route changes for `quote_kind !== 'initial'`:
- select `quote_kind` (`:304`); `final` accepts only `deposit`, `balance` accepts only
  `balance`; **any other tier — including `inspection` — 302s to the final row's `/q` and
  mints nothing**;
- `resolvePayRedirect` (`:100-134`, pure, tested) gains a `kind` input: children skip the
  price-hold expiry gate (`:117-119`, `:343-348` — a child has no hold; `resolvePriceHoldUntil`
  would otherwise derive one from `created_at`) and the `canTakePayment` slots guard
  (`:129-131`); the route skips the three-query bookable lookup (`:355-387`) for children.
  The `paid` → 302 stays (never re-charge);
- skip `resolveMintDiscount` (`:208-241`); `discountPct 0`, no `applied_discount_pct` stamp;
- if `connectDestinationForTenantId` is null → 302 to `/q/<token>?connect=0`, mint nothing
  (a platform-direct child can never be released: `payoutReleaseDecision` →
  `not_connect_routed`, `connect.ts:141`). This differs from the $99, which stays as today;
- new builders in `lib/stripe/checkout.ts`: `createFinalDepositCheckoutSession` and
  `createBalanceCheckoutSession({ quoteId, shareToken, baseCents, surchargeCents, creditCents,
  description, appUrl, connect })` — `createCheckoutSessionForTier` cannot express the credit,
  surcharge or balance. Two `line_items` (base line + "QuoteMax platform fee (2%)"),
  `payment_intent_data.application_fee_amount = surchargeCents` and
  `metadata.application_fee_cents = surchargeCents` from the **same variable** (pass the fee
  explicitly; do not call `connectPaymentIntentExtras(charged)`); `metadata` also carries
  `quote_id`, `tier`, `purpose ('deposit'|'balance')`, `quote_kind`, `parent_quote_id`,
  `base_cents`, `credit_cents`, `surcharge_cents`, `total_inc_gst_cents`, `deposit_pct` so the
  split is auditable from Stripe alone; `success_url = /q/<final token>?paid=<purpose>`;
- amounts come from the row's **stored** `total_inc_gst` and `deposit_pct` (frozen by the
  `paid_at` 409 once the deposit lands), not from a live `gst_registered` lookup + subtotal
  recompute — otherwise `T` can drift between the deposit click and the balance click. If the
  tradie edits the price after send but before deposit, the existing `/r` link mints at the
  new price by construction; they must re-send (existing behaviour, state it in the UI);
- persist `stripe_links` keyed by the child tier literal so a balance mint never expires a
  deposit session (`:272-283` expires the replaced session by key).

**R8 — Zero-deposit edge is first-class.** If `deposit_base < MIN_STRIPE_CHARGE_CENTS` the
deposit step is skipped. Mechanism: the send route (R9), **after a delivered send only**,
stamps `paid_at=now()`, `paid_tier='credit'`, `paid_amount_cents=0`,
`paid_stripe_session_id=NULL`, `stripe_connect_destination=NULL` on the final row (Payouts
excludes it — `payouts/route.ts:240-241`; `payoutReleaseDecision` → nothing to release; the
row leaves the follow-up queues and freezes like any paid row). Never stamp before the send
succeeds (the "never report ok without sent" rule). `/q` and SMS use the R5/R9 zero-deposit
copy; "Request final payment" (R10) accepts `paid_tier IN ('deposit','credit')`.
`balance_base < 50` (T ≤ $99.49) → the job is paid in full by the site visit; "Request
final payment" 409s `nothing_to_charge`.

**R9 — Sending the final quote.** Reuse `POST /api/quote/[id]/send` (auth, contact chain,
PDF regenerate, dispatch, `markSent`) with a kind-specific body. For `final`: `payLinks.deposit
= /r/<token>/deposit` set **unconditionally** (today links mirror `stripe_links` keys,
`send/route.ts:226-229`), never `payLinks.inspection`; `buildQuoteSms` with `quoteKind:'final'`
emits — "Hi {first}," / "Your final quote for {job} from {business}: ${T} inc GST." / "View
quote: {q url}" / "PDF: {pdf}" / "Accept with a {pct}% deposit: ${D} less your $99
site-visit credit + 2% platform fee = ${C}." / "Tap to pay: {appUrl}/r/{token}/deposit" /
"Balance ${B} is requested on completion." / "- {business}". R8 variant: "Your $99 site visit
covers the deposit — nothing to pay now; balance ${B} on completion." Do not re-arm the
price hold on children (`:365-377`). The email channel is hidden for children
(`SendQuotePanel.tsx:139-150`; `buildQuoteEmail` copy is generic). Returns `{ ok, sent }`
like today; a failed dispatch is reported, never swallowed.

**R10 — "Request final payment" tradie action.** New authed route (as R3) on the final row's
toolbar, usable from the phone on the job, enabled when `paid_tier IN ('deposit','credit')`.
409 codes: `deposit_not_paid`, `final_not_sent`, `balance_already_paid`, `nothing_to_charge`,
`connect_required`. Creates the linked balance row (`quote_kind='balance'`, `parent_quote_id`
= final row, own `share_token`, `status='sent'`, `sent_at=now()`, `total_inc_gst` = balance
base in dollars, tiers null, idempotent via R1's index), then texts the customer the
**`/r/<balance-token>/balance` short-link** (never the raw Stripe URL, which dies in 24h):
"Hi {first}, your {job} is complete. Balance due: ${B} + 2% platform fee = ${C}. Tap to pay:
{link}. Thanks — {business}". Returns `{ ok, sent }`; 502 on dispatch failure exactly like
send. Balance rows are excluded from the VA follow-up queue and the 2h cron (unpaid
**finals** are chased by both — desired, unchanged copy is acceptable).

**R11 — Payment side-effects for children.** `finalisePaidQuote` takes `quote_kind`:
for `final|balance` it stamps `paid_*`, `paid_amount_cents`, `platform_fee_cents`,
`stripe_connect_destination` as today and advances status (`final` → `accepted` +
`accepted_at`; `balance` → `paid`), but **skips** the `booking_state`/slot-prune block
(`:120-176`) and `notifyBookingConfirmed`. Instead: customer SMS "Deposit received — thanks!
Your tradie will confirm the job date." / "Payment received — paid in full, thanks."; **tradie
SMS** to `owner_mobile` ("{customer} paid the ${C} deposit for {job}" / "… paid the balance")
with push as fallback (today a deposit landing only pushes). `/paid` and `/thanks`: for
children 302 to the final row's `/q` (`paidPageTarget`/`thanksPageTarget` gain a kind input).
`POST /api/q/[token]/book` and the `/book` page 409/302 for children (a paid child could
otherwise book a phantom slot, prune tenant availability and fire the booking SMS pair).
After the balance is paid, the existing Payouts "Mark complete & release" releases **each paid
row separately** (per-row `completed_at` + sentinel); labels read by `quote_kind`
("{job} · site visit / deposit / balance"). Releasing the deposit row before the job is done
is allowed (it is the tradie's money).

**R12 — Dashboard data, KPIs, lists.** `/api/tenant/me` (`:172`) and the viewer page select
add `paid_tier`, `quote_kind`, `parent_quote_id`; the dashboard `Quote` type
(`page.tsx:309-347`) carries them. Children are excluded from `scopedCount`, `quotedValue`,
`acceptedQuotes`, `conversionPct` (`page.tsx:2784-2817`), `tradie-analytics.ts:213-217`,
`admin/metrics.ts:316-338`, and from the calendar "to schedule" bucket
(`calendar/route.ts:195-203`); the root counts as accepted when its final child is deposit-paid
(`deposit`/`credit`). Quote cards show a "Final quote" / "Balance" badge
(`page.tsx:8987-9000`) and children group under (or link to) their root. Minimal grouping is
fine; a full grouped UI is not required.

**R13 — Strategy log.** Append `docs/strategy.md` iteration **v23** (v22, 2026-09-01, is the
EV-charger entry) documenting: the post-visit sequence, the chained-row model and why not the
two-row alternative, fee-on-top with `application_fee_amount = surcharge`, the per-job-type
deposit map, and the scoping of the `canTakePayment` and early-bird mint invariants to
`quote_kind='initial'`. Run the `strategy-reviewer` agent after editing.

**R14 — Tests.** Vitest: money helpers incl. the reconciliation identity and fee invariant for
base ∈ {1, 25, 49, 50, 9900, 100000, 123456}; `resolveDepositPct` incl. out-of-range → 30;
`resolveGenericMintTier` third arg (existing 17 cases unchanged) + `inspection` refused on
children; `resolvePayRedirect` kind input (hold + slots bypass); `paidPageTarget`/
`thanksPageTarget` for kind; `finalisePaidQuote` skips booking state and sends no "pick a
time" SMS for children; `POST /api/q/[token]/book` 409 on children; `buildQuoteSms` with
`quoteKind:'final'` contains no `/inspection` link and prints deposit/credit/fee lines; a
webhook test that a `balance` session marks the child paid and leaves the parent's `paid_at`
untouched; the R1 partial index blocks a second open child (PGlite). Existing suite stays
green — `'initial'` is the default so no existing row changes behaviour. Supabase/Twilio
calls check `{ error }`, never bare-await.

## Non-goals

- **GHL integration** (inbound webhook or status writeback) — deferred. The Meta→SMS entry
  needs no code in this repo.
- **Meta lead-ads API** integration; any change to the external Front Desk / receptionist
  services.
- **Payments ledger refactor** (`quote_payments`) — the named upgrade path.
- **Refunding the $99** when the customer declines the final quote. No refund path exists in
  code today (no `stripe.refunds.*` anywhere) although `/q`, SMS and Stripe copy say
  "refundable"; for now a decline is handled manually in the Stripe dashboard
  (`reverse_transfer: true`). See Open questions.
- **Superseding a final quote after its deposit is paid** — manual for now (the unpaid final
  is simply edited and re-sent).
- **A dashboard editor for the deposit map** — seed Jon's via SQL; UI later.
- **Per-tenant fee %** — 2% stays the platform constant; only its incidence changes.
- **Deposit/credit block in the PDF**; customer receipts beyond Stripe's email receipt.
- Any change to solar, roofing, painting, or commercial-painting money paths, or to the $99
  initial flow for existing tenants. Roofing rows on `quotes` still pass through `/r` with
  `quote_kind='initial'` exactly as today (a blocklist would break them — CLAUDE.md warning).

## Constraints

- Next.js 16 App Router — read `node_modules/next/dist/docs/` before writing Next code
  (AGENTS.md). `proxy.ts` is a bare `clerkMiddleware()`; new routes self-auth.
- DB changes = numbered migration + `_down` + runner script + PGlite test; keep `init.sql`
  representative (with the drift noted in R1).
- Currency ex-GST stored, inc-GST displayed; cents everywhere; AU English, no emoji.
- **Deadline: Jon onboards Thursday 2026-09-03 12:00 AEST.** Thursday minimum is the live
  $99 flow + SMS entry + Connect payouts (Launch dependencies). The deposit chain lands in the
  days after and is demoed as roadmap on Thursday.
- Webhook fast-ack and session idempotency conventions unchanged.

## Launch dependencies (ops, not code — Thursday critical path)

1. **Stripe live**: start the live Connect platform review **today** (days of lead time);
   live `STRIPE_SECRET_KEY`, two new live webhook secrets (`/api/stripe/webhook`,
   `/api/stripe/connect-webhook` with connected-account events), re-run
   `scripts/setup-stripe-billing.mjs`, `STRIPE_PROVISIONING_ENABLED=true`.
2. **Prod preflight**: `GET /api/onboard/preflight` shows twilio/vapi mode `real`, nothing
   missing. Preflight checks only this app's env — the Front Desk is verified by a **real test
   SMS to a live electrical number**, confirming a `quotes` row appears (the chain-root
   dependency above).
3. **Jon's tenant**: invitation code → wizard (electrical) → activate → pricing wizard →
   toggle **Install EV charger** ON (seeds OFF, no price recipe — `specs/ev-charger-job-quoter.md`)
   → confirm the provisional mig-192 EV bounds with Jon → Connect KYC until
   `stripe_connect_payouts_enabled` flips.
4. Seed Jon's `deposit_pct_by_job_type` map (R2).

## Edge cases to handle

- Tradie double-clicks "Issue final quote" / "Request final payment" → R1's partial index
  makes the second insert a 23505; the route returns the existing child; at most one SMS.
- Parent is inspection-routed with NULL tiers → child seeds one $0 whole-of-job line;
  `needs_inspection=false` so the editor and PDF work.
- Tradie changes the final price after send, before deposit → allowed (row unpaid); the
  existing deposit link mints at the new price by construction; the toolbar shows "Re-send to
  update the customer".
- `deposit_base < 50c` → R8 credit stamp after a delivered send; `balance_base < 50c` → paid in
  full by the site visit, `nothing_to_charge`.
- `/r/<child>/inspection`, `/r/<final>/balance`, `/r/<balance>/deposit`, `/r/<child>/good` →
  302 to the final row's `/q`, no session.
- Deposit or balance link clicked after that row is paid → existing paid 302 → `/paid` →
  (kind-aware) the final row's `/q` paid state, never the calendar.
- Child link opened more than 7 days after send → no hold on children; mints normally.
- Tenant not Connect-ready → "Issue final quote" 409s `connect_required`; a child mint 302s
  with `?connect=0`. (The $99 keeps today's platform-direct fallback.)
- Tenant with early-bird configured → children carry NULL early-bird columns and the child
  mint never calls `resolveMintDiscount`.
- Multi-trade tenant (electrical + roofing) → the kind gate keys on the **root's**
  `intakes.trade`; roofing rows unaffected.
- Parent `tenant_id` NULL (legacy rows) → 409 `parent_unscoped` (owner checks 403 tenant-less
  rows anyway).
- `job_type` null/unknown or map absent → 30. Map value 100 → 30 (fallback semantics).
- Webhook / `/paid` race on a child → same `confirmPaidFromSession` claim; child sessions
  always carry `metadata.tier`.
- Customer replies "yes" to the final-quote SMS → lands at the external receptionist; the SMS
  copy therefore says "tap to pay", and the tradie can see acceptance only via payment.
- Stripe processing fees are platform-borne (`fees_collector: 'application'`): on a $1,000
  deposit QuoteMax books a $20 surcharge and pays Stripe's fee on the $1,020 charge. The tradie
  still nets exactly $1,000. (Business fact — see Open questions.)

## Definition of done

- [ ] Migration 193 (+down +runner +PGlite test) applied: `parent_quote_id`, `quote_kind`,
      `quotes_open_child_uniq` exist; `init.sql` updated.
- [ ] On a site-visit-paid electrical quote (`paid_tier='inspection'`), "Issue final quote"
      creates an editable child addressed by its own `share_token`; an inspection-routed parent
      yields a $0 whole-of-job line to price; grounding does not block the on-site price.
- [ ] Sending the final quote texts one link (`/r/<token>/deposit`) with the confirmed price,
      the job-type % (EV charger job shows 50%), the $99 credit and the 2% fee line, and no
      `/inspection` link anywhere in the SMS, page, or edit-notify paths.
- [ ] Paying the deposit charges exactly `deposit_base + surcharge(deposit_base)` on a Connect
      destination charge with `application_fee_amount = surcharge`; the Payouts "yours" figure
      equals `deposit_base`; the customer lands on the final row's `/q` "Deposit received"
      state and receives no "pick a time" text; the tradie receives an SMS.
- [ ] "Request final payment" texts `/r/<balance>/balance`; paying it charges
      `balance_base + surcharge`; `$99 + deposit_base + balance_base === T`; the final row's
      page reads "Paid in full".
- [ ] A job whose deposit ≤ $99 skips to balance with the credit stamped only after a delivered
      send.
- [ ] `/r/<child>/inspection` never mints; `POST /api/q/[token]/book` 409s on children; no
      child ever gets `booking_state`.
- [ ] Initial `/r` G/B/B links for electrical still 302 to the $99 inspection; roofing/solar
      deposits unchanged; the whole existing test suite passes.
- [ ] Pipeline/KPIs/calendar/Payouts count and label the chained job per R12.
- [ ] R14 tests green; `docs/strategy.md` v23 appended and strategy-reviewer run.
- [ ] Jon live checklist: real Twilio number produces a `quotes` row from a test SMS, live $99
      lands in his Connect balance, deposit map seeded, EV service enabled.

## Open questions

1. **Does the 2% apply to the $99 site visit too?** Spec assumes no (flat $99 preserved,
   platform fee deducted from the tradie as today); confirm with Jon.
2. **GST treatment of the 2% surcharge** — displayed inc-GST like the rest, but is the fee
   itself a taxable supply by the platform or the tradie? Needs an accounting call before
   live. It is labelled "QuoteMax platform fee", not a card surcharge, so ACCC card-surcharge
   rules are not invoked — confirm that framing is acceptable.
3. **Platform economics.** Because Stripe's processing fees are platform-borne, the 2%
   surcharge nets QuoteMax roughly 0.3% after Stripe's ~1.7% + 30c. Is 2% the intended
   number, or should the fee cover Stripe's cost plus margin?
4. **The $99 is advertised as refundable** on every surface but no refund path exists. Is a
   manual Stripe-dashboard refund acceptable for launch, or does "Refund site visit" need to
   be a button (small: `stripe.refunds.create` with `reverse_transfer:true` on the initial row)?
5. **Mig-192 EV pricing bounds are provisional** (platform-wide, not per tenant) — validate
   with Jon before his first real EV quote.
6. **Chain root from the external receptionist** — confirm the Railway electrical receptionist
   creates `quotes` rows in this DB (Launch dependency 2). If it does not, Jon's SMS leads have
   no root row and the sequence starts from the dashboard job-quote tool instead.
