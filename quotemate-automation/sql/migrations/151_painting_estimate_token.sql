-- ════════════════════════════════════════════════════════════════════
-- Migration 151 — painting estimate: own tradie-facing link
--
-- One additive column on public.painting_measurements:
--
--   • estimate_token — a SECOND unguessable token (distinct from the
--     customer-facing public_token) that addresses the tradie-facing
--     Paint Estimate Results page at /p/[estimate_token]. One record, two
--     views, two links — exactly mirroring roofing's measure_token
--     (migration 140). The customer quote stays at /q/paint/[public_token].
--
-- Additive only. Does NOT touch existing columns, rows' meaning, or the
-- intake enum. Backfills every existing row so estimate_token is unique and
-- non-null (nothing silently dropped) before the unique index is created.
--
-- Apply with: node --env-file=.env.local scripts/run-migration-151.mjs
-- Rollback:   sql/migrations/151_down.sql
-- ════════════════════════════════════════════════════════════════════

create extension if not exists pgcrypto;

alter table public.painting_measurements
  add column if not exists estimate_token text;

-- Backfill estimate_token for every legacy row (volatile per-row → unique).
update public.painting_measurements
   set estimate_token = encode(gen_random_bytes(16), 'hex')
 where estimate_token is null;

-- Unique + lookup index on the new token (after backfill so it never trips
-- on duplicate NULLs). Partial index keeps the door open for a future
-- nullable insert path without breaking uniqueness.
create unique index if not exists painting_measurements_estimate_token_idx
  on public.painting_measurements (estimate_token)
  where estimate_token is not null;

notify pgrst, 'reload schema';

-- Diagnostic echo for direct psql runs.
do $$
declare
  has_estimate_token boolean;
  unbackfilled       int;
begin
  select exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'painting_measurements'
       and column_name = 'estimate_token'
  ) into has_estimate_token;
  select count(*) from public.painting_measurements where estimate_token is null into unbackfilled;
  raise notice 'Migration 151: estimate_token=%, rows missing estimate_token=%',
    has_estimate_token, unbackfilled;
end $$;
