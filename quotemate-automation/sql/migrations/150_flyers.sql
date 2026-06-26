-- Migration 150 · Flyer Designer — saved flyers + asset bucket.
--
-- Adds:
--   public.flyers           — one row per saved flyer (the editable document
--                             jsonb + cached PNG/PDF export paths), tenant-scoped.
--   storage bucket 'flyer-assets' — public-read bucket for exported PNG/PDF and
--                             tradie-uploaded images; writes go through the
--                             service-role API routes.
--
-- RLS enabled on flyers (consistent with migration 040 Phase 1); service-role
-- API routes bypass it and filter by tenant_id in app code. Idempotent.
-- NOT auto-applied. Apply with:
--   node --env-file=.env.local scripts/run-migration-150.mjs

begin;

create table if not exists public.flyers (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  name        text not null default 'Untitled flyer',
  template_id text not null,
  document    jsonb not null default '{}'::jsonb,  -- editable state (see lib/flyer/schema.ts)
  png_path    text,                                -- latest PNG export (flyer-assets)
  pdf_path    text,                                -- latest PDF export (flyer-assets)
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists idx_flyers_tenant on public.flyers (tenant_id);

comment on table public.flyers is
  'Saved marketing flyers from the dashboard Flyer Designer. document jsonb is '
  'the editable state; png_path/pdf_path point at the latest export in the '
  'flyer-assets storage bucket. Tenant-scoped (app-layer). Mig 150.';

-- RLS on, no positive policy — matches the rest of the app (service role
-- bypasses; tenancy is enforced by tenant_id filtering in /api/dashboard/flyer/*).
alter table public.flyers enable row level security;

grant select, insert, update, delete on public.flyers to service_role;
grant select, insert, update, delete on public.flyers to authenticated;

-- Storage bucket for exports + uploads (public read; writes via service role).
insert into storage.buckets (id, name, public)
  values ('flyer-assets', 'flyer-assets', true)
  on conflict (id) do nothing;

commit;
