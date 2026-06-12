-- Migration 108 · Pylon proposals (solar Pylon tab, spec 2026-06-12)
--
-- Backs the "Pylon" sub-tab of the dashboard Solar tab: the tradie designs a
-- job in Pylon studio, imports it via GET /v1/solar_designs/{id} (+ its
-- solar_project for customer/site details), and QuoteMate renders a branded
-- customer proposal at /q/pylon/[token] with the QuoteMate conversion layer
-- on top (confirm gate, Stripe deposit, SMS, Gotenberg PDF).
--
--   pylon_proposals — one row per imported Pylon design, per tenant.
--     design jsonb  — the full normalized design snapshot (summary, pricing,
--                     line_items, proposal_quote, locale.au, component types
--                     enriched with datasheet identities). Prices are the
--                     tradie's own human-authored Pylon numbers, verbatim.
--     assets jsonb  — storage paths of cached Pylon artefacts (snapshot
--                     image / single-line diagram PDF / PV site info PDF) in
--                     the intake-photos bucket under pylon/<id>/… — Pylon
--                     URLs are treated as unstable; we never hot-link them.
--     flags jsonb   — guardrail flags (stc_mismatch_pylon, pricing_mismatch_
--                     pylon). Flagged proposals cannot be confirmed; the fix
--                     loop is edit-in-Pylon-studio → re-import.
--
-- Re-import upserts on (tenant_id, pylon_design_id) — one live proposal per
-- design per tenant.
--
-- Idempotent. Apply with:
--   node --env-file=.env.local scripts/run-migration-108.mjs

create table if not exists public.pylon_proposals (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references tenants(id) on delete cascade,
  public_token     text not null unique,

  pylon_design_id  text not null,
  pylon_project_id text,

  title            text,            -- design title/label, e.g. "13.2kW Solar system"
  address_text     text,            -- flattened site address for cards/SMS
  customer         jsonb,           -- { name, phone, email } from solar_projects.customer_details
  site             jsonb,           -- site_address + site_details (roof type, phases, NMI…)

  design           jsonb not null,  -- normalized design snapshot (see lib/pylon/proposal.ts)
  assets           jsonb not null default '{}'::jsonb,
  flags            jsonb not null default '[]'::jsonb,

  status           text not null default 'awaiting_confirmation',
  confirmed_at     timestamptz,
  paid_at          timestamptz,
  pdf_path         text,

  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- Stripe deposit Checkout (created on confirm from the design's own
-- deposit amount; idempotent for re-runs after the table already exists).
alter table public.pylon_proposals
  add column if not exists stripe_checkout_url text;

create unique index if not exists pylon_proposals_design_idx
  on public.pylon_proposals (tenant_id, pylon_design_id);

create index if not exists pylon_proposals_tenant_idx
  on public.pylon_proposals (tenant_id, created_at desc);

-- Defence in depth — enable RLS now; service role still bypasses it and all
-- access goes through /api/* routes (app-layer tenant scoping, mig 040 posture).
alter table public.pylon_proposals enable row level security;

-- Explicit grant: some projects (e.g. the dev instance) lack the default
-- privileges that auto-grant service_role on new tables. All API access is
-- service-role; anon/authenticated get nothing (RLS has no policies anyway).
grant select, insert, update, delete on table public.pylon_proposals to service_role;

notify pgrst, 'reload schema';

-- ── Verification ─────────────────────────────────────────────────────
do $$
declare
  t_ok boolean;
begin
  select exists (select 1 from information_schema.tables
                  where table_schema='public' and table_name='pylon_proposals') into t_ok;
  raise notice 'Migration 108: pylon_proposals=%', t_ok;
end $$;
