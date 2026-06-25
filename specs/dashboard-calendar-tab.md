# Dashboard Calendar Tab + Self-Serve Booking — Spec

## Objective
Give tradies a single place to see all of their upcoming jobs, and give their
customers a way to book a job themselves. We add (A) a **Calendar tab** to the
tradie dashboard that aggregates every booking for that tradie, and (B) a **public
self-serve booking page** where a customer enters their own details and picks an
appointment time, which then appears in the tradie's calendar. This closes the
gap Jon raised: "the customer enters all their details and the appointment time …
which flows into the tradie's calendar."

This is for the **tradie** (the calendar view) and their **end customers** (the
self-serve booking form). Both halves write to and read from the same booking
data so there is one source of truth for "what's on the schedule."

## Context / background
The app lives in `quotemate-automation/` (Next.js 16 App Router, React 19,
Tailwind v4, Supabase, TypeScript). Before writing Next.js code, read
`quotemate-automation/AGENTS.md` — Next 16 has breaking changes vs. older Next.

What already exists (do **not** rebuild):
- **Bookings are denormalized onto the `quotes` table** — there is no
  `bookings`/`appointments` table. A booking = a `quotes` row where
  `scheduled_at IS NOT NULL`.
- The existing customer flow: a customer picks a slot at
  `app/q/[token]/book/page.tsx` (via `SlotPicker.tsx`); `POST
  app/api/q/[token]/book/route.ts` writes `quotes.scheduled_at` +
  `quotes.booking_state = 'reserved'`; on deposit payment the Stripe webhook
  (`app/api/stripe/webhook/route.ts`) sets `booking_state = 'booked'`,
  `status = 'accepted'`, `paid_at`, `paid_tier`, and prunes the slot from
  `tenants.available_slots`.
- **Slot availability** is per-tenant: `tenants.available_slots` (jsonb array of
  ISO strings) or, if empty, an auto-generated rolling 21-day window (9am/12pm/3pm
  Sydney time) computed by `lib/quote/slots.ts`.
- **Booking-state column**: `quotes.booking_state` is `NULL | 'reserved' |
  'booked'` (introduced in migration 026).
- **Customer/job details** live on the linked `intakes` row (`intakes.caller`
  jsonb for name/phone/email, plus `job_type`, `address`, `suburb` columns),
  joined via `quotes.intake_id`. The global `customers` table (keyed by phone,
  **no `tenant_id`**) can enrich display but must never be used for tenant
  scoping.
- **Dashboard** (`app/dashboard/page.tsx`) is a single client-side tabbed SPA.
  Adding a tab requires editing five places (Tab union, `DEEP_LINK_TABS`,
  `buildNav()`, `SIDEBAR_GROUPS`, render conditional) and is bearer-authed via
  `app/api/tenant/me/route.ts` (Supabase token → tenant by `owner_user_id`).
- **Design system**: Maintain Technology (dark charcoal canvas, `#FFC400`
  accent). Shared primitives in `app/dashboard/_components/quote-ui.tsx` (`Card`,
  `DataPanel`, `StatGrid`, `StatusPill`); `formatDate`/`formatTime` helpers use
  native `Intl` `en-AU`. No date library is installed.

Key design decision (made during spec interview): a self-serve booking is a
**lightweight booking request — no AI estimate, no payment**. Rationale: forcing
the Opus estimate on a cold lead frequently downgrades to the inspection route
(muddying the calendar), and the money path is test-mode only with Stripe Connect
not wired. The request still produces a normal `quotes` row carrying
`scheduled_at`, so the calendar reads one unified source. The tradie can run the
existing estimate/deposit flow afterward if they want a priced quote.

## Requirements

### A. Self-serve customer booking page
1. A public page at `/book/[tenantId]` renders a booking form for that specific
   tradie. The page resolves the tenant from the URL param and shows the tenant's
   `business_name`; an unknown/invalid tenant id renders a friendly "not found"
   state, not a crash.
2. The form collects: **customer name (required)**, **phone (required, AU
   format)**, email (optional), job site address + suburb (optional), job
   type / short description (optional, free text), and a **preferred appointment
   time (required)**.
3. The appointment time is chosen from the tenant's bookable slots using the
   existing `lib/quote/slots.ts` logic (curated `tenants.available_slots` or the
   auto-generated rolling window). The customer cannot pick a slot in the past or
   inside the minimum lead time the slot logic already enforces.
