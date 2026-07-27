# Tell the tradie when a roofing or painting customer books

## Goal

A tradie receives an SMS naming the customer, property, quoted figure and slot
the moment a roofing or painting customer picks a time — and that send is
recorded in the database, so "did the tradie get told?" is answerable by query
rather than by reading code.

Why: live on 2026-07-27, measurement `ff6f67cec0d503d571394338d07a23cf` (tenant
Sparky `6dca084c-10d5-4459-b48f-9b45e4bbc68a`, owner Jeph `+61480808517`) took a
$69,652 quote, a paid deposit and a Fri 31 Jul 12:00pm booking, and the tradie's
phone stayed silent. Two independent causes, below.

## Role

Principal engineer on this repo. Act directly on reversible edits and tests.
The money path is untouchable and must be *proved* untouched, not asserted.

## Context

Grounded in files opened for this spec.

**Why nothing arrived.** Two separate causes, only one of which is a bug:

1. `lib/sms/roofing-notify.ts:92` — `if (notifyMobile === args.customerPhone)
   return { notified: false }`. The tenant's `owner_mobile` and the test
   `customer_phone` are both `+61480808517`, so the `quote_sent` alert was
   skipped by design and logged nothing. Correct behaviour, untestable from the
   owner handset.
2. There is no booking alert for these trades at all.
   `app/api/q/book/[trade]/[token]/route.ts:111-139` records the slot and its
   `after()` block texts **only** the customer via `buildBookingConfirmationSms`.

**The convention to match.** `lib/quote/booking-notify.ts` already does this for
the quotes funnel (electrical/plumbing/solar): `notifyBookingConfirmed` texts
customer *and* tradie via `buildTradieBookingNotification`, called from
`app/api/book/[tenantId]/route.ts` and `lib/quote/paid-confirm.ts`. Line 141
states the contract verbatim: *"Tradie is notified only for a CONFIRMED booking
(a slot exists). The deposit-paid-but-unscheduled case nudges the customer
only."* Roofing was built as a parallel funnel and this half was never ported.

**One handler serves both trades.** `TRADE_BOOKING_TABLES` in
`lib/quote/trade-booking.ts` maps `roof → roofing_measurements` and
`paint → painting_measurements`. Wiring the booking route once covers both.

**The served total.** `lib/roofing/selection.ts:153 combinedTotalsForIndices` is
documented as *"THE canonical headline total … every surface derives its total
from here so they can never drift"*, and already applies the solar allowance.
`included_indices` is **1-based** (`quote.structures[i - 1]`;
`app/m/[token]/MeasurementReview.tsx` says so explicitly). For the live row
`included_indices = [1]` = Main dwelling = $69,652, while
`combined_better_inc_gst` = $115,117 — so reading the column would quote the
wrong figure. Painting stores its headline directly on
`painting_measurements.better_inc_gst`.

**Slot formatting.** `fmtSlotShort` (`lib/sms/templates.ts:571`) is module-private
and already timezone-aware; `tzForState` comes from `lib/quote/availability.ts`.
Both SMSes must use the one formatter or they can name different days.

**Persistence.** `dispatchQuoteMessage` (`lib/sms/dispatch.ts`) writes nothing to
the database — customer messages are persisted by their callers, tradie sends by
nobody. Zero tradie alerts exist in `sms_messages` on any trade.
`sms_messages.conversation_id` is `NOT NULL` with an FK to `sms_conversations`,
and it has no recipient column, so persisting a tradie send needs a migration.
Verified safe: **every** existing reader filters by `conversation_id` via `.eq`
or `.in` (`app/api/sms/inbound`, `intake/structure`, `cron/followup-2h`,
`tenant/me`, `tenant/chats`, `tenant/followups/messages`), so rows with a NULL
conversation are invisible to all of them — critically including the history fed
to the SMS receptionist model.

## Task

1. **`booking_confirmed` alert.** Add the kind to `RoofingNotifyKind` and a
   branch to `buildRoofingTradieNotification` in `lib/sms/roofing-notify.ts`.
   Export `fmtSlotShort` from `lib/sms/templates.ts` and use it. Add an optional
   `tradeLabel` (default `'roofing'`) used only by this branch so painting reads
   `painting job BOOKED`; every existing kind stays byte-identical.
2. **Fire it from the shared booking route.** In the existing `after()` block of
   `app/api/q/book/[trade]/[token]/route.ts`, after the customer SMS, call
   `notifyRoofingTradie`. Same try/catch — a failed alert must never undo a
   committed booking. Select the extra columns the alert needs in the existing
   row query. Roofing total via `combinedTotalsForIndices` +
   `resolveEffectiveIndices`; painting total from `better_inc_gst`.
