---
title: Painting Auto-Send and Release Gates
type: reference
area: payments
tags: [quotemax, painting, release-gate, auto-send, invariants, stripe]
status: draft
updated: 2026-09-04
sources:
  - quotemate-automation/lib/painting/release.ts
  - quotemate-automation/lib/painting/quote-dispatch.ts
  - quotemate-automation/lib/painting/publish-gate.ts
  - quotemate-automation/lib/painting/pay-redirect.ts
  - quotemate-automation/app/api/painting/release/[token]/route.ts
  - quotemate-automation/app/r/paint/[token]/[tier]/route.ts
  - quotemate-automation/app/p/[token]/page.tsx
  - quotemate-automation/sql/migrations/189_painting_quote_sent_at.sql
---

# Painting Auto-Send and Release Gates

This is the highest-consequence invariant in the product. A residential painting
quote **auto-sends**: nothing waits for a human, so if a send silently fails there
is no second witness. Every rule below exists because a specific version of that
failure happened on live traffic.

Read [[Painting Receptionist]] for the conversation that leads here, and
[[What the Customer Pays by Trade]] for why the only payment in the message is a
flat $99.

## Two columns, two questions — never conflate them

`painting_measurements` carries both. They answer different questions and are
written at different moments by different code.

| Column | Migration | Question it answers | Written when |
|---|---|---|---|
| `released_at` | `sql/migrations/157_painting_release_gate.sql` | **MAY the customer see prices?** | at save time (auto-send), or by the tradie's Send |
| `quote_sent_at` | `sql/migrations/189_painting_quote_sent_at.sql` | **WAS the quote actually delivered?** | only after a carrier **accepted** the message |

The column comment written by migration 189 states it directly:

> When a carrier ACCEPTED the customer quote SMS/MMS. Evidence of delivery —
> distinct from `released_at` (the price-visibility gate). Never set
> optimistically, and never backfilled: an attempted send is not an accepted one.
> — `sql/migrations/189_painting_quote_sent_at.sql:38-41`

`app/p/[token]/page.tsx:86-95` restates it at the read site, and derives two
separate booleans (`released`, `quoteSent`) rather than one.

### ⚠ Why there was no backfill

Migration 189 deliberately leaves every existing row `NULL`
(`189_painting_quote_sent_at.sql:15-31`). An earlier draft would have backfilled
`quote_sent_at = released_at` for leads with `created_by IS NULL` — a predicate
that matched exactly the 8 live rows, **3 of which had texted nobody**. Stamping
them would have written "delivered" onto three undelivered quotes.

There was no evidence to separate them either: `sendPaintingQuoteToCustomer` calls
`sendSms` directly and never writes an `sms_messages` row, so the thread cannot
distinguish the 5 from the 3 (`:24-26`). The asymmetry decided it — a duplicate SMS
is recoverable, a silent drop is what the whole spec exists to stop.

## The ordering invariant

**`released_at` MUST be written BEFORE the send.** Not after, not concurrently.

Because three customer-facing surfaces gate on it, and all three have to resolve
by the time the customer taps a link in the message they have just received:

| Surface | Gate | Where |
|---|---|---|
| `/q/paint/[token]` quote page | `canShowPaintingPrices({ releasedAt })` | `app/q/paint/[token]/page.tsx:227` |
| `/r/paint/[token]/inspection` $99 mint | `resolvePaintMintTier(tier, routing, released)` | `app/r/paint/[token]/[tier]/route.ts:85-92` |
| AI repaint "after" image | `if (!row.released_at) return streetViewFallback(...)` | `app/api/painting/q/[token]/after-image/route.ts:100`, `:144` |

So `runAndSavePaintingQuote` stamps it in the insert row itself:

```
releasedAt: inspection ? null : new Date().toISOString(),
```
`lib/painting/quote-dispatch.ts:101`, with the reason in the comment above it:
"the quote page, the PDF route and the $99 site-visit mint all gate on
`released_at` — so the stamp has to land BEFORE the send, not after it"
(`:94-96`). An inspection-routed row has no price to show and keeps its `null`.

**The consequence of stamping first** is that a stamp is a *promise* of a delivery
that has not happened yet. That promise has to be retractable — which is the next
invariant.

## Every send path returns `{ sent }`

There is no boolean-free send anywhere in this flow. The type of every function
that puts a painting quote in front of a customer carries the outcome:

