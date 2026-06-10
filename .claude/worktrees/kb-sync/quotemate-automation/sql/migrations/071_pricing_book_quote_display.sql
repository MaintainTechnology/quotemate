-- Migration 071 · Quote display preference on pricing_book
--
-- Context: Phase A of the "summary vs itemised" customer-quote display
-- feature. Some tradies prefer their customer-facing quotes to read as a
-- single lump sum (cleaner, signals confidence, deflects line-by-line
-- negotiation); others prefer the itemised breakdown (today's default,
-- maximises perceived transparency).
--
-- This column is a tenant-level preference applied to EVERY quote drafted
-- against this pricing_book. Phase B will add a per-quote override on the
-- quotes table that falls back to this value when null.
--
-- Storage model:
--   • Defaults to 'itemised' so existing tenants see zero behavioural
--     change post-migration (back-compat is non-negotiable; live customers
--     are reading these pages right now).
--   • Constrained to 'itemised' | 'summary' so the dashboard form and the
--     customer page renderer can rely on the union being exhaustive.
--   • NOT NULL — the customer page renderer always has a value to branch on
--     (no `?? 'itemised'` fallbacks scattered through the codebase).
--
-- The underlying line items remain in quotes.{good,better,best}.line_items
-- regardless — grounding validator + tradie dashboard editor + audit trail
-- all still operate on the full breakdown. Only the customer-facing render
-- changes.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS, repeatable CHECK guard.

begin;

alter table public.pricing_book
  add column if not exists quote_display text
  not null
  default 'itemised';

-- Add the check constraint only if it doesn't already exist (idempotent).
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.pricing_book'::regclass
      and conname  = 'pricing_book_quote_display_check'
  ) then
    alter table public.pricing_book
      add constraint pricing_book_quote_display_check
      check (quote_display in ('itemised', 'summary'));
  end if;
end $$;

-- Backfill any rows that somehow slipped in with null (the default should
-- prevent this, but belt-and-braces for older clients that might have
-- inserted before the column existed).
update public.pricing_book
  set quote_display = 'itemised'
  where quote_display is null;

commit;
