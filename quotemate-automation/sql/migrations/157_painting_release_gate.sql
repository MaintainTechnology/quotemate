-- Migration 157 · painting tradie-release gate
--
-- A painting quote requested over SMS / the self-serve form is now DRAFTED and
-- held for the tradie to review, edit and release before the customer sees any
-- price. released_at is the gate canShowPaintingPrices() + the /r/paint deposit
-- short-link unlock against (mirrors solar_estimates.confirmed_at).
--
-- BACKFILL: every EXISTING painting_measurements row predates the gate and is a
-- tradie-authored dashboard save, so it is marked released (= created_at) — the
-- customer quote page keeps showing its prices unchanged. Only NEW SMS /
-- self-serve drafts are saved with released_at NULL and stay gated until the
-- tradie clicks "Send to customer".
--
-- Additive + idempotent.

alter table public.painting_measurements
  add column if not exists released_at timestamptz;

update public.painting_measurements
   set released_at = created_at
 where released_at is null;

-- Refresh PostgREST's cache so supabase-js sees the new column immediately.
notify pgrst, 'reload schema';

do $$
declare
  has_released boolean;
  unreleased_count integer;
begin
  select exists (
    select 1 from information_schema.columns
     where table_schema='public' and table_name='painting_measurements' and column_name='released_at'
  ) into has_released;
  select count(*) from public.painting_measurements where released_at is null into unreleased_count;
  raise notice 'Migration 157: painting_measurements.released_at=%, unreleased rows after backfill=%', has_released, unreleased_count;
end $$;