| Function | Returns | File |
|---|---|---|
| `autoSendPaintingQuote` | `{ sent: boolean }` | `lib/painting/release.ts:161-193` |
| `sendPaintingQuoteToCustomer` | `{ sent: boolean }` | `lib/painting/release.ts:203-262` |
| `markPaintingQuoteSent` | `{ marked: boolean }` | `lib/painting/release.ts:87-109` |
| `revertPaintingRelease` | `{ reverted: boolean }` | `lib/painting/release.ts:125-149` |
| `notifyPaintingTradie` | `{ notified: boolean }` | `lib/painting/release.ts:42-78` |
| `estimateAndDispatchPainting` | `PaintingEstimateDispatchResult` | `lib/sms/painting-estimate-dispatch.ts:37` |
| `POST /api/painting/release/[token]` | `{ ok, sent, released_at, public_token }` | `app/api/painting/release/[token]/route.ts:117` |

The receptionist's own `sendReply` closure feeds that chain: the route passes
`send: async (text, mmsUrl) => (await args.sendReply(text, mmsUrl)).ok === true`
(`painting-estimate-dispatch.ts:114`) — the `=== true` is deliberate, not
defensive noise. The `sendReply` doc comment says it plainly: "The dispatch result
is USED — `ok: false` means the customer got nothing"
(`painting-estimate-dispatch.ts:44-46`).

**Never return `ok` without `sent`.** That pairing is exactly how 3 of 8 live
releases texted nobody while `/p` showed "Sent".

## The rollback

`autoSendPaintingQuote` (`lib/painting/release.ts:161-193`) is the single place
compose → send → record lives, so the SMS/voice receptionist and the self-serve
form cannot drift on the one rule that matters:

```
if (sent) await markPaintingQuoteSent(args.supabase, args.disp.token)
else      await revertPaintingRelease(args.supabase, args.disp.token)
```
(`:189-190`)

Back at `released_at = null` the row is **held again**: prices withheld on the
quote page, the $99 mint 302s back to the holding message, and `/p` offers "Send to
customer" so the tradie can retry (`:111-118`). The customer gets
`buildPaintingHoldingSms` — an expectation without a price
(`painting-estimate-dispatch.ts:117-126`) — and the tradie gets the failure variant
of the alert, which says in plain words the customer received **nothing**
(`lib/sms/painting-compose.ts:196-201`).

## The silent-failure bug class

Two libraries in this path **resolve on failure instead of throwing**. A bare
`await` on either is the bug, and the codebase names it repeatedly:

- **supabase-js** resolves `{ data, error }`. `revertPaintingRelease`'s doc
  comment: "a bare `await` here would swallow a failed rollback exactly like the
  bare `await sendSms` that started all this. Callers MUST honour
  `reverted: false` and not report the row as held" (`lib/painting/release.ts:119-123`).
- **`sendSms`** resolves `{ ok: false }` on a Twilio rejection.
  `sendPaintingQuoteToCustomer:245-247`: "Returning `sent: true` off the bare await
  was the silent failure this spec exists to close."

The same discipline appears wherever this flow touches Supabase:

| Site | What is checked |
|---|---|
| `lib/painting/release.ts:96` | `markPaintingQuoteSent` — non-fatal, returns `marked: false` |
| `lib/painting/release.ts:134` | `revertPaintingRelease` — returns `reverted: false` |
| `app/api/painting/release/[token]/route.ts:89` | `release_failed` 500 if the stamp write errors |
| `app/api/painting/release/[token]/route.ts:106-107` | `releasedAt = null` **only if** `reverted` |
| `app/api/sms/inbound/route.ts:1403-1413` | `painting_state` persist — error logged, counters warning |
| `app/api/sms/inbound/route.ts:1372-1379` | outbound `sms_messages` insert |

**Invariant.** A write whose `error` is not read has not been checked, and a
`sent`/`reverted` flag you did not propagate is a lie the next surface will repeat.

## What breaks if the release send is re-deferred into `after()`

`app/api/painting/release/[token]/route.ts:12-18` is explicit:

> The send is AWAITED, not deferred to `after()`, because the response reports
> `{ sent }` and `/p` shows "Sent" only on `sent === true`. Deferring it is what
> let 3 of 8 live releases stamp `released_at`, return `ok:true` and text nobody.

Concretely, re-deferring breaks four things at once:

1. **`{ sent }` becomes unknowable.** The response is composed before the deferred
   work runs, so the route can only report the *attempt*. `/p` then renders a
   "Sent" state off a value nothing verified.