4. On submit, `POST /api/book/[tenantId]` (public, no auth) creates:
   - an `intakes` row scoped to `tenant_id`, with the form data written to
     `caller` jsonb (name/phone/email) and the `job_type` / `address` / `suburb`
     columns; mark its source as the self-serve form (e.g. a `channel`/`source`
     value of `web_booking`) so it is distinguishable from voice/SMS intakes;
   - a minimal `quotes` row scoped to `tenant_id` with `intake_id` set,
     `scheduled_at` = chosen slot (ISO), `booking_state = 'requested'`,
     `status = 'draft'`, and **no priced tiers** (`good`/`better`/`best` left
     null/empty). No Stripe session is created.
5. The endpoint validates input server-side (required fields present, phone shape,
   slot is a valid future bookable slot for that tenant) and rejects bad input
   with a clear error; it must not create partial rows on validation failure.
6. On success the customer sees a confirmation state (their name, the tradie's
   business name, and the booked time) and receives a confirmation SMS. The
   tradie receives an SMS notification of the new request (reuse the
   `lib/quote/booking-notify.ts` notification pattern), including customer name,
   phone, job type, and requested time.
7. Submitting must be idempotent enough that a double-submit (same tenant + phone
   + slot within a short window) does not create two bookings.

### B. Tradie Calendar tab
8. A new **"Calendar"** core tab appears in the dashboard sidebar and mobile nav
   for **every** tenant (not feature-gated; do not add to `FEATURE_TAB_SLUGS` or
   `KNOWN_TRADES`). `?tab=calendar` deep-links to it.
9. The tab fetches from a new `GET /api/tenant/calendar` (bearer-authed,
   tenant-scoped via the existing `app/api/tenant/me` pattern / `tenantFromBearer`
   from `lib/billing/auth.ts`, service-role Supabase client). It queries `quotes`
   where `tenant_id = <tenant>` and `scheduled_at IS NOT NULL`, accepts optional
   `?from=`/`?to=` ISO range (default: current month ± a buffer), sorts ascending
   by `scheduled_at`, caps the result set, and returns typed events:
   `{ quoteId, shareToken, scheduledAt, bookingState, status, paid, paidTier,
   customerName, customerPhone, jobType, address, suburb, source }`.
10. The tab renders an **agenda/list grouped by day, upcoming first** (a month
    grid is explicitly a later iteration), using the Maintain primitives (`Card`,
    `DataPanel`, `StatGrid`, `StatusPill`), the existing `formatDate`/`formatTime`
    helpers, and the existing loading/empty/error states + `motion-safe` `fade-up`
    reveal. Each event row shows time, customer name, job type, suburb, a
    `StatusPill` for booking state, and links through to the quote.
11. Booking state is shown distinctly:
    - `requested` (self-serve, unconfirmed) → "Requested" (warn/attention tone),
    - `reserved` (slot picked, deposit unpaid) → "Pending payment" (warn tone),
    - `booked` (paid + slot) → "Confirmed" (good/accent tone),
    - past `scheduled_at` → grouped under "Past".
12. The tradie can **confirm a `requested` booking** from the calendar via a
    write endpoint (e.g. `POST /api/tenant/calendar/[quoteId]/confirm`,
    bearer-authed, tenant-scoped) that advances `booking_state` from `'requested'`
    to a confirmed state and stamps `last_status_at`. Confirming must only affect
    a quote belonging to the caller's tenant.

### C. Data model
13. Reuse `intakes` + `quotes`; **do not** create a `bookings`/`appointments`
    table. Add `'requested'` as an allowed `booking_state` value. If
    `booking_state` carries a CHECK constraint or enum that rejects new values,
    add a `sql/migrations/NNN_*.sql` (plus a `scripts/run-migration-NNN.mjs`) per
    repo convention and keep `sql/init.sql` representative; if it is free text, no
    migration is needed.

## Non-goals
- Running the AI estimate pipeline or charging a Stripe deposit during self-serve
  booking (the request carries no priced tiers; estimate/deposit stays the
  existing `/q/[token]/book` flow, run later by the tradie).
- Rescheduling or customer-initiated cancellation UI (still handled by SMS reply
  to the tradie).
- A month-grid or week-grid calendar, drag-and-drop rescheduling, or recurrence
  rules.
- iCal / Google Calendar / Outlook sync or export.
- A tradie-side "manually create a booking" form inside the dashboard (the
  customer form is the entry path for this version).
- Editing `tenants.available_slots` (availability management) from the Calendar
  tab.
- Adding any new npm dependency, including a date library — use native
  `Date`/`Intl`.

