-- Migration 062 · Move available_slots from tradies → tenants
--
-- Phase 2a of the 2026-05-26 DB cleanup audit. The legacy `tradies`
-- table is a pre-multi-tenant remnant (1 row, "Quote Mate" / Jon's
-- pilot record) still read by the booking flow. The ONLY column the
-- code actually uses from it is `available_slots` (timeslots offered
-- to customers picking a booking slot). The other columns Jon's row
-- carries (business_name, licence_*, default_deposit_pct, stripe_*)
-- are either unused by code or already live on `tenants`.
--
-- This migration:
--   1. Adds `available_slots jsonb default '[]'::jsonb` to tenants
--   2. Backfills it from the (single) tradies row onto every tenant,
--      preserving today's behaviour where `from('tradies').limit(1)`
--      returns the same slots regardless of which tenant owns the quote.
--      After this, the booking flow can read slots per-tenant.
--
-- Tradies table is NOT dropped here — that happens in migration 063
-- AFTER the code has been switched to read from tenants.
--
-- Idempotent: the column add uses `if not exists`; the backfill only
-- runs when tradies still exists AND has a row.

alter table tenants add column if not exists available_slots jsonb default '[]'::jsonb;

do $$
declare
  pilot_slots jsonb;
begin
  -- Only backfill if the source table is still present (i.e. mig 063 hasn't
  -- run yet).
  if exists (
    select 1 from information_schema.tables
      where table_schema = 'public' and table_name = 'tradies'
  ) then
    -- single-row table; grab whatever's there (slots default to []).
    execute 'select coalesce(available_slots, ''[]''::jsonb) from tradies limit 1'
      into pilot_slots;
    if pilot_slots is not null then
      update tenants set available_slots = pilot_slots
        where available_slots is null
           or available_slots = '[]'::jsonb;
    end if;
  end if;
end $$;

comment on column tenants.available_slots is
  'Tradie-curated list of booking slot ISO strings shown on /q/[token]/book. '
  'Mig 062 (2026-05-26) moved this off the legacy tradies table.';
