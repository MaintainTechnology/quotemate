-- Migration 147 · Tradie default schedule availability + booking window tag
--
-- Adds two columns supporting the default-availability feature
-- (specs/post-payment-scheduling-checkout.md):
--
--   tenants.default_availability jsonb  — the tradie's recurring weekly working
--     hours template (per-day enabled + start/end, plus an IANA timezone). The
--     customer booking flow derives AM/PM half-day windows from it. NULLABLE,
--     NO default: an existing tenant is NULL here, which the slot resolver
--     treats as "legacy — fall back to available_slots / the rolling window"
--     (spec edge case). New tenants are stamped a default by /api/onboard/activate.
--
--   quotes.scheduled_window text — 'am' | 'pm' tag for a chosen half-day window,
--     so the redirect orchestrator, webhook finalise, and /paid page can display
--     "Morning" / "Afternoon" and the generator can exclude an already-booked
--     window. NULLABLE: legacy bookings (raw timestamp slots) leave it NULL and
--     the period is derived from the instant's local hour when needed.
--
-- Idempotent (add column if not exists). NOT auto-applied. Apply with:
--   node --env-file=.env.local scripts/run-migration-147.mjs

begin;

alter table public.tenants
  add column if not exists default_availability jsonb;

alter table public.quotes
  add column if not exists scheduled_window text;

comment on column public.tenants.default_availability is
  'Recurring weekly availability template (version, timezone, days{mon..sun}'
  '{enabled,start,end}). Drives customer-facing AM/PM booking windows. NULL = '
  'legacy tenant; falls back to available_slots / rolling window. Mig 147.';

comment on column public.quotes.scheduled_window is
  'am | pm — the half-day window the customer booked (spec post-payment-'
  'scheduling-checkout). NULL for legacy exact-time bookings. Mig 147.';

commit;
