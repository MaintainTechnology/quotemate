-- Down migration 142 — remove pricing_book.quote_tier_mode
--
-- Reverses 142_pricing_book_quote_tier_mode.sql. Drops the CHECK constraint
-- then the column. Idempotent (IF EXISTS guards). Customer quotes revert to
-- always showing every priced tier (the pre-142 behaviour) once the app code
-- that reads this column is also rolled back.

begin;

alter table public.pricing_book
  drop constraint if exists pricing_book_quote_tier_mode_check;

alter table public.pricing_book
  drop column if exists quote_tier_mode;

commit;
