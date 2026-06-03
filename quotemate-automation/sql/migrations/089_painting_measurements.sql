-- Migration 089 · Painting measurements — saved-job persistence
--
-- Mirrors roofing's migration 081. The painting estimate tool was
-- read-only — the estimate route returned JSON and saved nothing. This
-- migration adds the job entity so a tradie can hit "Save job" and see a
-- history of saved estimates in the Paint tab: ONE row per saved estimate,
-- with the full PaintingEstimate + inputs in jsonb, and denormalised
-- summary columns for fast list views.
--
-- Additive only. Does NOT touch existing tables or the intake enum.
--
-- RLS: enabled with NO policies (per the Phase-1.5 convention, mig 060).
-- Service-role API routes bypass RLS so writes/reads work; the anon key
-- sees zero rows. A tenant-scoped policy can be added in RLS Phase 2.
--
-- sql/init.sql should adopt this table next time it is regenerated.

create table if not exists public.painting_measurements (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid references public.tenants(id) on delete set null,
  created_by        uuid,                       -- auth.users id of the tradie
  -- Property
  address           text not null,
  postcode          text,
  state             text,
  source            text,                       -- rea | solar | geoscape | domain | mock | manual
  -- Optional lead capture
  customer_name     text,
  customer_phone    text,
  -- Denormalised summary (for fast list views)
  scopes            text[] not null default '{}',  -- walls | ceilings | trim | exterior
  floor_area_m2     numeric,
  total_area_m2     numeric,
  confidence        text,                       -- high | medium | low
  better_inc_gst    numeric,
  routing           text,                       -- tradie_review | inspection_required
  -- Full payloads
  inputs            jsonb not null default '{}'::jsonb,   -- PaintUserInputs
  estimate          jsonb,                                -- the full PaintingEstimate
  public_token      text,                                 -- reserved for a future /q/paint/[token] page
  created_at        timestamptz not null default now()
);

create index if not exists painting_measurements_tenant_idx
  on public.painting_measurements (tenant_id, created_at desc);

create index if not exists painting_measurements_created_by_idx
  on public.painting_measurements (created_by, created_at desc);

-- The share token must be unique (mirrors roofing mig 085) so a future
-- /q/paint/[token] page resolves to exactly one job.
create unique index if not exists painting_measurements_public_token_idx
  on public.painting_measurements (public_token)
  where public_token is not null;

-- Defence in depth — enable RLS now; service role still bypasses it.
alter table public.painting_measurements enable row level security;

-- Refresh the PostgREST schema cache so supabase-js sees the new table
-- immediately — without this, inserts can fail PGRST204 until a restart
-- (the cache-staleness class of bug that once broke the SMS roofing flow).
notify pgrst, 'reload schema';

-- Diagnostic echo for direct psql runs.
do $$
declare
  has_table boolean;
  rls_on    boolean;
begin
  select exists (
    select 1 from information_schema.tables
     where table_schema = 'public' and table_name = 'painting_measurements'
  ) into has_table;
  select relrowsecurity from pg_class
    where oid = 'public.painting_measurements'::regclass into rls_on;
  raise notice 'Migration 089: painting_measurements present=%, rls=%', has_table, rls_on;
end $$;
