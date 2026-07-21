# Booking flow — three-page split (customer view → book → thanks)

**Date:** 2026-07-22
**Status:** approved, not yet built
**Surfaces:** `/q/[token]`, `/q/roof/[token]`, `/q/paint/[token]` and their sub-routes

---

## Objective

Split the post-payment booking experience into two distinct pages so that a
booking page does one job (pick a time) and a thank-you page does the other
(confirm what happened). Today the roofing booking page does both at once.

The finished shape, identical on every funnel:

```
customer-view page   quote, tiers, PAY CTA
        ↓ Stripe checkout
booking page         calendar ONLY — pick a date, then a time slot
        ↓ POST book
thank-you page       video + next steps, amount paid, slot, how it was booked,
                     add-to-calendar (Google / Outlook / Outlook work / .ics)
```

---

## Current state (verified 2026-07-22, 52-agent map, 45/48 claims survived adversarial verification)

Four funnels run three different orders.

| Funnel | Table | Order | Picks a time at | Thank-you video |
|---|---|---|---|---|
| Electrical / plumbing | `quotes` | **book → pay** | `/q/[token]/book` (day-strip `SlotPicker`) | `/q/[token]/paid` |
| Solar | `solar_estimates` + twin `quotes` row | **book → pay** (via the generic pages) | `/q/[token]/book` | `/q/[token]/paid` |
| Roofing | `roofing_measurements` | pay → book | `/q/roof/[token]/book` (month-grid `BookingCalendar`) | **on the booking page** |
| Painting | `painting_measurements` | pay → book | inline on the quote page | none anywhere |

Facts that shape the design:

- **`/q/roof/[token]/book` is the page in the brief.** It renders the thank-you
  video hero (`book/page.tsx:172-188`), the calendar (`:208-216`), the booked
  state, and `AddToCalendar` (`:199-206`) — all on one page.
- **Two pickers exist for one job.** `SlotPicker` honours the API's `next`
  field (`SlotPicker.tsx:94-100`); `BookingCalendar` discards it and reloads
  `window.location.pathname` (`BookingCalendar.tsx:126-128`). Both POST to
  `/api/q/book/roof/<token>`, so the same action lands the customer on two
  different pages depending on which page they started from.
- **`AddToCalendar` already covers every calendar the brief asks for** —
  `.ics` download as primary, plus Google, Outlook.com and Outlook 365 web
  deep-links (`parts.tsx:640-678`). No new calendar code is needed.
- **`roofing_measurements` and `painting_measurements` have no paid-amount
  column.** Only `paid_tier` + `paid_stripe_session_id` (mig 165). `$99` lives
  in code (`INSPECTION_FEE_AUD`). `paid_amount_cents` exists on `quotes` only
  (mig 160).
- **The early-booking discount is realised in the book route**, gated on
  `!alreadyPaid` (`api/q/[token]/book/route.ts:268`), then read back at Stripe
  mint time (`r/[token]/[tier]/route.ts:181`).
- **`/r/[token]/[tier]` with an unpaid deposit and no slot loops.** It returns
  `kind: 'book'` → `/q/[token]/book`, whose `NoSlotsPayState` CTA points back at
  `/r/[token]/[tier]`. With no slots published the customer can never reach
  Stripe.
- **`/r/solar/[token]/[tier]` is dead code.** It selects `token`, `paid_at`,
  `scheduled_at`, `stripe_links` from `solar_estimates`; none of those columns
  exist (the real one is `public_token`), so it 404s before reaching its
  redirect. Its redirect targets `/q/solar/[token]/book|paid` do not exist
  either. Nothing in the app links to it. Already noted in
  `specs/quote-report-booking-calendar-sync.md:86-88`.

---

## Design

### R1 — Route map

| Funnel | Customer view | Booking | Thank-you |
|---|---|---|---|
| Electrical / plumbing / solar | `/q/[token]` | `/q/[token]/book` | `/q/[token]/thanks` **(new)** |
| Roofing | `/q/roof/[token]` | `/q/roof/[token]/book` | `/q/roof/[token]/thanks` **(new)** |
| Painting | `/q/paint/[token]` | `/q/paint/[token]/book` **(new)** | `/q/paint/[token]/thanks` **(new)** |

Solar gets no pages of its own — it books on the generic pages through the
existing token twinning (`lib/solar/persist-helpers.ts:161`).

### R2 — One picker

`BookingCalendar` becomes the only slot picker on every funnel: a month grid,
tap an available date, that date's time windows appear beneath, a sticky
confirm bar commits. This is literally the interaction the brief describes
("selects a date and then chooses the desired time slot").

`SlotPicker` is **deleted**. Its three call sites (generic book page, paint
quote page, roof legacy branch) move to `BookingCalendar`.

`BookingCalendar` is changed to honour the API's `next` field, exactly as
`SlotPicker` does today. This is the root-cause fix for the divergent-landing
bug, not a patch at one call site.

### R3 — Booking page: calendar only

Every `/book` page renders, and renders only:

