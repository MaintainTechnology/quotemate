-- ═══════════════════════════════════════════════════════════════════
-- Migration 223 — roof plan takeoff runs (qm-roofing-takeoff, phase P2).
--
-- Why:
--   The roofing takeoff service turns a builder's plan PDFs into a checked
--   roofing takeoff. One run spans several PDFs (an architectural set, an
--   engineering set), so a run gets its own table, modelled on paint_runs
--   (migration 107), and the existing plan tables gain a link to it.
--
-- What:
--   1. roof_takeoff_runs: one row per takeoff run.
--   2. plan_uploads.takeoff_run_id and plan_extractions.takeoff_run_id,
--      removed with their run, plus partial indexes.
--   3. The plan-pdfs bucket's file size limit goes from 32 MB to 50 MB. The
--      SMS and commercial-painting upload paths keep their own 32 MB checks.
--
-- The plan_extractions guards (migrations 198, 211, 212) let these rows
-- through: takeoff rows carry no sms_work_id, paint_run_id or priced_bom, and
-- are never released, so inserts, corrections and cascaded deletes all pass.
--
-- Rollback: 223_roof_takeoff_runs_down.sql
-- ═══════════════════════════════════════════════════════════════════

create table if not exists public.roof_takeoff_runs (
  id                     uuid primary key default gen_random_uuid(),
  tenant_id              uuid not null references public.tenants(id) on delete cascade,
  created_by             uuid,                         -- auth user of the operator
  job_name               text,
  job_ref                text,                         -- e.g. TAG job number J10001
  site_address           text not null,
  postcode               text,
  state                  text,
  source                 text not null default 'dashboard'
                         check (source in ('dashboard','tag_email','sms','api')),
  builder                jsonb,                        -- { business, contact, email, phone } from the request only
  scope_note             text,                         -- verbatim scope from the request
  status                 text not null default 'draft'
                         check (status in ('draft','queued','extracting','ready','needs_review','failed','saved')),
  status_note            text,                         -- plain-language reason on failure
  stage                  text check (stage in ('intake','classify','extract','calibrate','check','persist')),
  geometry_source        text not null default 'plans' check (geometry_source in ('plans','aerial','hybrid')),
  sheet_index            jsonb,                        -- classified sheets
  checks                 jsonb,                        -- latest C1–C9 results
  latest_extraction_id   uuid references public.plan_extractions(id) on delete set null,
  roofing_measurement_id uuid references public.roofing_measurements(id) on delete set null,
  export_manifest        jsonb,                        -- last export: files, hashes, versions
  last_exported_at       timestamptz,
  model                  text,
  usage                  jsonb,                        -- tokens and duration per stage
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  completed_at           timestamptz
);

create index if not exists roof_takeoff_runs_tenant_idx
  on public.roof_takeoff_runs (tenant_id, created_at desc);
create index if not exists roof_takeoff_runs_active_idx
  on public.roof_takeoff_runs (status) where status in ('queued','extracting');

-- Platform posture: RLS on with no policies; the service role bypasses it
-- and the anon key sees nothing.
alter table public.roof_takeoff_runs enable row level security;
grant select, insert, update, delete on public.roof_takeoff_runs to service_role;

alter table public.plan_uploads
  add column if not exists takeoff_run_id uuid references public.roof_takeoff_runs(id) on delete cascade;
alter table public.plan_extractions
  add column if not exists takeoff_run_id uuid references public.roof_takeoff_runs(id) on delete cascade;

create index if not exists plan_uploads_takeoff_run_idx
  on public.plan_uploads (takeoff_run_id) where takeoff_run_id is not null;
create index if not exists plan_extractions_takeoff_run_idx
  on public.plan_extractions (takeoff_run_id) where takeoff_run_id is not null;

-- 50 MB = 52428800 bytes. The runner fails the migration if the bucket is missing.
update storage.buckets set file_size_limit = 52428800 where id = 'plan-pdfs';

notify pgrst, 'reload schema';
