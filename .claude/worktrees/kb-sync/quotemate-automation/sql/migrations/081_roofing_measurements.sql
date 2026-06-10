-- Migration 081 · Roofing measurements — multi-structure persistence
--
-- Context: roofing Phase 1 (migration 080) was read-only — the measure
-- route returned JSON and saved nothing, so a tradie could not persist a
-- measured job, and there was no place to store more than one structure.
-- This migration adds the job entity behind the multi-structure feature:
-- ONE row per measured job, holding N structures in a jsonb array
-- (parent job + embedded child structures, mirroring how quotes embed
-- good/better/best rather than normalising line items).
--
-- Additive only. Does NOT touch existing tables or the intake enum.
--
-- RLS: enabled with NO policies (per the Phase-1.5 convention, mig 060).
-- Service-role API routes bypass RLS so writes/reads work; the anon key
-- sees zero rows. A tenant-scoped policy can be added in RLS Phase 2.
--
-- sql/init.sql should adopt this table next time it is regenerated.

create table if not exists public.roofing_measurements (
  id                       uuid primary key default gen_random_uuid(),
  tenant_id                uuid references public.tenants(id) on delete set null,
  created_by               uuid,                       -- auth.users id of the tradie
  -- Property
  address                  text not null,
  postcode                 text,
  state                    text,
  provider                 text,                       -- geoscape | lidar | mock | manual
  -- Optional lead capture
  customer_name            text,
  customer_phone           text,
  -- Aggregate summary (denormalised for fast list views)
  structure_count          int  not null default 1,
  combined_area_m2         numeric,
  combined_better_inc_gst  numeric,
  routing                  text,                       -- tradie_review | inspection_required
  -- Full payloads
  structures               jsonb not null default '[]'::jsonb,  -- [{buildingId, role, label, metrics, inputs, price}]
  quote                    jsonb,                                -- the full MultiRoofQuote
  created_at               timestamptz not null default now()
);

create index if not exists roofing_measurements_tenant_idx
  on public.roofing_measurements (tenant_id, created_at desc);

create index if not exists roofing_measurements_created_by_idx
  on public.roofing_measurements (created_by, created_at desc);

-- Defence in depth — enable RLS now; service role still bypasses it.
alter table public.roofing_measurements enable row level security;

-- Diagnostic echo for direct psql runs.
do $$
declare
  has_table boolean;
  rls_on    boolean;
begin
  select exists (
    select 1 from information_schema.tables
     where table_schema = 'public' and table_name = 'roofing_measurements'
  ) into has_table;
  select relrowsecurity from pg_class
    where oid = 'public.roofing_measurements'::regclass into rls_on;
  raise notice 'Migration 081: roofing_measurements present=%, rls=%', has_table, rls_on;
end $$;
