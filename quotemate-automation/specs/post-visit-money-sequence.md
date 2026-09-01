# Post-site-visit money sequence — Spec

> Jon's asks (onboarding week): "I will need to validate the sequence after the site visit…
> it seems to be stuck at site visit and I can't move it forward to full quote and deposit
> acceptance." Payment model: 2% fee on top of price · $99 site visit · acceptance + deposit
> (per job type — EV chargers 50% for him) **less** the $99 · final payment via Stripe,
> there and then on the job, triggered by the tradie, paid by the customer.
> Lead entry: "the consumer will receive a Meta message from the tradie to text their number"
> — SMS via the tradie's QuoteMax number is the entry point. **No GHL workflow for now.**

## Objective

Unblock the job lifecycle after the paid $99 site visit for site-visit-first trades
(electrical/plumbing): the tradie issues a **final quote** against the same job, the customer
accepts by paying a **job-type-specific deposit less the $99 already paid**, and the tradie
triggers the **final balance payment** on the job — all through the existing Stripe Connect
machinery, with the **2% platform fee charged on top** of the deposit and balance. Today the
job is structurally terminal at "site visit paid"; this build gives it a forward path.

## Entry point (no build required)

The Meta ad / Meta message tells the consumer to **text the tradie's QuoteMax number**. That
is the already-live SMS intake channel (`/api/sms/inbound` via the Front Desk Railway webhook
since the 2026-08-05 cutover). Zero code. Onboarding just verifies the number answers.
GHL integration is explicitly deferred (see Non-goals).

## Context / background — what exists today (verified 2026-09-01, five-reader audit)

Do not rebuild what's here; the blockers are precise:

- **One payment per `quotes` row, structurally.** `finalisePaidQuote` claims with
  `.is('paid_at', null)` (`lib/quote/paid-confirm.ts:78-96`); the webhook skips any second
  session for a paid quote (`app/api/stripe/webhook/route.ts:211-214`). There is no payments
  ledger — payment state is single-slot columns on the row.
- **Electrical/plumbing deposits are unreachable.** `SITE_VISIT_FIRST_TRADES =
  ['electrical','plumbing']` (`lib/quote/mint-tier.ts:37`); `resolveGenericMintTier` 302s every
  G/B/B mint to `/r/<token>/inspection` (`mint-tier.ts:70-79`, applied at
  `app/r/[token]/[tier]/route.ts:324-337`).
- **A paid row is frozen.** Edit / chat-edit / send all 409 on `paid_at`
  (`app/api/quote/[id]/edit/route.ts:178-181` etc.). The only post-payment action is
  `POST /api/quote/[id]/complete`, which **releases** the held funds to the tradie's bank —
  it never charges the customer.
- **"Credited toward your final quote" is copy, not code.** No arithmetic anywhere subtracts
  the $99 from a later charge (`lib/stripe/checkout.ts:393` is a product description).
- **`quotes.deposit_pct`** exists (numeric, default 30, clamped 1–90 at the mint —
  `app/r/[token]/[tier]/route.ts:254-260`) but nothing per-job-type sets it; draft/edit
  hardcode 30. Solar's `pricing_book.overlays.solar_rate_card.deposit_pct` is the config
  precedent; overlays additions need no migration (see mig 044).
- **Job type is resolvable at the mint.** `quotes.intake_id → intakes.job_type`;
  `'ev_charger'` is canonical (`lib/intake/schema.ts:19`); the `/r` route already selects
  `intakes.job_type` on every click (`route.ts:165-169`). Mig 192 seeded provisional EV
  bounds for Jon.
- **The 2% fee is deducted, not surcharged.** `PLATFORM_FEE_PCT = 2` applied as
  `application_fee_amount` on destination charges (`lib/stripe/connect.ts:24-29,79-85`) —
  it comes out of the tradie's settlement; the customer pays exactly the advertised amount.
- **Charges are inc-GST**; `totalIncGstCents` ×1.1 when `gst_registered`
  (`lib/quote/money.ts:55-61`). The 2% fee has no GST modelling.
- **Solar's twin-row trick** is the in-repo precedent for one job spanning multiple `quotes`
  rows sharing a funnel.

### Design decision — chained quote rows, not a payments ledger

Each customer charge lives on its **own `quotes` row**, so the one-payment-per-row invariant,
the webhook claim, `payRedirectTarget`, and the Connect payout release all work **untouched**.
A job becomes a chain: initial row ($99 site visit, unchanged) → final-quote row (deposit) →
balance row (final payment), linked by `parent_quote_id`. The "$99 less" credit is **price
math on the deposit charge**, not ledger math. A proper `quote_payments` ledger (per-purpose
columns, lifecycle states) is the deliberate later upgrade — rejected for now because it
rewrites webhook idempotency and the release path, the exact money code where this repo has
grown silent-failure bugs.

## Requirements

**R1 — Schema: chain columns.** New migration (+ `_down` + `scripts/run-migration-NNN.mjs`,
per repo convention): `quotes.parent_quote_id uuid NULL REFERENCES quotes(id)` and
`quotes.quote_kind text NOT NULL DEFAULT 'initial'` with
`CHECK (quote_kind IN ('initial','final','balance'))`. Existing rows stay `'initial'`.

