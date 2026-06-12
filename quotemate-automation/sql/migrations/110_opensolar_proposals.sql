-- Migration 110 · OpenSolar proposals (solar OpenSolar tab, spec 2026-06-12)
--
-- Backs the "OpenSolar" sub-tab of the dashboard Solar tab: the tradie designs
-- a job in OpenSolar studio, imports the project via the OpenSolar API
-- (projects + systems/details + proposal data when the org's plan exposes it),
-- and QuoteMate renders a branded customer proposal at /q/opensolar/[token]
-- with the QuoteMate conversion layer on top (confirm gate, Stripe deposit,
-- SMS, Gotenberg PDF).
--
--   opensolar_proposals — one row per imported OpenSolar project system,
--   per tenant.
--     design jsonb  — the full normalized design snapshot (system facts,
--                     components, module groups, adders/incentives/line
--                     items, bills + financial metrics when the Raw Data
--                     plan exposes them). Prices are the tradie's own
--                     OpenSolar numbers, verbatim.
--     assets jsonb  — storage paths of cached artefacts (system-image
--                     render, generated shade report / energy yield report /
--                     PV site plan, install-pack documents) in the
--                     intake-photos bucket under opensolar/<id>/… —
--                     OpenSolar URLs are treated as unstable; we never
--                     hot-link them.
--     flags jsonb   — guardrail flags (stc_mismatch_opensolar,
--                     pricing_mismatch_opensolar). Flagged proposals cannot
--                     be confirmed; the fix loop is edit-in-OpenSolar-studio
--                     → re-import.
--
-- Re-import upserts on (tenant_id, opensolar_project_id, opensolar_system_uuid)
-- — one live proposal per system per tenant.
--
-- Idempotent. Apply with:
--   node --env-file=.env.local scripts/run-migration-110.mjs

create table if not exists public.opensolar_proposals (
  id                     uuid primary key default gen_random_uuid(),
  tenant_id              uuid not null references tenants(id) on delete cascade,
  public_token           text not null unique,

  opensolar_project_id   text not null,
  opensolar_system_uuid  text not null default '',

  title                  text,            -- system name, e.g. "System 1 (6.21 kW)"
  address_text           text,            -- flattened site address for cards/SMS
  customer               jsonb,           -- { name, phone, email } from project contacts
  site                   jsonb,           -- address parts + lat/lon + usage facts

  design                 jsonb not null,  -- normalized snapshot (see lib/opensolar/proposal.ts)
  assets                 jsonb not null default '{}'::jsonb,
  flags                  jsonb not null default '[]'::jsonb,

  status                 text not null default 'awaiting_confirmation',
  confirmed_at           timestamptz,
  paid_at                timestamptz,
  pdf_path               text,
  stripe_checkout_url    text,

  -- Round-trip link when the OpenSolar project originated as a QuoteMate
  -- lead push from a Google-path solar estimate.
  pushed_from_estimate_id uuid,

  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create unique index if not exists opensolar_proposals_system_idx
  on public.opensolar_proposals (tenant_id, opensolar_project_id, opensolar_system_uuid);

create index if not exists opensolar_proposals_tenant_idx
  on public.opensolar_proposals (tenant_id, created_at desc);

-- Defence in depth — enable RLS now; service role still bypasses it and all
-- access goes through /api/* routes (app-layer tenant scoping, mig 040 posture).
alter table public.opensolar_proposals enable row level security;

-- Explicit grant: some projects (e.g. the dev instance) lack the default
-- privileges that auto-grant service_role on new tables. All API access is
-- service-role; anon/authenticated get nothing (RLS has no policies anyway).
grant select, insert, update, delete on table public.opensolar_proposals to service_role;

notify pgrst, 'reload schema';

-- ── Verification ─────────────────────────────────────────────────────
do $$
declare
  t_ok boolean;
begin
  select exists (select 1 from information_schema.tables
                  where table_schema='public' and table_name='opensolar_proposals') into t_ok;
  raise notice 'Migration 110: opensolar_proposals=%', t_ok;
end $$;