2. **The rollback cannot run inside the request.** `revertPaintingRelease` is
   conditional on `!sent && eligibility.stamp` (`:101-108`). With the send outside
   the request, the stamp is already committed and the response already returned —
   `released_at` stays set on a quote nobody received. The customer page shows
   prices, the $99 mint is live, and the row looks delivered.
3. **The failure alert never fires.** `notifyPaintingTradie(..., customerTexted: sent)`
   is the *only* witness now that the review gate is retired
   (`lib/painting/release.ts:38-40`). Deferred, it either never runs or runs with
   an optimistic `true`.
4. **`quote_sent_at` loses its meaning.** It is written only on acceptance
   (`markPaintingQuoteSent`). A deferred send either stamps it late (so `/p` shows
   "not sent" while the customer holds the quote) or, worse, is stamped
   optimistically alongside `released_at` — which re-creates the exact conflation
   migration 189 was written to end.

### The one thing that IS deferred, and why

`after(() => generatePaintAfterImage(...))` (`route.ts:114`). The AI repaint
pre-warm went **back** into `after()` because 10-20 s of image generation inline
could push the request past `maxDuration = 60` and **skip the rollback entirely**
(`:16-18`, `:109-113`). It is safe to defer because the PDF self-heals: the cache
path embeds the repaint timestamp, so `ensurePaintingPdf` regenerates on the next
download once the image lands.

**The rule that distinguishes them:** anything whose result the response reports,
or whose failure must be rolled back, stays inside the request. Anything the system
can heal later goes in `after()`.

## `/p` may read only `quote_sent_at` for "Sent to customer"

`app/p/[token]/page.tsx:94-95` derives `released` and `quoteSent` separately, and
`SendToCustomerButton.tsx:23-25` documents its prop as
"`painting_measurements.quote_sent_at` present — a carrier ACCEPTED the quote
message. Never `released_at`: a dashboard save stamps that and texts nobody."

Four populations have `released_at` set and `quote_sent_at` null, and every one of
them must leave the button actionable:

- a dashboard save (`app/api/painting/save/route.ts:74` stamps `released_at` and
  sends no SMS at all);
- a legacy held draft released before migration 189;
- an inspection-routed row (never released, never priced);
- an auto-send whose send failed *and* whose revert write also failed.

## Release eligibility

`paintingReleaseEligibility` (`lib/painting/publish-gate.ts:80-92`) is pure and
reads **both** columns:

| `released_at` | `quote_sent_at` | `resend` | Result |
|---|---|---|---|
| null | — | — | `stamp: true, send: true` — the first release |
| set | null | — | `stamp: false, send: true` — released but never delivered |
| set | set | false | `stamp: false, send: false` — idempotent no-op |
| set | set | true | `stamp: false, send: true` — post-edit resend |

The second row is the load-bearing one: without it the primary button was a dead
no-op on first press for the dominant population (every dashboard save), and only
worked on a second press (`publish-gate.ts:70-75`, `release/[token]/route.ts:70-72`).

## The customer-facing gates

```mermaid
flowchart TD
  A[painting_measurements row] --> B{routing}
  B -->|inspection_required| C[no price, $99 mint open]
  B -->|priced| D{released_at}
  D -->|null| E[holding message, mint 302s back]
  D -->|set| F[prices + $99 mint + PDF]
  F --> G{quote_sent_at}
  G -->|null| H[/p offers Send]
  G -->|set| I[/p shows Sent]
```

A held draft also cannot bill a Gemini render: the after-image route falls back to
Street View on `!released_at` (`app/api/painting/q/[token]/after-image/route.ts:100`),
even though the repaint auto-generates on first load of the quote page
(`app/q/paint/[token]/page.tsx:387-392`).

- **`canShowPaintingPrices`** (`publish-gate.ts:39-48`) — an unreleased row shows
  "Your painter is finalising your quote…", not a number. ⚠ Still load-bearing
  after auto-send: it is what withholds a legacy held draft **and** a row whose send
  failed and was rolled back (`publish-gate.ts:4-9`).
- **`resolvePaintMintTier`** (`pay-redirect.ts:35-45`) — `inspection` is payable
  when the row is inspection-routed **OR** released. G/B/B resolve as legacy
  `deposit` so the route can 302 them; anything else is `invalid`. A held row 302s
  to `/q/paint/<token>` rather than a bare 400 (`r/paint/[token]/[tier]/route.ts:90-92`).