- letterhead / chrome for the funnel
- a one-line instruction
- `BookingCalendar`
- a back link to the quote

Explicitly **removed** from `/q/roof/[token]/book`: the thank-you video
section, the booked-state prose, and `AddToCalendar`.

States:

| Condition | Behaviour |
|---|---|
| token not found | 404 |
| not paid | redirect to the pay short-link for that funnel |
| paid, already has `scheduled_at` | **redirect to `/thanks`** |
| paid, no slot, slots available | render `BookingCalendar` |
| paid, no slot, no slots available | "your tradie will text you to arrange a time" (existing `BookingCalendar` empty state) |

### R4 — Thank-you page

Paid-gated and slot-gated: no `paid_at` → pay short-link; no `scheduled_at` →
`/book`. Renders:

1. Tradie thank-you video (`trustVideoUrls(identity).thankyou`) + next-steps copy.
2. A **What's booked** card:
   - Tradie
   - Job
   - Visit — `formatVisitSlot(scheduled_at, scheduled_window, tz)`
   - Address / suburb
   - Quote ref — `token.slice(0, 8).toUpperCase()`
   - **Paid (inc GST)** — the real charge (see R6)
   - **Booked** — `Online · self-serve · ref <QUOTE REF>`
3. `AddToCalendar` — `.ics` primary, Google / Outlook / Outlook (work) secondary.
4. Download quote PDF, where the quote is priced.

### R5 — Funnel reversal: pay first, everywhere

`payRedirectTarget` currently returns `'book'` for an unpaid deposit tier with
no slot. It returns `'stripe'` instead. Every funnel becomes pay → book →
thanks.

`/q/[token]/paid` stops being a rendered page and becomes the Stripe landing
**router**. It keeps `confirmPaidFromSession` — the webhook-race guard is
load-bearing and must not be lost — then redirects:

- paid, no slot → `/q/[token]/book`
- paid, slot → `/q/[token]/thanks`
- not paid → `/q/[token]` (payment still settling)

Stripe `success_url` values are unchanged; `/paid` keeps absorbing them.

### R6 — Consequences that must be handled, not skipped

**R6a — No-slots payment guard.** A pay CTA must not mint a Stripe session when
the tenant has zero bookable windows. `/r/[token]/[tier]`, `/r/roof/…`, and
`/r/paint/…` resolve the tenant's booking options first; when the list is
empty they redirect back to the quote page with a notice ("your tradie will
text you to arrange a time") instead of charging. This also removes the
existing `/r → /book → /r` redirect loop.

**R6b — Early-booking discount.** Under pay-first the book route's
`!alreadyPaid` branch never runs, so the discount would silently stop applying.
Realisation moves to the Stripe mint in `/r/[token]/[tier]`: read
`early_bird_discount_pct` + `early_bird_expires_at`, apply if still inside the
window, and stamp `applied_discount_pct` at that point. The book route's
realisation block is removed.

**R6c — Amount paid.** Migration adds `paid_amount_cents bigint` to
`roofing_measurements` and `painting_measurements`, stamped from the Stripe
session's `amount_total` by both the webhook and the page-level race guard.
The thank-you page shows the recorded amount; it falls back to
`INSPECTION_FEE_AUD` only for legacy rows with a null amount and
`paid_tier = 'inspection'`.

### R7 — Dead code removal

Delete `app/r/solar/[token]/[tier]/route.ts` and its test. It is unreachable,
queries non-existent columns, and points at pages that will not exist.

---

## Non-goals

- No change to how slots are generated (`resolveBookingOptions`,
  `generateAvailabilityWindows`) — the source of truth for availability is untouched.
- No change to Stripe Connect, tier pricing, or the estimate pipeline.
- No new calendar-provider integrations beyond what `AddToCalendar` already renders.
- No redesign of the quote/customer-view pages themselves.
- `quote_line_items` stays unused.

---

## Definition of done

1. `npm test` passes — including new unit tests for the pay-first redirect
   table, the no-slots guard, the discount move, and the amount resolver.
2. `npm run test:e2e` passes — existing book-first assertions rewritten to the
   pay-first contract, plus new coverage:
   - `/book` renders a calendar and contains no video element
   - a successful booking POST lands on `/thanks`
   - `/thanks` shows amount paid, slot label, booking ref, and calendar links
   - an unpaid visitor reaches neither `/book` nor `/thanks`
   - a tenant with no published slots is not charged
3. `npm run typecheck` and `npm run lint` clean.
4. Browser-verified with Playwright on all three funnels.
5. `SlotPicker` no longer exists in the tree; no page renders both a picker and
   a thank-you video.

---

## Risks accepted

Customers now pay before confirming a time exists. R6a removes the
zero-slots case; the residual risk is a customer who dislikes every offered
window after paying. Mitigation is the existing refundable-deposit position
and the tradie-arranges-a-time SMS path.

This reverses the documented `WP6 reorder: BOOK FIRST, PAY LAST` decision for
deposit tiers. An iteration entry is owed in `docs/strategy.md`.
