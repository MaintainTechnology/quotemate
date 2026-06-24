-- Migration 142 · Per-feature quote tier presentation mode on pricing_book
--
-- Adds pricing_book.quote_tier_mode — a per-tenant, per-trade (per-feature)
-- control for HOW MANY price options a customer quote shows:
--
--   'good_better_best' — show every priced tier (the legacy behaviour)
--   'single'           — show ONE tier = the recommended tier (quotes.selected_tier),
--                        falling back better → good → best
--   'good'|'better'|'best' — show ONLY that one forced tier
--
-- This is a CUSTOMER-VIEW gate applied after estimation. The estimator still
-- generates and persists the full good/better/best breakdown in quotes.* for
-- the tradie's audit + edit path; only the customer-facing render (quote page,
-- SMS, PDF) honours this mode. Resolution lives in lib/quote/tier-visibility.ts.
--
-- DEFAULT = 'single' for EVERY row (new + existing). This is the deliberate
-- "make the single option the default across all platforms" decision: existing
-- tenants flip to single-price unless they re-enable tiers in Settings. Unlike
-- quote_display (fanned out to all rows), this column is PER-ROW (per-trade) so
-- a tradie can run e.g. three-tier painting and single-price solar at once —
-- /api/tenant/me PATCH writes only the named pricing_book row(s).
--
-- Mirrors the column-add pattern of migrations 071 / 078 / 079:
--   • NOT NULL + default so the renderer always has a value to branch on.
--   • CHECK over the closed value set so the dashboard form + resolver can
--     rely on the union being exhaustive.
--   • Idempotent: ADD COLUMN IF NOT EXISTS + guarded CHECK + belt-and-braces
--     backfill.
--
-- NOT auto-applied. Apply with:
--   node --env-file=.env.local scripts/run-migration-142.mjs

begin;

-- Adding the column with NOT NULL DEFAULT 'single' backfills every existing
-- pricing_book row to 'single' automatically (Postgres fills the default for
-- pre-existing rows on ADD COLUMN) — i.e. all current tenants flip to single.
alter table public.pricing_book
  add column if not exists quote_tier_mode text
  not null
  default 'single';

-- Add the CHECK constraint only if it doesn't already exist (idempotent).
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.pricing_book'::regclass
      and conname  = 'pricing_book_quote_tier_mode_check'
  ) then
    alter table public.pricing_book
      add constraint pricing_book_quote_tier_mode_check
      check (quote_tier_mode in ('good_better_best', 'single', 'good', 'better', 'best'));
  end if;
end $$;

-- Belt-and-braces backfill: any row that somehow slipped in with null or an
-- out-of-range value is normalised to the new default 'single'. No-op when the
-- ADD COLUMN default applied cleanly (same pattern as migrations 078/079).
update public.pricing_book
  set quote_tier_mode = 'single'
  where quote_tier_mode is null
     or quote_tier_mode not in ('good_better_best', 'single', 'good', 'better', 'best');

commit;