3. **Self-test escape.** `TRADIE_NOTIFY_SELF_TEST=1` bypasses the
   `owner_mobile === customerPhone` guard. Default off. Both guard arms
   (`no notify number`, `self-test`) log the reason instead of returning silently.
4. **Persist tradie sends.** Migration adding `audience`, `to_number`,
   `tenant_id` to `sms_messages` and relaxing `conversation_id` to nullable, plus
   its `_down`. `dispatchQuoteMessage` inserts a row when
   `audience === 'tradie'`, best-effort — a failed insert must never fail the
   send.

## Constraints

- **Money path byte-identical.** `git diff --name-only` over
  `lib/roofing/pricing.ts`, `lib/roofing/measure.ts`,
  `lib/sms/roofing-measure-dispatch.ts`, `lib/painting/pricing.ts` must return
  empty. Prove it in the report.
- No change to quote wording, pricing, the measure pipeline, or any
  customer-facing SMS. `buildBookingConfirmationSms` output is unchanged.
- **Nothing fires on deposit-paid.** `recordRoofingSiteVisit` and
  `recordPaintingDeposit` in `app/api/stripe/webhook/route.ts` stay silent,
  matching `booking-notify.ts:141`.
- The three existing alert kinds keep their exact current wording.
- Step 4's migration touches production Supabase — write and test it, but
  **confirm before applying**. Steps 1-3 ship without it.
- 6777 tests pass now; 6777 + new pass at the end.

## Acceptance criteria & gates

**AC1** `buildRoofingTradieNotification({kind:'booking_confirmed', …})` renders
exactly:
```
Hi Jeph - roofing job BOOKED via SMS for Fri, 31 July, 12:00pm.
Customer: +61480808517
Property: 670 London Rd, Chandler QLD 4155
Quoted: $69,652 inc GST (deposit paid)
Details: https://www.quotemax.com.au/q/roof/ff6f67ce…
```
**AC2** `tradeLabel:'painting'` renders `painting job BOOKED`; the three existing
kinds render byte-identically to today (snapshot the current output first).
**AC3** The slot renders in the tenant's state timezone — a QLD tenant's
`2026-07-31T02:00:00Z` reads `Fri, 31 July, 12:00pm`, and matches the customer
confirmation for the same slot.
**AC4** The booking route notifies on success, with the **served** total
($69,652 for `included_indices=[1]`), never the combined $115,117.
**AC5** A throwing/failing notify still returns `{ok:true}` and leaves
`scheduled_at` committed.
**AC6** Guard: suppressed by default when `owner_mobile === customer_phone`;
sent when `TRADIE_NOTIFY_SELF_TEST=1`; both suppression paths log a reason.
**AC7** `dispatchQuoteMessage({audience:'tradie'})` writes one `sms_messages`
row with `audience='tradie'` and the recipient; `audience:'customer'` writes
none; a failed insert does not fail the send.
**AC8** No deposit-paid alert: the webhook's roofing and painting branches send
no SMS.

**Gates** — all must pass, every iteration:
```
npx vitest run                                   # 6777 + new, 0 failures
npx tsc --noEmit                                 # clean
git diff --name-only HEAD -- lib/roofing/pricing.ts lib/roofing/measure.ts \
  lib/sms/roofing-measure-dispatch.ts lib/painting/pricing.ts   # empty
```
End-to-end verify against token `ff6f67cec0d503d571394338d07a23cf` before done.

## Examples

<example>
The convention being ported — `lib/quote/booking-notify.ts:143-180`: resolve
`owner_mobile ?? TRADIE_NOTIFY_NUMBER`, guard on a slot existing, build the body,
`dispatchQuoteMessage({audience:'tradie'})`, log ok/err, never throw.
</example>

<example>
The house style to match — the three kinds already in
`lib/sms/roofing-notify.ts:29-66`: `Hi <name> - ` prefix, the event in CAPS
(`INSPECTION`), then `Customer:` / `Property:` / a link line.
</example>

<example>
Reading the served selection — `app/api/q/roof/[token]/pdf/route.ts:76-84`:
`resolveEffectiveIndices({included, confirmedStructure}, fullQuote)` then use it,
never trusting `included_indices` raw.
</example>

<example>
Best-effort deferred work that must not undo a commit —
`app/api/q/book/[trade]/[token]/route.ts:111-139`: everything inside `after()`
wrapped in try/catch, logging `booking IS committed` on throw.
</example>
