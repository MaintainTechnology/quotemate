-- Migration 015 — multi-tenant onboarding foundation (v6).
--
-- Rationale: see docs/strategy.md v5 ("What's deferred" → multi-tenancy)
-- and the /docs/tradie-onboarding-plan page. This migration is the
-- schema foundation for the tradie self-serve sign-up flow.
--
-- After this migration runs, the onboarding form has a real database
-- target for every field. Twilio number purchase + Vapi assistant
-- creation are STUBBED in the application layer (no Twilio money yet)
-- — those become real API calls in Phase 1b. The schema is ready for
-- them regardless.
--
-- Idempotent — all `if not exists` and `on conflict do nothing` guards.

-- ── 1. tenants — top-level row per registered tradie ─────────────
create table if not exists tenants (
  id uuid primary key default gen_random_uuid(),

  -- Link to Supabase Auth user (set after sign up).
  -- Nullable so backfilled pilot rows can exist without an auth.users row.
  owner_user_id uuid references auth.users(id) on delete set null,

  -- Account basics (from onboarding form page 1)
  business_name text not null,
  owner_first_name text,
  owner_last_name text,
  owner_email text not null,
  owner_mobile text not null,

  -- Trade + optional regulatory fields (page 2 — most optional in test)
  trade text not null check (trade in ('electrical','plumbing')),
  state text,
  abn text,
  licence_type text,
  licence_number text,
  licence_expiry date,
  insurance_policy text,
  insurance_expiry date,

  -- Branding (deferred — defaults applied for now)
  logo_path text,
  brand_color text default '#ff5a1f',
  tagline text,

  -- Provisioned IDs (populated by /api/onboard/activate)
  twilio_sms_number text,
  twilio_voice_number text,
  vapi_assistant_id text,
  vapi_voice_persona text default 'jon',
  stripe_connect_account_id text,

  -- Lifecycle
  status text not null default 'onboarding'
    check (status in ('onboarding','active','suspended')),
  created_at timestamptz default now(),
  activated_at timestamptz
);

-- One row per owner email (cheap dedup guard)
create unique index if not exists tenants_owner_email_unique on tenants (owner_email);
-- Phone numbers must be unique across all tenants (when set)
create unique index if not exists tenants_twilio_sms_number_unique on tenants (twilio_sms_number) where twilio_sms_number is not null;
create unique index if not exists tenants_twilio_voice_number_unique on tenants (twilio_voice_number) where twilio_voice_number is not null;

-- ── 2. pricing_book extensions ───────────────────────────────────
-- Add tenant_id (the multi-tenancy key), senior_rate and
-- after_hours_multiplier (gaps from the original v5 audit).
alter table pricing_book add column if not exists tenant_id uuid references tenants(id) on delete cascade;
alter table pricing_book add column if not exists senior_rate numeric(8,2);
alter table pricing_book add column if not exists after_hours_multiplier numeric(4,2) default 1.5;

-- One pricing_book per (tenant, trade). The existing single-row index
-- (pricing_book_trade_unique from 013) is now relaxed — we expect
-- multiple rows once multi-tenant ships. Drop the old constraint.
drop index if exists pricing_book_trade_unique;
create unique index if not exists pricing_book_tenant_trade_unique
  on pricing_book (tenant_id, trade)
  where tenant_id is not null;

-- ── 3. tenant_service_offerings — which catalogue items each tradie offers ─
create table if not exists tenant_service_offerings (
  tenant_id uuid references tenants(id) on delete cascade,
  assembly_id uuid references shared_assemblies(id) on delete cascade,
  enabled boolean default true,
  primary key (tenant_id, assembly_id)
);

-- ── 4. Tenant scoping on operational tables ─────────────────────
-- Adding tenant_id so we can scope queries per tradie once multiple
-- tenants are active. NULL allowed for now to back-compat with legacy
-- rows that pre-date this migration.
alter table intakes            add column if not exists tenant_id uuid references tenants(id) on delete set null;
alter table quotes             add column if not exists tenant_id uuid references tenants(id) on delete set null;
alter table calls              add column if not exists tenant_id uuid references tenants(id) on delete set null;
alter table sms_conversations  add column if not exists tenant_id uuid references tenants(id) on delete set null;
alter table customers          add column if not exists tenant_id uuid references tenants(id) on delete set null;

-- Index for tenant-scoped queries on the operational tables
create index if not exists intakes_tenant_id_idx on intakes (tenant_id) where tenant_id is not null;
create index if not exists quotes_tenant_id_idx on quotes (tenant_id) where tenant_id is not null;
create index if not exists calls_tenant_id_idx on calls (tenant_id) where tenant_id is not null;

-- ── 5. Backfill: the 2 existing pilot tradies become tenants ────
-- Idempotent via owner_email unique constraint + ON CONFLICT.
insert into tenants (
  business_name, owner_first_name, owner_email, owner_mobile,
  trade, state, status, activated_at
)
values
  ('Pilot Sparky',  'Jon', 'sparky@quotemate.dev',  '+61400000001', 'electrical', 'NSW', 'active', now()),
  ('Pilot Plumber', 'Sam', 'plumber@quotemate.dev', '+61400000002', 'plumbing',   'QLD', 'active', now())
on conflict (owner_email) do nothing;

-- Link existing pricing_book rows to the appropriate pilot tenant.
update pricing_book pb
   set tenant_id = t.id
  from tenants t
 where pb.trade = 'electrical'
   and t.business_name = 'Pilot Sparky'
   and pb.tenant_id is null;

update pricing_book pb
   set tenant_id = t.id
  from tenants t
 where pb.trade = 'plumbing'
   and t.business_name = 'Pilot Plumber'
   and pb.tenant_id is null;

-- Auto-enable every shared assembly for each pilot tenant (test phase
-- default — in production this would be selected during onboarding).
insert into tenant_service_offerings (tenant_id, assembly_id, enabled)
select t.id, sa.id, true
  from tenants t
  join shared_assemblies sa on sa.trade = t.trade
 where t.business_name in ('Pilot Sparky','Pilot Plumber')
on conflict (tenant_id, assembly_id) do nothing;