## Constraints
- Stack: Next.js 16 App Router, React 19, Tailwind v4, TypeScript, Supabase
  (service-role client in API routes; tenancy enforced in-query). Work inside
  `quotemate-automation/`.
- Tenant scoping: always filter bookings by `quotes.tenant_id` (NOT NULL,
  indexed). Never scope via the global `customers` table.
- Auth: dashboard/tenant endpoints use the existing Supabase bearer pattern; the
  public booking page + `POST /api/book/[tenantId]` are unauthenticated but must
  validate the tenant id and all input server-side.
- Reuse existing slot logic (`lib/quote/slots.ts`) and notification patterns
  (`lib/quote/booking-notify.ts`); match the Maintain design system rather than
  introducing new UI patterns.
- Money path is test-mode only and Stripe Connect is not wired — do not add a
  funds flow.
- Webhook/long-running conventions still apply if any heavy work is triggered
  (fast-ack, `after()` for heavy work), though self-serve booking should be light.

## Edge cases to handle
- Invalid/unknown `tenantId` on the booking page → friendly "this booking link
  isn't valid" state; `POST /api/book/[tenantId]` returns a 4xx, creates nothing.
- Missing required field (name / phone / slot) → inline validation error; no rows
  created.
- Chosen slot is in the past, inside the lead-time window, or no longer bookable →
  reject with a clear message; prompt the customer to pick another time.
- Double-submit of the same booking (same tenant + phone + slot in a short
  window) → only one booking is created.
- Tenant with zero bookings → Calendar tab shows a friendly empty state, not an
  error.
- Booking with partial/missing intake data (e.g. no parsed name) → calendar falls
  back to "Customer" / unknown phone; never crashes on null jsonb fields.
- Two bookings at the same slot time (reserved holds are non-destructive, so slots
  aren't unique) → render both.
- Past `scheduled_at` → still shown, grouped under "Past", not dropped.
- Expired/invalid bearer token on the Calendar tab → same re-auth handling as
  other tabs (no blank screen).
- Confirm action on a quote that isn't `requested`, or isn't the caller's tenant →
  rejected, no state change.

## Definition of done
- [ ] Visiting `/book/[tenantId]` for a valid tenant shows that tradie's branded
      booking form; an invalid id shows a friendly not-found state.
- [ ] Submitting the form creates exactly one `intakes` row (source marked
      `web_booking`) and one `quotes` row with `scheduled_at`,
      `booking_state='requested'`, no priced tiers, scoped to the right
      `tenant_id`; invalid submissions create nothing.
- [ ] The customer sees a confirmation with the booked time; the tradie receives
      an SMS notification of the new request.
- [ ] A double-submit (same tenant + phone + slot) yields a single booking.
- [ ] `GET /api/tenant/calendar` returns the signed-in tenant's bookings only,
      with the documented fields, bounded by date range, sorted ascending.
- [ ] "Calendar" appears in sidebar + mobile nav for every tenant and
      `?tab=calendar` deep-links to it.
- [ ] The tab renders real bookings grouped by day (upcoming first) with working
      loading / empty / error states, each event linking to its quote.
- [ ] `requested` / `reserved` / `booked` / past states are visually
      distinguishable per the tones in Requirement 11.
- [ ] The tradie can confirm a `requested` booking from the calendar; the state
      advances and is reflected on refresh; confirming another tenant's quote is
      rejected.
- [ ] No new `bookings` table; `'requested'` is a valid `booking_state` (with a
      migration only if a constraint required it, and `sql/init.sql` kept
      representative).
- [ ] No new npm dependency added.
- [ ] `npm run build` and the typecheck pass clean from inside
      `quotemate-automation/`; no regression to the existing `/q/[token]/book`
      flow, the Stripe webhook, or other dashboard tabs.

## Open questions
- **Public URL shape:** `/book/[tenantId]` (raw id) for v1, or a friendlier
  per-tenant **slug** (e.g. `/book/pilot-sparky`)? A slug needs a unique public
  identifier column on `tenants`; default to the raw id unless a slug is wanted.
- **Decline/cancel in v1:** should the tradie also be able to **decline/cancel** a
  `requested` booking from the calendar (not just confirm)? Currently scoped as
  confirm-only; decline can be a fast follow.
- **Confirmed-request state name:** does a confirmed self-serve request reuse
  `'booked'`, or warrant a distinct value (e.g. `'confirmed'`) to separate
  "tradie-accepted, unpaid" from "paid + booked"? Recommend a distinct value to
  keep paid vs. unpaid legible on the calendar; confirm during build.
