# Post-payment Scheduling, AU-only Checkout & Default Availability — Spec

## Objective
Three related fixes to the QuoteMax customer booking and tradie setup flows:

1. **Verify (and fix) post-payment scheduling end-to-end** so a customer reliably
   gets from a paid Stripe deposit to a confirmed booking, with no dead-ends.
2. **Lock Stripe Checkout to Australia** — remove the United States (and other
   non-AU) option from the checkout country selector.
3. **Add a default schedule-availability setting** a tradie configures (with a
   sensible pre-filled default) during onboarding and edits later in the
   dashboard, so customer-facing booking windows are driven by the tradie's real
   working hours instead of a generic rolling fallback.

This is for QuoteMax tradies (AU electrical/plumbing + other live trades) and
their customers booking a job after paying a deposit.

## Context / background
The app already implements a **"book first, pay last"** funnel (WP6 reorder).
Relevant existing pieces (do not rebuild — verify and extend):

- **Quote page** — [app/q/[token]/page.tsx](quotemate-automation/app/q/[token]/page.tsx);
  tier buttons link to `/r/{token}/{tier}`.
- **Redirect orchestrator** — [app/r/[token]/[tier]/route.ts](quotemate-automation/app/r/[token]/[tier]/route.ts);
  `payRedirectTarget()` routes to `paid` / `book` / `stripe` based on
  `quote.paid_at` and `quote.scheduled_at`.
- **Booking page + slot picker** — [app/q/[token]/book/page.tsx](quotemate-automation/app/q/[token]/book/page.tsx).
- **Booking API** — [app/api/q/[token]/book/route.ts](quotemate-automation/app/api/q/[token]/book/route.ts);
  sets `quotes.scheduled_at` + `booking_state='reserved'`, returns `next=/r/{token}/{tier}`.
- **Stripe webhook** — [app/api/stripe/webhook/route.ts](quotemate-automation/app/api/stripe/webhook/route.ts);
  on payment sets `paid_at`/`paid_tier`, runs `bookingStateOnPaid()` /
  `shouldFinaliseBookingOnPaid()`, prunes the booked slot from
  `tenants.available_slots`, sends confirmation SMS.
- **Paid / cancelled pages** — [app/q/[token]/paid/page.tsx](quotemate-automation/app/q/[token]/paid/page.tsx),
  [app/q/[token]/cancelled/page.tsx](quotemate-automation/app/q/[token]/cancelled/page.tsx).
- **Slot resolution** — `resolveBookableSlots()` in
  [lib/quote/slots.ts](quotemate-automation/lib/quote/slots.ts); reads
  `tenants.available_slots` (flat JSONB array of ISO timestamps), falls back to a
  generic 14-day rolling window.
- **Booking helpers** — [lib/quote/booking.ts](quotemate-automation/lib/quote/booking.ts).
- **Customer checkout** — [lib/stripe/checkout.ts](quotemate-automation/lib/stripe/checkout.ts);
  already hardcodes `currency: 'aud'` for deposit + $99 inspection sessions.
- **Onboarding** — [app/onboard/page.tsx](quotemate-automation/app/onboard/page.tsx)
  (3 steps; AU state selector, no availability fields),
  [lib/onboard/schema.ts](quotemate-automation/lib/onboard/schema.ts),
  [app/api/onboard/activate/route.ts](quotemate-automation/app/api/onboard/activate/route.ts).
- **Dashboard / tradie setup** — [app/dashboard/page.tsx](quotemate-automation/app/dashboard/page.tsx)
  (Account tab cards), tenant read/write via
  [app/api/tenant/me/route.ts](quotemate-automation/app/api/tenant/me/route.ts) and
  [lib/tenant/update-schema.ts](quotemate-automation/lib/tenant/update-schema.ts).

**There is no business-hours / working-hours column today.** Availability is a
flat list of ISO timestamps in `tenants.available_slots` plus a generic fallback.

## Requirements

### Task 1 — Verify & fix post-payment scheduling
1. Trace and confirm each transition works for the primary path: quote → pick
   AM/PM window (`booking_state='reserved'`, `scheduled_at` set) → Stripe deposit
   → webhook finalizes (`status='accepted'`, booking state finalized) →
   `/q/[token]/paid` shows the confirmed window → confirmation SMS is sent.
2. Confirm the **legacy recovery path**: a quote `paid_at` set but
   `scheduled_at` null routes the customer to `/q/[token]/book` and lets them
   pick a window after paying, ending in a confirmed booking.
3. Confirm the **already-paid** and **already-booked** guards: revisiting
   `/r/{token}/{tier}` after paying does not re-charge and does not lose the
   chosen window.
4. Any defect found in steps 1–3 is fixed, and the post-payment flow continues
   to work after Task 3 changes slots from raw timestamps to AM/PM windows.
