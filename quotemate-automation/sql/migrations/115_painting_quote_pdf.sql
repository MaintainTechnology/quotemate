-- Migration 115 · Residential painting quote PDF
--
-- Adds the pdf_path column to painting_measurements so the Gotenberg-
-- rendered customer quote PDF can be cached and re-served by the stable
-- token route /api/q/paint/[token]/pdf — exactly the pattern roofing
-- (migration 105) and solar (migration 106) already use on their tables.
--
-- Additive only. Storage path convention: paint/<public_token>.pdf in the
-- private `quote-pdfs` bucket (created by migration 105).
--
-- sql/init.sql should adopt this column next time it is regenerated.

alter table public.painting_measurements
  add column if not exists pdf_path text;  -- storage path of the rendered quote PDF

-- Refresh the PostgREST schema cache so supabase-js sees the new column
-- immediately (avoids the PGRST204 cache-staleness class of bug).
notify pgrst, 'reload schema';

-- Diagnostic echo for direct psql runs.
do $$
declare
  has_col boolean;
begin
  select exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name = 'painting_measurements'
       and column_name = 'pdf_path'
  ) into has_col;
  raise notice 'Migration 115: painting_measurements.pdf_path present=%', has_col;
end $$;
