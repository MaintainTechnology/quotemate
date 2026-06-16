-- Migration 114 · Solar multi-roof building picker (approach A)
--
-- Lets one solar_estimates row act as the PROPERTY record: it carries the
-- list of structures detected on the property (Geoscape measureAll) plus a
-- pointer to the building the headline estimate currently reflects. The
-- per-building full SolarEstimate is computed lazily on selection and cached
-- in solar_building_cache so switching back is instant. The row's existing
-- `estimate` jsonb always mirrors the SELECTED building, so the quote page,
-- redraft and confirm keep reading the row unchanged.
--
-- See docs/superpowers/specs/2026-06-16-solar-multi-roof-building-picker-design.md
--
-- ADDITIVE ONLY. New nullable/defaulted columns + one new table. No changes
-- to existing columns or constraints. Idempotent (add column if not exists /
-- create table if not exists) so re-runs are no-ops. Apply with:
--   node --env-file=.env.local scripts/run-migration-114.mjs

-- ── 1. Property-record columns on solar_estimates ──────────────────────
-- buildings: DetectedBuilding[] (lightweight metadata for the picker —
--   building_id, role, label, centroid, footprint, area_m2, roof_shape,
--   storeys, solar_status). Defaults to [] so existing rows + the
--   single-building path are unaffected.
-- selected_building_id: which detected building the row's `estimate` jsonb
--   currently reflects. Null on legacy rows / single-building estimates.
alter table public.solar_estimates
  add column if not exists buildings jsonb not null default '[]'::jsonb,
  add column if not exists selected_building_id text;

-- ── 2. Per-building lazy compute cache ─────────────────────────────────
-- One row per (estimate, building) once that building's full solar analysis
-- has been computed. Lets a switch back to a previously-viewed building be
-- instant (no Google Solar re-fetch). Cascades with the parent estimate.
create table if not exists public.solar_building_cache (
  estimate_id  uuid not null references public.solar_estimates(id) on delete cascade,
  building_id  text not null,
  estimate     jsonb not null,            -- the per-building SolarEstimate shape
  computed_at  timestamptz not null default now(),
  primary key (estimate_id, building_id)
);

create index if not exists solar_building_cache_estimate_idx
  on public.solar_building_cache (estimate_id);

-- Defence in depth — RLS on (service role bypasses it; anon sees zero rows),
-- mirroring solar_estimates (mig 100).
alter table public.solar_building_cache enable row level security;

grant all on table public.solar_building_cache to service_role;

-- CRITICAL: refresh PostgREST's schema cache so supabase-js routes can read
-- the new columns/table immediately (mirrors mig 100/101/111).
notify pgrst, 'reload schema';

-- ── 3. Sanity echo (read-only; visible on direct psql runs) ────────────
do $$
declare
  has_buildings boolean;
  has_selected  boolean;
  has_cache     boolean;
begin
  select exists (
    select 1 from information_schema.columns
     where table_schema='public' and table_name='solar_estimates'
       and column_name='buildings'
  ) into has_buildings;
  select exists (
    select 1 from information_schema.columns
     where table_schema='public' and table_name='solar_estimates'
       and column_name='selected_building_id'
  ) into has_selected;
  select exists (
    select 1 from information_schema.tables
     where table_schema='public' and table_name='solar_building_cache'
  ) into has_cache;
  raise notice 'Migration 114: buildings=%, selected_building_id=%, solar_building_cache=%',
    has_buildings, has_selected, has_cache;
end $$;
