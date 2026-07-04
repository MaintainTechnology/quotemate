# SMS follow-up context fix + richer payment-confirmation page

**Date:** 2026-07-05
**Status:** Approved design — ready for implementation plan
**App:** `quotemate-automation/` (Next.js 16 App Router)

Two independent pieces of work, shipped as **separate commits**:

- **Part A** — Fix the SMS follow-up bug where a "TEXT" chase on one quote (e.g. Ceiling Fans) inherits an unrelated older conversation's trade state (e.g. roofing) and replies with the wrong scripted question ("Roughly how steep is the roof?").
- **Part B** — Enrich the customer payment-confirmation page (`/q/[token]/paid`) to confirm the job, offer a PDF download, and offer add-to-calendar.

No database migration is required for either part (all columns already exist).

---

## Part A — SMS follow-up must not inherit the old trade's context

### Problem

When a tradie clicks **TEXT** on a quote in the dashboard "TO CHASE" list, the follow-up SMS is threaded into the customer's **newest existing SMS conversation** for that phone number + tenant. If the customer had an earlier, still-open conversation about a *different* trade (roofing/solar), the follow-up lands on that thread. When the customer replies, the deterministic roofing/painting receptionists run **first** in the inbound handler and resume from the thread's stale `roofing_state` / `painting_state`, short-circuiting before the general dialog reads the follow-up pin — so the customer gets an irrelevant scripted question.

Observed: a Ceiling Fans follow-up → customer replies "Yes" → app replies "Roughly how steep is the roof? Flat, standard, or steep?"

### Root cause (confirmed in code)

- `app/api/tenant/followups/text/route.ts:191-234` — threads the outbound into the newest conversation by `from_number` + `tenant_id`, and pins the quote in the dedicated `followup_quote` column (migration 030). It does **not** clear the thread's stale `roofing_state` / `painting_state`.
- `app/api/sms/inbound/route.ts:1606` — the roofing receptionist runs first; `app/api/sms/inbound/route.ts:1633` — painting runs second. Both resume off the stale trade state and `return` on handling.
- `app/api/sms/inbound/route.ts:2128` — the general dialog only reads the `followup_quote` pin **after** those blocks, so the pin never gets a chance when a stale trade flow is active.
- `lib/sms/roofing-intake.ts:309` — source of the `pitch` prompt string.
- `lib/sms/followup-context.ts` — existing pin type (`FollowupQuoteContext`), TTL (`FOLLOWUP_PIN_TTL_DAYS = 14`), and helpers `parseFollowupQuoteContext`, `isFollowupContextActive`, `formatActiveFollowupContext`. The pin was built to solve exactly this class of collision ("toilet-vs-blocked-drain") for the general dialog.

### Fix (two layers, defense in depth)

**A1 — Clear stale trade state at the source.**
In `app/api/tenant/followups/text/route.ts`, whenever a `followup_quote` pin is written onto the threaded conversation (the `update` branch, and harmlessly the `insert` branch), also set `roofing_state = null` and `painting_state = null`. A follow-up always concerns an already-completed quote (it carries a total/tier), so any half-finished roof/paint intake on the thread is stale by definition.