- ⚠ **`paintingDepositLocked`** (`publish-gate.ts:56-58`) is **no longer consulted
  by `/r/paint`** — the release gate there is `resolvePaintMintTier`. It is kept for
  remaining callers and tests.

### ⚠ The PDF route does not check `released_at`

`app/api/q/paint/[token]/pdf/route.ts:24-37` selects only
`public_token, pdf_path, routing` and 404s solely on
`routing === 'inspection_required'`. A **held** priced row — one whose auto-send
failed and was correctly rolled back — is therefore still downloadable, with prices,
by anyone holding the public token. This is the painting half of the debt
`CLAUDE.md` records for the solar PDF route. The SMS body always carries this URL
(`lib/painting/quote-dispatch.ts:198`), so a partially-delivered MMS can leak a
price the quote page is withholding.

## The four origins

| Origin | Entry point | Auto-send helper |
|---|---|---|
| SMS receptionist | `handlePaintingTurn` → `estimateAndDispatchPainting` | `autoSendPaintingQuote` (`painting-estimate-dispatch.ts:107`) |
| Voice | `runVoiceTradeHandover` → `estimateAndDispatchPainting` | same |
| Self-serve form | `POST /api/paint-request/[token]` | `autoSendPaintingQuote` (`paint-request/[token]/route.ts:156`) |
| Dashboard save | `POST /api/painting/save` | none — stamps `released_at:74`, texts nobody |
| Tradie Send / resend | `POST /api/painting/release/[token]` | `sendPaintingQuoteToCustomer` |

The first three share `composePaintingQuoteDelivery`
(`lib/painting/quote-dispatch.ts:163-211`) so the message body — tier prices, the
`/q/paint/<token>` link, the PDF link, the one `$99` site-visit link, and the PDF
as an MMS attachment — cannot drift between them.

⚠ The dashboard-save row is the reason `/p` cannot key "Sent" off `released_at`,
and the reason `paintingReleaseEligibility` needs its "released, never sent" arm.

## No Stripe Sessions at draft time

`runAndSavePaintingQuote` mints **nothing** (`quote-dispatch.ts:125-131`). Draft
time used to create up to three per-tier 30 % deposit Sessions; since the site-visit
model nothing can link them (`/r/paint` 302s G/B/B onto the $99), and this function
is awaited *before* the customer's message — so those were three sequential Stripe
round-trips of pure latency producing dead links.

The one payable Session is minted on demand by `/r/paint/<token>/inspection` and
stored under `stripe_links.inspection`, with the replaced Session expired so a
second tab cannot complete an orphan (`r/paint/[token]/[tier]/route.ts:135-146`).

⚠ `CLAUDE.md` lists "draft/edit still writes per-tier Sessions into
`painting_measurements.stripe_links`" as live debt. On the **draft** path that is
now stale — the writes are gone. `app/api/painting/edit/[token]/route.ts` still
selects `stripe_links`, so the edit path is worth checking separately.

## Mint guards on `/r/paint/[token]/inspection`

In order (`app/r/paint/[token]/[tier]/route.ts:71-157`):

1. row exists → else 404;
2. `resolvePaintMintTier` → held rows 302 to the quote page;
3. `paid_at` set → 302 to `/q/paint/<token>/book`, never re-charge;
4. `canTakePayment({ bookableCount })` via `loadTenantBookingOptions` — pay-first
   means the customer commits before seeing times, so refuse the charge when the
   painter has published none (302 to `?slots=0`). ⚠ **Best-effort: a lookup
   failure lets payment through** (`:112-118`), and the whole block is skipped when
   `tenant_id` is null — the tenant-less hole `CLAUDE.md` records;
5. `connectDestinationForTenantId` → Connect routing; a tenant with no connected
   account mints platform-direct.

See [[Mint Routes and Guards]], [[Pay-First Booking Funnel]] and
[[Stripe Connect]].

## Open questions

- The `stripe_links` write in `app/api/painting/edit/[token]/route.ts` was not read
  in full here; whether it still mints per-tier deposit Sessions is unverified.
- Migration 157's exact column set was not read; `released_at` is cited from its
  call sites and from the migration filename.

## Related

- [[Painting Receptionist]]
- [[Painting]]
- [[What the Customer Pays by Trade]]
- [[Mint Routes and Guards]]
- [[Pay-First Booking Funnel]]
- [[Key Columns and Invariants]]
- [[Known Debt Register]]
- [[Quote PDFs and Reports]]
