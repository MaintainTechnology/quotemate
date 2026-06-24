-- ════════════════════════════════════════════════════════════════════
-- Migration 140 — roofing measurement: own link + authoritative selection
--
-- Two additive columns on public.roofing_measurements:
--
--   • measure_token  — a SECOND unguessable token (distinct from the
--     customer-facing public_token) that addresses the tradie-facing
--     Measurement Results page at /m/[measure_token]. One record, two
--     views, two links.
--
--   • included_indices int[] — the AUTHORITATIVE set of structures (1-based
--     indices into quote->'structures') the tradie keeps in the job. This
--     is the single source of truth the customer quote page AND the quote
--     PDF narrow to, replacing the fragile `?s=` query-param carrier. NULL
--     means "all structures" (back-compat for any reader before backfill).
--
-- Additive only. Does NOT touch existing columns, rows' meaning, or the
-- intake enum. Backfills every existing row so measure_token is unique and
-- non-null and included_indices reflects all measured structures (nothing
-- silently dropped).
--
-- Apply with: node --env-file=.env.local scripts/run-migration-140.mjs
-- Rollback:   sql/migrations/140_down.sql
-- ════════════════════════════════════════════════════════════════════

create extension if not exists pgcrypto;

alter table public.roofing_measurements
  add column if not exists measure_token   text,
  add column if not exists included_indices int[];

-- Backfill measure_token for every legacy row (volatile per-row → unique).
update public.roofing_measurements
   set measure_token = encode(gen_random_bytes(16), 'hex')
 where measure_token is null;

-- Backfill included_indices = all structures in the stored quote, so the
-- existing rows render exactly as they do today (nothing hidden). Rows with
-- no usable quote stay NULL (readers treat NULL as "all").
update public.roofing_measurements
   set included_indices = (
     select array_agg(g order by g)
       from generate_series(1, jsonb_array_length(quote->'structures')) g
   )
 where included_indices is null
   and quote is not null
   and jsonb_typeof(quote->'structures') = 'array'
   and jsonb_array_length(quote->'structures') > 0;

-- Unique + lookup index on the new token (after backfill so it never trips
-- on duplicate NULLs).
create unique index if not exists roofing_measurements_measure_token_idx
  on public.roofing_measurements (measure_token);

notify pgrst, 'reload schema';

-- Diagnostic echo for direct psql runs.
do $$
declare
  has_measure_token boolean;
  has_included      boolean;
  unbackfilled      int;
begin
  select exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'roofing_measurements'
       and column_name = 'measure_token'
  ) into has_measure_token;
  select exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'roofing_measurements'
       and column_name = 'included_indices'
  ) into has_included;
  select count(*) from public.roofing_measurements where measure_token is null into unbackfilled;
  raise notice 'Migration 140: measure_token=%, included_indices=%, rows missing measure_token=%',
    has_measure_token, has_included, unbackfilled;
end $$;
