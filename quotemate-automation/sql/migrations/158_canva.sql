-- Migration 158 · Canva Connect — per-tenant OAuth + design tracking.
--
-- Adds:
--   public.canva_connections  — one row per tenant: the Canva OAuth tokens
--                               (access/refresh) the API routes act with.
--   public.canva_oauth_states — short-lived PKCE state binding the OAuth
--                               callback to one authenticated connect attempt.
--   public.canva_designs      — Canva designs a tenant created from the Flyer
--                               tab + the paths of imported PNG/PDF exports
--                               (stored in the existing flyer-assets bucket).
--
-- These tables hold secrets/tokens, so — unlike public.flyers — they are
-- granted to service_role ONLY (the /api/dashboard/flyer/canva/* routes use the
-- service-role key). RLS is enabled with no positive policy, so anon and
-- authenticated roles see nothing. Idempotent. NOT auto-applied. Apply with:
--   node --env-file=.env.local scripts/run-migration-158.mjs

begin;

-- Per-tenant Canva OAuth tokens. One connection per tenant (PK = tenant_id).
create table if not exists public.canva_connections (
  tenant_id        uuid primary key references public.tenants(id) on delete cascade,
  access_token     text not null,
  refresh_token    text,
  token_expires_at timestamptz not null,
  scope            text,
  canva_user_id    text,
  connected_by     uuid references auth.users(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

comment on table public.canva_connections is
  'Per-tenant Canva Connect OAuth tokens for the Flyer tab. Service-role only. Mig 158.';

-- One-time PKCE state for the authorization-code + PKCE flow.
create table if not exists public.canva_oauth_states (
  state         text primary key,
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  code_verifier text not null,
  redirect_uri  text not null,
  connected_by  uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now()
);
create index if not exists idx_canva_oauth_states_created on public.canva_oauth_states (created_at);

comment on table public.canva_oauth_states is
  'Short-lived PKCE state for Canva OAuth; consumed (deleted) on callback. Mig 158.';

-- Canva designs created from the Flyer tab + imported export artifacts.
create table if not exists public.canva_designs (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  canva_design_id text not null,
  title           text,
  edit_url        text not null,
  view_url        text,
  status          text not null default 'editing',   -- editing | imported | failed
  png_path        text,                              -- imported PNG (flyer-assets)
  pdf_path        text,                              -- imported PDF (flyer-assets)
  created_by      uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists idx_canva_designs_tenant on public.canva_designs (tenant_id);

comment on table public.canva_designs is
  'Canva designs created from the Flyer tab; png_path/pdf_path point at imported '
  'exports in the flyer-assets bucket. Tenant-scoped (app-layer). Mig 158.';

-- RLS on, no positive policy. Service role bypasses; app filters by tenant_id.
alter table public.canva_connections  enable row level security;
alter table public.canva_oauth_states enable row level security;
alter table public.canva_designs      enable row level security;

-- Token-bearing tables are service-role only (no authenticated grant).
grant select, insert, update, delete on public.canva_connections  to service_role;
grant select, insert, update, delete on public.canva_oauth_states to service_role;
grant select, insert, update, delete on public.canva_designs      to service_role;

commit;
