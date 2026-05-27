-- Migration 072 · Per-quote display_mode override
--
-- Phase B of the customer-quote display feature. Adds a nullable column
-- on the quotes table that lets a tradie override the tenant-level
-- pricing_book.quote_display preference for a SINGLE quote, after
-- reviewing it on the dashboard.
--
-- Resolution chain (implemented in lib/quote/display.resolveQuoteDisplayMode):
--   1. quotes.display_mode (this column) — wins when set to a valid value
--   2. pricing_book.quote_display (Phase A, mig 071) — used when null
--   3. 'itemised' — hard default
--
-- Why nullable, not defaulted: a NULL on this column means "no override,
-- inherit the tenant preference." We deliberately avoid a default so the
-- override column is unambiguous — set ⇒ tradie made a deliberate choice;
-- null ⇒ go with the tenant default. (A defaulted column couldn't tell
-- those two cases apart without an extra "is_default" flag.)
--
-- Idempotent: ADD COLUMN IF NOT EXISTS + a guarded CHECK constraint.

begin;

alter table public.quotes
  add column if not exists display_mode text;

-- Add the check constraint only if it doesn't already exist (idempotent).
-- The constraint allows NULL (= no override) plus the two valid modes.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.quotes'::regclass
      and conname  = 'quotes_display_mode_check'
  ) then
    alter table public.quotes
      add constraint quotes_display_mode_check
      check (display_mode is null or display_mode in ('itemised', 'summary'));
  end if;
end $$;

commit;
