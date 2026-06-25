-- Down-migration 147 · drop default_availability + scheduled_window
--
-- Reverses 147_tenants_default_availability.sql. Safe/idempotent.
-- Apply with a run-migration helper pointed at this file, or psql directly.

begin;

alter table public.tenants
  drop column if exists default_availability;

alter table public.quotes
  drop column if exists scheduled_window;

commit;
