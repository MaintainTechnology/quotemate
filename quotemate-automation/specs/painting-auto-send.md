# Painting auto-sends: retire the tradie review gate

Date: 2026-08-07
Status: ready to build
Supersedes: the "painting is review-required" decision in CLAUDE.md's decision
table and `docs/strategy.md` (owner decision, 2026-08-07)

## Product decision

A painting quote goes **straight to the customer** — price visible, quote page
live, $99 site visit payable — with no tradie verification step. Painting joins
roofing / electrical / plumbing on auto-send.

**Why now.** The gate existed because painting prices are inferred (Google Solar
footprint + street-view area), and the customer was previously asked for a **30%
deposit** — ~$6,400 on a $21,432 quote — against a number nobody had checked.
Since `docs/strategy.md` v19 the only customer payment is the **flat $99
refundable site visit**, with the final price confirmed on site. The exposure
the gate protected against is gone.

**And the gate is actively failing.** Verified 2026-08-06: of 8 recent releases,
**3 sent no SMS at all** and 2 more had no `customer_phone` yet were still
stamped released. The route stamps `released_at`, discards
`sendPaintingQuoteToCustomer`'s `{ sent }`, and returns `{ ok: true }`
unconditionally — so the tradie sees "Sent" and the customer gets nothing. A
manual gate that silently drops a third of its sends is worse than no gate.

## Background — verified current behaviour

- Two origins today:
  - **SMS receptionist / self-serve form** → drafted and HELD. Customer gets
    `buildPaintingHoldingSms` ("…is preparing your painting quote"); prices hidden.
  - **Dashboard-authored** (`app/api/painting/save/route.ts:74`) → already
    `releasedAt: new Date()`, released at save. **This path is the model.**
- Three layers all key off `released_at`: `canShowPaintingPrices`
  (`lib/painting/publish-gate.ts`) gates the page; `resolvePaintMintTier`
  (`lib/painting/pay-redirect.ts`) gates the $99 mint; the release endpoint
  sends the quote SMS.
- Live data: 34 measurements, 24 released, **10 held right now**, mean
  time-to-release 2 minutes.

## Requirements

### R1 — auto-release at draft time

Both held origins stamp `released_at` when the estimate is saved, exactly as
the dashboard path already does:
- `lib/sms/painting-estimate-dispatch.ts` (SMS receptionist)
- `app/api/paint-request/[token]/route.ts` (self-serve form)

Inspection-routed rows keep their existing behaviour (no price to show).

### R2 — send the quote, not a holding message

Where those two paths currently send `buildPaintingHoldingSms`, they send the
**full quote delivery** instead (`composePaintingQuoteDelivery` — tier prices,
`/q/paint/[token]` link, PDF link, the one $99 site-visit link, MMS preview),
i.e. the same message the release endpoint sends today.

`buildPaintingHoldingSms` stays in the codebase for the inspection-routed and
error paths; do not delete it.

### R3 — the send can no longer fail silently  ⚠ load-bearing

With no tradie in the loop, a dropped send is invisible. Therefore:
- `sendPaintingQuoteToCustomer` already returns `{ sent }`. Every caller must
  **use** it.
- `app/api/painting/release/[token]/route.ts` returns `{ ok, sent }`;
  `SendToCustomerButton` shows "Sent" only when `sent === true`, and surfaces
  an error (retry available) otherwise. It must never claim a send that did
  not happen.
- On any auto-send failure, **notify the tradie** via the existing
  `notifyPaintingTradie` path with wording that says the customer was NOT
  texted and the quote needs manual follow-up. Never swallow.
- A row with no `customer_phone` must not report success anywhere.

### R4 — the release endpoint stays (resend)

`/api/painting/release/[token]` remains for the on-site-edit resend flow and
for retrying a failed auto-send. Releasing an already-released row stays
idempotent (no re-stamp), and `{ resend: true }` still re-texts.

### R5 — the tradie is still told

The existing `notifyPaintingTradie` alert on every new painting quote is
unchanged — the tradie still learns about the job immediately, they just are
not a gate. The `/p/[token]` review page keeps working for edits + resend.

### R6 — docs

- `docs/strategy.md`: new **v21** iteration entry — painting joins auto-send;
  why the v19 $99 change removed the gate's rationale; the 3-of-8 silent-send
  failure data; note that commercial painting and solar are unchanged.
- Root `CLAUDE.md`: the "Auto-send vs review-required" decision row, the
  painting pipeline paragraph, and the review-gates section.

### R7 — constraints

- **Commercial painting and solar keep their existing gates.** This is
  residential painting only.
- `canShowPaintingPrices` / `paintingDepositLocked` / `resolvePaintMintTier`
  keep their signatures and semantics — they simply stop seeing held rows from
  these two origins. Do not weaken the gate functions themselves; a genuinely
  unreleased row must still be withheld.
- No money-path changes: the $99 mint, checkout, and webhook are untouched.
- No new dependencies.

## Definition of done

1. `npx tsc --noEmit` clean; full `npx vitest run` green.
2. Tests: auto-release stamps `released_at` on both origins; the quote SMS
   (not the holding SMS) is sent; a send failure returns `sent: false`,
   surfaces in the button, and notifies the tradie; inspection-routed rows
   unchanged; commercial painting and solar untouched.
3. Review confirms R1–R7 with file:line evidence, and explicitly verifies no
   path can report a send that did not occur.