**A2 — Runtime safety net in the inbound handler.**
In `app/api/sms/inbound/route.ts`, read the active follow-up pin **once, before** the roofing/painting receptionist blocks, using the existing helpers:
```
const pinActive = isFollowupContextActive(
  parseFollowupQuoteContext((conversation as any).followup_quote),
  Date.now(),
)
```
Pass a `followupPinActive: boolean` option into `handleRoofingTurn(...)` and `handlePaintingTurn(...)`. Inside each receptionist, change the engage guard so that **when a pin is active the receptionist may only engage on a genuinely new enquiry**, never by resuming stale state:
```
// today (roofing-receptionist.ts):   engage if isActiveRoofingFlow(prev) || looksLikeRoofingEnquiry(inbound)
// new:
const canResume   = isActiveRoofingFlow(prev) && !followupPinActive
const isNewEnquiry = looksLikeRoofingEnquiry(inbound)
if (!canResume && !isNewEnquiry) return false   // fall through to general dialog
```
Same change in the painting receptionist using its new-enquiry detector (verify exact export name at build; roofing's is `looksLikeRoofingEnquiry`).

Suppressing regardless of the pinned job's trade is intentional and correct: even a follow-up about a completed *roofing* quote should be answered by the general dialog (which knows the existing quote) rather than restarting the roof intake; a customer who genuinely wants new roof work still triggers `looksLikeRoofingEnquiry`.

### Tests (Part A)

Vitest units alongside `lib/sms/roofing-receptionist.test.ts` and `lib/sms/painting-receptionist.test.ts`:

- **R-A1:** stale active roofing state + active non-roofing pin + affirmative reply ("Yes") ⇒ `handleRoofingTurn` returns `false` (falls through to general dialog).
- **R-A2:** active pin + a real new roofing enquiry ("need my roof re-done") ⇒ still engages (returns handled).
- **R-A3 / R-A4:** the equivalent pair for painting.

Existing receptionist tests must still pass (no pin ⇒ unchanged behavior).

---

## Part B — Payment-confirmation page (`/q/[token]/paid`)

`app/q/[token]/paid/page.tsx` is the single shared confirmation page (all trades funnel here). It currently loads `id, paid_at, paid_tier, total_inc_gst, scheduled_at, scheduled_window` and renders a minimal inline-styled thank-you. Bring it up to the Maintain design language used by `app/q/[token]/book/page.tsx` (Tailwind + CSS variables: `--ink-*`, `--accent`, `--text-*`, mono uppercase eyebrows) and add three gated pieces.

### Data to load

Extend the page's `quotes` select to also include: `needs_inspection`, `pdf_path`, `intake_id`, `tenant_id`, `booking_state`, `status`, `share_token`. Then two defensive follow-up queries:
- `tenants` by `quote.tenant_id` → `business_name` (and phone/timezone if trivially available).
- `intakes` by `quote.intake_id` → `job_type`, plus a suburb derived defensively from the intake jsonb (`property` / `scope`); omit the suburb if not present.

Use `humanizeJobType()` (already in `lib/sms/followup-context.ts`) for the job label.

### B1 — Confirm the job (always shown)

A confirmation card with: tradie business name, service/job label, suburb (if known), quote ref (first 8 of `id`), tier paid, amount inc GST, and a status line:
- inspection tier, no `scheduled_at` → "Inspection booked — {Tradie} will contact you to confirm a time."
- priced quote, `scheduled_at` set → "Booked for {formatted date/time} with {Tradie}." (reuse existing Australia/Sydney formatting)
- priced quote, no `scheduled_at` → keep the existing "pick a time" link to `/q/[token]/book`.

### B2 — PDF download

Link the **existing** endpoint `GET /api/q/[token]/pdf` (styled Maintain button). **Shown as soon as the quote is priced** — i.e. when `needs_inspection === false` (a customer-viewable quote PDF exists). Not gated on a confirmed time. For the inspection case there is no priced quote, so no button is shown; Stripe's emailed receipt covers the payment record. (Decision confirmed with user: PDF appears immediately for priced quotes; only the calendar waits for a time.)

### B3 — Add to calendar (ICS + Google), shown only when `scheduled_at` is set

New route: `GET /api/q/[token]/ics` returns `text/calendar` with `Content-Disposition: attachment; filename="{tradie-slug}-appointment.ics"`.

New pure module `lib/quote/calendar.ts` (no DB, unit-testable):
- `buildQuoteIcs(event): string` — RFC 5545 VCALENDAR/VEVENT. `UID = "{quoteId}@quotemate"` (deterministic, avoids `Date.now()`), `DTSTART`/`DTEND` emitted as absolute UTC (`...Z`), `SUMMARY`/`DESCRIPTION`/`LOCATION` escaped per RFC (backslash, comma, semicolon, newline). `DTSTAMP` derived from the event start (deterministic).
- `buildGoogleCalendarUrl(event): string` — `https://calendar.google.com/calendar/render?action=TEMPLATE&text=...&dates=<START>/<END>&details=...&location=...`, all fields URL-encoded, dates as `YYYYMMDDTHHMMSSZ`.
- `resolveEventWindow(scheduledAtIso, scheduledWindow): { start: Date, end: Date }` — because `scheduled_at` is already an **absolute** instant, no timezone math is needed: `start = scheduled_at`; `end = start + duration` where duration = 4h for `am`/`pm` windows, 2h for a legacy exact time (`scheduled_window` null).

Event fields: title = "{job label} — {Tradie}" (or "Inspection — {Tradie}" for inspection tier), location = suburb/address if known, description = short note + the quote link (`APP_URL/q/{share_token}`).

The paid page renders two buttons when `scheduled_at` is set: **Add to Apple/Outlook (.ics)** → `/api/q/[token]/ics`, and **Add to Google Calendar** → the Google URL (computed server-side from the same event and passed to the client, or built inline). No new npm dependency.

### Tests (Part B)

- Pure-function units for `buildQuoteIcs` (VEVENT fields present, RFC escaping of a comma/newline in the job label, UTC `Z` datetimes, deterministic UID/DTSTAMP), `buildGoogleCalendarUrl` (correct `dates` range + URL-encoding), and `resolveEventWindow` (am/pm → 4h, null → 2h).
- Visual verification of the page via the preview dev server across the three states (inspection/no-time, priced/no-time, priced/booked).

---

## Non-goals

- No Stripe Connect / funds-flow changes.
- No new generated receipt-PDF (rely on the existing quote PDF for priced quotes + Stripe's emailed receipt).
- No changes to trade-specific quote **view** pages (`/q/solar`, `/q/roof`, `/q/paint`, …).
- No database migration.
- No change to the general-dialog follow-up prompt behavior (it already honors the pin).

## Definition of done

1. **Part A:** With the roofing flag enabled, a TEXT follow-up on a non-roof quote followed by an affirmative reply no longer triggers the roof-pitch question — proven by the new receptionist unit tests (R-A1..R-A4). A1 clears `roofing_state`/`painting_state` on pin; A2 suppresses stale-resume when a pin is active. Existing SMS tests still pass.
2. **Part B:** `/q/[token]/paid` shows the confirmation card in all three states; the PDF button appears for any priced quote; the ICS + Google buttons appear only when `scheduled_at` is set; the inspection case shows confirmation + no PDF/calendar. New calendar-builder units pass; page verified in the preview server.
3. Typecheck + lint clean; the two pieces land as separate commits.