**R2 — Per-job-type deposit % config.** Store a map in the tenant's trade pricing book:
`pricing_book.overlays.deposit_pct_by_job_type`, e.g. `{"ev_charger": 50, "default": 30}`
(zero-migration, mig-044 precedent). A pure resolver
`resolveDepositPct(overlays, jobType): number` — exact `job_type` key, else `"default"` key,
else 30; result clamped 1–90 via the existing `clampDepositPct`. Unit-tested. For Thursday,
Jon's electrical book gets `{"ev_charger": 50, "default": 30}` seeded (script or SQL, not UI —
an editor is a non-goal).

**R3 — "Issue final quote" tradie action.** On a site-visit-paid (`paid_at` set,
`paid_tier='inspection'`) electrical/plumbing quote, the dashboard offers **Issue final
quote**. It creates ONE linked child row (`quote_kind='final'`, `parent_quote_id`, fresh
`public_token`, same `intake_id`/customer/tenant), prefilled from the parent's drafted
tiers/line items. Idempotent: if an open (unpaid, un-superseded) final child already exists,
return it instead of creating another. The child is editable with the existing quote editor
(the parent stays frozen). `deposit_pct` is stamped on the child at creation from R2's
resolver.

**R4 — Final quote shape: one confirmed price.** The final quote carries a single confirmed
price (stored in the `good` jsonb slot; `better`/`best` null). The existing `/q/[token]` page
renders it as a single option with an acceptance CTA. Send-to-customer reuses the existing
send path (SMS via tenant number with the `/q` link); it is tradie-triggered, never auto.

**R5 — Deposit mint on the final row.** `/r/<child-token>/good` mints a deposit Checkout
Session:
`deposit_charge = max(0, round(deposit_pct% × total_inc_gst) − 9900)` cents, then
`unit_amount = deposit_charge × 1.02` (R7). The `/q` page and Stripe line description show
the maths: deposit at X%, "less $99 site visit credit". Gate changes:
`resolveGenericMintTier` keeps the SITE_VISIT_FIRST redirect **only for
`quote_kind='initial'`** — `final`/`balance` rows mint normally. The `canTakePayment`
(bookable-windows) gate does NOT apply to `final`/`balance` mints — the visit already
happened; there is nothing to book. Everything else (Connect `transfer_data`,
`application_fee_amount`, webhook confirm, `/paid` router) is reused unchanged.

**R6 — "Request final payment" tradie action.** On a deposit-paid final row, the dashboard
offers **Request final payment** (usable from the job, on the phone). It creates the linked
balance row (`quote_kind='balance'`, parent = final row, idempotent as in R3) with
`balance = total_inc_gst − round(deposit_pct% × total_inc_gst)` cents (the $99 credit was
already absorbed by the deposit; $99 + deposit_charge + balance = total × 1 exactly, fees
aside), mints its session at `balance × 1.02`, and texts the customer the pay link. 409 if
the deposit is not yet paid. After it's paid, the existing Payouts "Mark complete & release"
releases each paid row's held funds as today.

**R7 — 2% fee on top.** Deposit and balance mints charge the customer
`amount × 1.02` (rounded to cents) while `application_fee_amount` continues to take 2% of the
charged amount for the platform. The $99 site visit stays flat $99 (it is advertised
verbatim across SMS/pages/PDF) — the fee-on-top applies to the new mints only. The surcharge
appears as its own line ("Card & platform fee 2%") in the Stripe session and on `/q`.

**R8 — Zero-deposit edge is first-class.** If `round(deposit_pct% × total) ≤ 9900`, the
deposit step is skipped: the final row is marked deposit-satisfied at send time (the $99
covers it), the customer's `/q` page says so, and **Request final payment** becomes available
immediately with `balance = total − 9900`.

**R9 — Pipeline sanity.** The dashboard pipeline/KPI view must not triple-count a chained
job: child rows group under (or are attributed to) their root; conversion KPIs count the root
once. Minimal treatment is fine (badge "Final quote" / "Balance" + exclude children from the
quote-count KPIs); a full grouped UI is not required.

**R10 — Strategy log.** Append a `docs/strategy.md` iteration entry (v22) documenting: the
post-visit sequence, the chained-row model, fee-on-top, the per-job-type deposit map, and the
scoping of the `canTakePayment` invariant to booking-first mints. Run the `strategy-reviewer`
agent after editing, per repo convention.

**R11 — Tests.** Vitest: deposit resolver (R2), mint maths incl. the $99 credit, the ≤$99
edge (R8), fee rounding, kind-gated `resolveGenericMintTier`, idempotent child creation.
The existing suite must stay green — the `'initial'` flow is untouched by construction.
Supabase/Twilio calls follow the house rule: check `{ error }`, never bare-await.

## Non-goals

- **GHL integration** (inbound webhook or status writeback) — Jon has an account; explicitly
  deferred. The Meta→SMS entry needs no code.