5. Booking a window that another customer already took returns the existing
   "no longer available" behaviour (HTTP 409) rather than double-booking.

### Task 2 — AU-only Stripe Checkout
6. The Stripe Checkout page presented to customers must not offer the United
   States (or any non-Australian country) as a billing/region option; Australia
   is the only country.
7. Identify the live cause and remove it. Candidates, in order of likelihood:
   (a) Stripe **Adaptive Pricing** enabled at the account level (shows a
   country/currency selector — disabled via Stripe Dashboard, no code), and/or
   (b) `billing_address_collection` / locale settings on the Checkout Session in
   [lib/stripe/checkout.ts](quotemate-automation/lib/stripe/checkout.ts).
8. The fix applies to **both** customer-facing sessions: the per-tier deposit and
   the $99 inspection session.
9. Existing AUD pricing, GST handling, and the deposit/inspection amounts are
   unchanged — this task only removes the non-AU country option.

### Task 3 — Default schedule availability
10. Add a per-tenant **default availability** setting stored as JSONB on
    `tenants` (e.g. `default_availability`) via a new SQL migration
    (`sql/migrations/NNN_*.sql` + `scripts/run-migration-NNN.mjs`, applied to prod
    Supabase; `sql/init.sql` kept representative).
11. The model is **weekly hours per day**: for each weekday `mon…sun`, an
    `enabled` flag and a `start`/`end` time (24h `HH:MM`). Shape:
    ```json
    {
      "version": 1,
      "timezone": "Australia/Sydney",
      "days": {
        "mon": { "enabled": true,  "start": "07:00", "end": "15:00" },
        "tue": { "enabled": true,  "start": "07:00", "end": "15:00" },
        "wed": { "enabled": true,  "start": "07:00", "end": "15:00" },
        "thu": { "enabled": true,  "start": "07:00", "end": "15:00" },
        "fri": { "enabled": true,  "start": "07:00", "end": "15:00" },
        "sat": { "enabled": false, "start": null,    "end": null },
        "sun": { "enabled": false, "start": null,    "end": null }
      }
    }
    ```
12. **Default value** (pre-fill for new tenants and the onboarding form): Mon–Fri
    `07:00–15:00`, Sat/Sun disabled.
13. **Timezone** is derived from the tenant's existing `state` and stored as an
    IANA zone on the record: NSW/VIC/ACT/TAS → `Australia/Sydney`, QLD →
    `Australia/Brisbane`, SA → `Australia/Adelaide`, NT → `Australia/Darwin`,
    WA → `Australia/Perth`. DST is handled via the IANA zone (no fixed offsets).
    No timezone picker in v1.
14. The customer-facing slot picker presents **AM / PM half-day windows** derived
    from each day's hours, split at `12:00` local:
    - A day offers an **AM** window if its working hours overlap `00:00–12:00`.
    - A day offers a **PM** window if its working hours overlap `12:00–24:00`.
    - A day with no enabled hours offers neither.
15. `resolveBookableSlots()` (or its replacement) generates bookable windows from
    the weekly template over a **rolling 14-day window**, excluding:
    - windows on disabled days,
    - windows whose start instant is already in the past (in the tenant's tz),
    - windows already taken by an existing active booking for that tenant
      (a quote with `scheduled_at` on that date+window and `booking_state` in
      reserved/booked).
16. **One booking per AM/PM window** (no multi-capacity in v1).
17. A chosen window is persisted on the quote in a way the redirect orchestrator,
    webhook finalize, and paid page can all read and display as "morning" /
    "afternoon" on the given date. Recommended: keep `quotes.scheduled_at` as the
    window's canonical start instant (UTC) and add `quotes.scheduled_window`
    (`'am'|'pm'`); update the booking API, webhook, booking page, and paid page to
    read/display the window.
18. **Onboarding (optional step):** the onboarding form
    ([app/onboard/page.tsx](quotemate-automation/app/onboard/page.tsx) +
    [lib/onboard/schema.ts](quotemate-automation/lib/onboard/schema.ts) +
    [app/api/onboard/activate/route.ts](quotemate-automation/app/api/onboard/activate/route.ts))
    shows the weekly availability editor pre-filled with the default; the tradie
    can edit or skip it. Skipping persists the default. It does not block
    completing onboarding.
19. **Dashboard / Tradie setup:** add an availability editor card to the Account
    tab ([app/dashboard/page.tsx](quotemate-automation/app/dashboard/page.tsx))
    that reads/writes `default_availability` via the tenant update path
    ([lib/tenant/update-schema.ts](quotemate-automation/lib/tenant/update-schema.ts),
    [app/api/tenant/me/route.ts](quotemate-automation/app/api/tenant/me/route.ts)).
    Edits are validated (start < end; enabled days require both times) and reflect
    in subsequently generated customer slots.

## Non-goals
- Per-date blackout / holiday blocking, one-off date overrides, or "block this
  specific day" controls (likely fast-follow; v1 is the recurring weekly template
  only).