- **Meta lead-ads API** integration.
- **Payments ledger refactor** (per-purpose paid columns / `quote_payments`) — the named
  upgrade path, not this build.
- **A dashboard editor for the deposit map** — seed Jon's via script; UI later.
- **Per-tenant fee %** — 2% stays the platform constant; only its incidence changes.
- Any change to solar, roofing, painting, or commercial-painting money paths, or to the $99
  initial flow for existing tenants.
- Auto-sending final quotes (tradie-triggered only).

## Constraints

- Next.js 16 App Router — read `node_modules/next/dist/docs/` before writing Next code
  (AGENTS.md).
- DB changes = numbered migration + `_down` + runner script; keep `sql/init.sql`
  representative.
- Currency ex-GST stored, inc-GST displayed; cents everywhere; AU English, no emoji
  (design system).
- Deadline pressure: Jon onboards **Thursday 12:00**. The deposit chain may land in the days
  after; Thursday minimum is the live $99 flow + SMS entry (see Launch dependencies).
- Webhook fast-ack and `MessageSid`/session idempotency conventions unchanged.

## Launch dependencies (ops, not code — Thursday critical path)

1. **Stripe live**: start the live Connect platform review immediately (days of lead time);
   live `STRIPE_SECRET_KEY`, two new live webhook secrets (`/api/stripe/webhook`,
   `/api/stripe/connect-webhook`), re-run `scripts/setup-stripe-billing.mjs`,
   `STRIPE_PROVISIONING_ENABLED=true`.
2. **Prod preflight**: `GET /api/onboard/preflight` shows twilio/vapi mode `real`, nothing
   missing; Front Desk Railway `/api/sms/inbound` healthy.
3. **Jon's tenant**: invitation code → wizard (electrical) → activate → pricing wizard →
   toggle **Install EV charger** ON (seeds OFF) → confirm mig-192 EV rates with Jon →
   Connect KYC until `stripe_connect_payouts_enabled` flips.
4. Seed Jon's `deposit_pct_by_job_type` map (R2).

## Edge cases to handle

- Tradie clicks "Issue final quote" twice / double-submits → same open child returned, one
  SMS at most (R3 idempotency).
- Customer re-opens an old G/B/B link on the initial row → existing behaviour: 302 to the
  paid/booked state. Unchanged.
- `deposit_pct% × total ≤ $99` → deposit skipped, balance path opens (R8); never a $0 or
  negative Stripe session.
- Deposit link clicked after deposit paid → existing `payRedirectTarget` 302s to paid. Same
  for balance.
- "Request final payment" before deposit paid (or before final sent) → 409 with a clear
  code.
- Editing a final row after its deposit lands → existing `paid_at` 409 applies naturally.
- `job_type` null/unknown or overlays map absent → resolver falls back `"default"` → 30.
- Tenant not Connect-ready at mint time → existing behaviour (platform-direct charge, no
  throw); Jon's DoD requires Connect-ready so this is belt-and-braces.
- Webhook/`/paid` race on child rows → same `confirmPaidFromSession` claim; child sessions
  carry `quote_id` metadata like any other.
- Fee rounding: surcharge and deposit each rounded to whole cents once; asserted in tests so
  $99 credit + deposit + balance reconciles to total ± 1c never (exact by construction).

## Definition of done

- [ ] Migration NNN (+down +runner) applied: `parent_quote_id`, `quote_kind` exist;
      `init.sql` updated.
- [ ] On a site-visit-paid electrical quote, "Issue final quote" produces an editable child;
      sending it texts the customer a `/q` link showing one confirmed price, the deposit %
      resolved from the tenant map (EV charger job shows 50%), and the "less $99" line.
- [ ] Paying the deposit link charges exactly `max(0, dep%×total − $99) × 1.02` on a Connect
      destination charge; the quote row stamps paid via the existing webhook path.
- [ ] "Request final payment" texts a link that charges `(total − dep%×total) × 1.02`; after
      payment, Payouts release works on each paid row.
- [ ] A job whose deposit ≤ $99 skips straight to balance with the $99 credited.
- [ ] Initial `/r` G/B/B links for electrical still 302 to the $99 inspection; the whole
      existing test suite passes.
- [ ] Pipeline/KPIs count the chained job once.
- [ ] New vitest coverage per R11 green; `docs/strategy.md` v22 entry appended and
      strategy-reviewer run.
- [ ] Jon live checklist: real Twilio number answers SMS, live $99 payment lands in his
      Connect balance, deposit map seeded.

## Open questions

1. **Does the 2% apply to the $99 site visit too?** Spec assumes no (flat $99 preserved);
   confirm with Jon.
2. **GST treatment of the 2% surcharge** — displayed inc-GST like the rest, but is the fee
   itself a taxable supply by the platform or the tradie? Needs an accounting call before
   live; also check AU card-surcharge rules if it's ever framed as a card fee.
3. **Mig-192 EV pricing bounds are PROVISIONAL** ("confirm with Jon") — validate before his
   first real EV quote.
4. **Deposit cap**: money.ts clamps 1–90 while solar/painting overlay validators cap at 50.
   Spec uses 1–90 for this map; confirm nobody expects >50% blocked.