- Multiple bookings per window / capacity > 1.
- A free-form exact-time picker or per-job duration scheduling.
- A separate timezone picker decoupled from the tenant's state.
- Two-way calendar sync (Google/Outlook), reminders beyond the existing
  confirmation SMS, or rescheduling/cancellation UX.
- Changing AUD pricing, GST, deposit %, or the $99 inspection amount.
- Replacing or rebuilding ServiceM8/Tradify-style calendar/CRM features.

## Constraints
- Next.js 16 App Router app under `quotemate-automation/`. Read
  `quotemate-automation/AGENTS.md` and the relevant `node_modules/next/dist/docs/`
  guide before writing Next code (Next 16 has breaking changes).
- DB change = new `sql/migrations/NNN_*.sql` + `scripts/run-migration-NNN.mjs`
  applied to prod Supabase; keep `sql/init.sql` representative. Server routes use
  the service-role key (RLS bypassed) — keep app-layer `tenant_id` scoping.
- Stripe is **test mode**; the customer deposit + inspection sessions already use
  `currency: 'aud'`. Adaptive Pricing (if the cause of Task 2) is a Stripe
  Dashboard toggle, not code — document the change made.
- AU/NZ-first formatting, language, dates, addresses. Times shown to customers in
  the tenant's local timezone.
- Money-touching paths unchanged by this work; do not alter the grounding
  validator or inspection-fallback behaviour.

## Edge cases to handle
- Tenant with `default_availability = null` (legacy, pre-migration) → fall back to
  current `resolveBookableSlots()` behaviour; do not crash.
- Tenant with all days disabled → no bookable windows shown; customer sees the
  existing "pay deposit, tradie will be in touch" path instead of an empty picker.
- Day enabled but hours fully before 12:00 → AM only; fully after 12:00 → PM only.
- Today's AM window when it's already past noon → AM excluded, PM shown if still in
  the future.
- Two customers race for the same window → first wins; second gets HTTP 409
  "no longer available".
- Customer pays without picking a window (legacy/SMS link) → `/q/[token]/paid`
  shows "Pick a time" → booking completes post-payment.
- Invalid availability submission (start ≥ end, enabled day missing a time) →
  rejected with a clear validation error; record not saved.
- DST transition dates → window instants computed via IANA tz so local
  morning/afternoon stays correct across the change.
- Stripe webhook idempotency (existing `MessageSid`/session guards) preserved when
  finalizing a windowed booking.

## Definition of done
- [ ] A documented end-to-end pass exists: pick window → pay (Stripe test card) →
      webhook finalizes → `/paid` shows the confirmed AM/PM window → confirmation
      SMS sent. Any defect found along the way is fixed.
- [ ] Legacy "paid, no window" path lands on `/q/[token]/book`, lets the customer
      pick a window after paying, and ends in a confirmed booking.
- [ ] Revisiting a pay link after paying does not re-charge and preserves the
      chosen window.
- [ ] On the Stripe Checkout page for both the deposit and the $99 inspection
      session, Australia is the only selectable country — the US option is gone;
      the mechanism used (Adaptive Pricing toggle and/or session config) is noted.
- [ ] New migration adds `tenants.default_availability` (JSONB) + any
      `quotes.scheduled_window` column; `sql/init.sql` updated; migration applied
      to prod Supabase.
- [ ] New tenants are created with the Mon–Fri 07:00–15:00 default and a
      state-derived IANA timezone.
- [ ] Onboarding shows the weekly availability editor pre-filled with the default,
      is skippable, and persists the (possibly edited) value on activation.
- [ ] Dashboard Account tab has an availability editor that loads current values,
      validates input, saves via the tenant update path, and changes the windows a
      test customer subsequently sees.
- [ ] Customer slot picker shows only AM/PM windows derived from the tenant's
      weekly template over the next 14 days, excluding past and already-booked
      windows; one booking per window enforced (409 on race).
- [ ] Existing automated tests pass; new logic (AM/PM derivation, window
      generation/exclusion, availability validation) has unit coverage.

## Open questions
- Exact Stripe lever for Task 2: confirm at build time whether the US option comes
  from **Adaptive Pricing** (Dashboard toggle) or `billing_address_collection`/
  locale on the session — fix the actual source rather than guessing.
- Minimum booking lead time: v1 excludes windows whose start is in the past. Do we
  want a larger buffer (e.g. no bookings starting within the next 2 hours)?
- AM/PM window display anchor times (what timestamp `scheduled_at` stores for each
  window) — confirm a convention that the webhook prune + paid page both honour.
- Should an all-days-disabled tenant be blocked from going live, or silently fall
  back to the "tradie will be in touch" path (current spec assumes the latter)?
