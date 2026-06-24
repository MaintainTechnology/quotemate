-- ═══════════════════════════════════════════════════════════════════
-- QuoteMate · Database initialiser
-- Paste this entire file into Supabase SQL Editor and click Run.
--
-- Creates: 7 tables, the match_intakes function, the pgvector extension,
--          and seed data for the "easy 5" electrical jobs + AU pricing book.
--
-- This is idempotent on the function and seed inserts but NOT on table
-- creation. If you need to reset, drop tables manually first or run the
-- "RESET" block at the bottom of this file.
-- ═══════════════════════════════════════════════════════════════════

-- ──────────────────────────────────────────────
-- 1. Extensions
-- ──────────────────────────────────────────────
create extension if not exists vector;

-- ──────────────────────────────────────────────
-- 2. Lookup tables (read by Estimator tools)
-- ──────────────────────────────────────────────
create table if not exists shared_assemblies (
  id uuid primary key default gen_random_uuid(),
  trade text not null default 'electrical',
  name text not null,
  description text,
  default_unit text,
  default_unit_price_ex_gst numeric(10,2),
  default_labour_hours numeric(6,2),
  default_exclusions text,
  category text,  -- explicit grounding category (migration 029); NULL → categorise() name regex
  clarifying_questions jsonb  -- mandated MUST-ASK script (migration 032); NULL → universal name+suburb+scope only
);

create table if not exists shared_materials (
  id uuid primary key default gen_random_uuid(),
  trade text not null default 'electrical',
  name text not null,
  brand text,
  unit text,
  default_unit_price_ex_gst numeric(10,2)
);

create table if not exists pricing_book (
  id uuid primary key default gen_random_uuid(),
  hourly_rate numeric(8,2) default 110,
  call_out_minimum numeric(8,2) default 150,
  apprentice_rate numeric(8,2) default 60,
  default_markup_pct numeric(5,2) default 28,
  risk_buffer_pct numeric(5,2) default 15,
  gst_registered boolean default true,
  licence_type text,
  licence_number text,
  licence_state text,
  licence_expiry date,
  overlays jsonb default '{}'::jsonb,
  -- Per-feature customer-quote tier presentation mode (migration 142).
  -- 'single' (default) shows one price = the recommended tier; 'good_better_best'
  -- shows all priced tiers; 'good'|'better'|'best' force one tier. Per-row
  -- (per-trade). Resolver: lib/quote/tier-visibility.ts.
  quote_tier_mode text not null default 'single'
    check (quote_tier_mode in ('good_better_best', 'single', 'good', 'better', 'best'))
);

-- ──────────────────────────────────────────────
-- 3. Pipeline tables (written by the AI engines)
-- ──────────────────────────────────────────────
create table if not exists calls (
  id uuid primary key default gen_random_uuid(),
  vapi_call_id text unique,
  caller_number text,
  duration_seconds int,
  transcript text,
  recording_url text,
  photo_urls jsonb default '[]'::jsonb,
  ended_at timestamptz,
  created_at timestamptz default now()
);

create table if not exists intakes (
  id uuid primary key default gen_random_uuid(),
  call_id uuid references calls(id) on delete cascade,
  job_type text,
  address text,
  suburb text,
  scope jsonb,
  access jsonb,
  property jsonb,
  risks jsonb,
  inspection_required boolean default false,
  caller jsonb,
  timing jsonb,
  confidence text,
  confidence_reason text,
  embedding vector(1536),
  created_at timestamptz default now()
);

create table if not exists quotes (
  id uuid primary key default gen_random_uuid(),
  intake_id uuid references intakes(id) on delete cascade,
  status text default 'draft',

  scope_of_works text,
  assumptions jsonb default '[]'::jsonb,
  risk_flags jsonb default '[]'::jsonb,

  good jsonb,
  better jsonb,
  best jsonb,

  optional_upsells jsonb default '[]'::jsonb,
  estimated_timeframe text,
  needs_inspection boolean default false,
  inspection_reason text,
  gst_note text,

  selected_tier text default 'better',
  subtotal_ex_gst numeric(12,2),
  gst numeric(12,2),
  total_inc_gst numeric(12,2),

  created_at timestamptz default now(),
  sent_at timestamptz,
  accepted_at timestamptz,

  -- WP6 (migration 026): price-hold / urgency + post-deposit booking state.
  -- price_hold_until: when the quoted price stops being held (urgency).
  -- booking_state: null | 'reserved' (deposit paid) | 'booked' (slot chosen).
  price_hold_until timestamptz,
  booking_state text
);

create table if not exists quote_line_items (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid references quotes(id) on delete cascade,
  tier text not null,
  description text not null,
  quantity numeric(10,2),
  unit text,
  unit_price_ex_gst numeric(10,2),
  total_ex_gst numeric(12,2),
  source text
);

-- ──────────────────────────────────────────────
-- 4. Similarity-search function (used by Stage 04)
-- ──────────────────────────────────────────────
create or replace function match_intakes(
  query_embedding vector(1536),
  match_count int default 5
)
returns table (id uuid, scope jsonb, similarity float)
language sql stable as $$
  select id, scope, 1 - (embedding <=> query_embedding) as similarity
  from intakes
  where embedding is not null
  order by embedding <=> query_embedding
  limit match_count;
$$;

-- ──────────────────────────────────────────────
-- 5. Seed data — only inserts if tables are empty
-- ──────────────────────────────────────────────
insert into shared_assemblies (trade, name, description, default_unit, default_unit_price_ex_gst, default_labour_hours, default_exclusions)
select * from (values
  ('electrical', 'Install LED downlight',                  'Cut hole, terminate, fit fixture, test',                  'each', 28.00, 0.40, 'Excludes new wiring runs and ceiling repair'),
  ('electrical', 'Replace double GPO',                     'Disconnect, remove old, fit new, test',                   'each', 22.00, 0.30, 'Excludes new circuit work'),
  ('electrical', 'Install customer-supplied ceiling fan',  'Mount, terminate to existing wiring, test',               'each', 35.00, 1.00, 'Excludes ceiling reinforcement and supply of fan'),
  ('electrical', 'Hardwire 240V smoke alarm',              'Mount, terminate, test interconnect',                     'each', 30.00, 0.50, 'Excludes ceiling penetrations beyond standard'),
  ('electrical', 'Install outdoor IP-rated LED light',     'Mount weatherproof fitting on existing circuit',          'each', 32.00, 0.60, 'Excludes new circuit and underground cabling')
) as v(trade, name, description, default_unit, default_unit_price_ex_gst, default_labour_hours, default_exclusions)
where not exists (select 1 from shared_assemblies);

insert into shared_materials (trade, name, brand, unit, default_unit_price_ex_gst)
select * from (values
  ('electrical', 'Basic LED downlight',              null::text,  'each', 28.00),
  ('electrical', 'Tri-colour LED downlight',         null::text,  'each', 48.00),
  ('electrical', 'Dimmable IP-rated downlight',      null::text,  'each', 72.00),
  ('electrical', 'Standard double GPO',              'Clipsal',   'each', 25.00),
  ('electrical', 'USB double GPO',                   'Clipsal',   'each', 70.00),
  ('electrical', 'Hardwired smoke alarm',            'Clipsal',   'each', 95.00),
  ('electrical', 'RCBO safety switch',               'Clipsal',   'each', 85.00),
  ('electrical', 'Sundries (terminals, wire, clips)', null::text, 'each', 50.00)
) as v(trade, name, brand, unit, default_unit_price_ex_gst)
where not exists (select 1 from shared_materials);

insert into pricing_book (hourly_rate, default_markup_pct, licence_type, licence_state)
select 110, 28, 'NECA', 'NSW'
where not exists (select 1 from pricing_book);

-- ═══════════════════════════════════════════════════════════════════
-- Per-tenant file store (migration 134) — representative snapshot.
-- ═══════════════════════════════════════════════════════════════════
alter table tenants add column if not exists file_store_id text unique;

create table if not exists tenant_file_documents (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id) on delete cascade,
  source_kind   text not null check (source_kind in ('quote','invoice','historical_quote')),
  source_id     text not null,
  trade         text,
  display_name  text not null,
  storage_path  text,
  kb_document_id text,
  state         text not null default 'pending'
                  check (state in ('pending','active','failed','skipped')),
  skip_reason   text,
  bytes         int,
  error         text,
  attempts      int not null default 0,
  content_hash  text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz,
  unique (tenant_id, display_name)
);
create index if not exists tenant_file_documents_tenant_idx on tenant_file_documents (tenant_id);
create index if not exists tenant_file_documents_state_idx  on tenant_file_documents (state);
alter table tenant_file_documents enable row level security;

-- Files tab commenting (migration 136). A flat, two-party (tenant ↔ QuoteMate
-- staff) comment thread per archived document, plus a per-document resolved
-- state on tenant_file_documents. RLS posture matches the documents table.
alter table tenant_file_documents add column if not exists comments_resolved_at timestamptz;
alter table tenant_file_documents add column if not exists comments_resolved_by text;

create table if not exists tenant_file_comments (
  id               uuid primary key default gen_random_uuid(),
  file_document_id uuid not null references tenant_file_documents(id) on delete cascade,
  tenant_id        uuid not null references tenants(id) on delete cascade,
  author_role      text not null check (author_role in ('tenant','admin')),
  author_user_id   uuid not null,
  body             text not null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz,
  deleted_at       timestamptz
);
create index if not exists tenant_file_comments_doc_idx    on tenant_file_comments (file_document_id);
create index if not exists tenant_file_comments_tenant_idx on tenant_file_comments (tenant_id);
alter table tenant_file_comments enable row level security;

-- ───────────────────────────────────────────────────────────────────
-- tenant_historical_import_batches + tenant_historical_quotes
-- (migration 137). A tradie imports their existing quote history (CSV
-- exports + PDF quote docs); the system categorises it against the
-- canonical job_type taxonomy and surfaces pricing analytics / hints /
-- pricing-book calibration. Both tables tenant-scoped, RLS on, no client
-- policy (service role bypasses; tenancy enforced app-layer).
-- ───────────────────────────────────────────────────────────────────
create table if not exists tenant_historical_import_batches (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references tenants(id) on delete cascade,
  source_kind    text not null check (source_kind in ('csv','pdf')),
  filename       text,
  status         text not null default 'parsing'
                   check (status in ('parsing','categorizing','awaiting_review','committed','failed')),
  column_mapping jsonb not null default '{}'::jsonb,
  row_count      int not null default 0,
  error          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz
);
create index if not exists tenant_historical_import_batches_tenant_idx
  on tenant_historical_import_batches (tenant_id);
alter table tenant_historical_import_batches enable row level security;

create table if not exists tenant_historical_quotes (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references tenants(id) on delete cascade,
  batch_id            uuid references tenant_historical_import_batches(id) on delete cascade,
  source_kind         text not null check (source_kind in ('csv','pdf')),
  trade               text,
  job_type            text,
  job_type_confidence text check (job_type_confidence in ('high','medium','low')),
  raw_description     text,
  quoted_at           date,
  price_ex_gst        numeric(12,2),
  price_inc_gst       numeric(12,2),
  gst_basis           text not null default 'unknown' check (gst_basis in ('inc','ex','unknown')),
  currency            text not null default 'AUD',
  status              text not null default 'pending_review'
                        check (status in ('pending_review','confirmed','rejected')),
  file_document_id    uuid references tenant_file_documents(id) on delete set null,
  content_hash        text,
  raw_row             jsonb,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz
);
create index if not exists tenant_historical_quotes_tenant_idx   on tenant_historical_quotes (tenant_id);
create index if not exists tenant_historical_quotes_job_type_idx on tenant_historical_quotes (tenant_id, job_type);
create index if not exists tenant_historical_quotes_status_idx   on tenant_historical_quotes (tenant_id, status);
create unique index if not exists tenant_historical_quotes_dedup_idx
  on tenant_historical_quotes (tenant_id, content_hash);
alter table tenant_historical_quotes enable row level security;

-- ───────────────────────────────────────────────────────────────────
-- admin_audit_log — append-only trail for the admin customer console
-- (migration 135). Self-contained: no hard FKs (mirrors admin_users /
-- import_batches, which live only in migrations). The tenants/admin
-- tables are migration-only; this block keeps init.sql representative of
-- the audit table itself. Written only via service-role from admin routes.
-- ───────────────────────────────────────────────────────────────────
create table if not exists admin_audit_log (
  id uuid primary key default gen_random_uuid(),
  admin_user_id uuid not null,
  tenant_id uuid not null,
  action text not null check (action in (
    'suspend', 'reactivate', 'set_billing_exempt',
    'update_trades', 'change_plan', 'start_subscription'
  )),
  before jsonb not null default '{}'::jsonb,
  after  jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists admin_audit_log_tenant_idx
  on admin_audit_log (tenant_id, created_at desc);
alter table admin_audit_log enable row level security;

-- ───────────────────────────────────────────────────────────────────
-- tenant_feature_sources (migration 138) — provenance for per-tenant
-- feature toggles. tenants.trades[] is the runtime gate; this records WHY a
-- slug is on (manual/plan/onboarding) so the plan-tier seeding layer strips
-- only its own 'plan' grants on a downgrade. Written via service-role from the
-- admin console, onboarding, and the Stripe webhook.
-- ───────────────────────────────────────────────────────────────────
create table if not exists tenant_feature_sources (
  tenant_id  uuid not null references tenants(id) on delete cascade,
  feature    text not null,
  source     text not null check (source in ('manual', 'plan', 'onboarding')),
  updated_by uuid,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, feature)
);
create index if not exists tenant_feature_sources_tenant_idx
  on tenant_feature_sources (tenant_id);

-- ═══════════════════════════════════════════════════════════════════
-- Tradie identity fields (migration 141) — representative snapshot.
-- Business-identity fields surfaced on the customer quote letterhead.
-- business_name / owner_mobile / owner_email already exist on tenants;
-- licence + GST live on pricing_book. logo_path (storage object path)
-- predates this; logo_url is the public URL the quote page renders.
-- ═══════════════════════════════════════════════════════════════════
alter table tenants add column if not exists contact_name      text;
alter table tenants add column if not exists website_url       text;
alter table tenants add column if not exists business_address  text;
alter table tenants add column if not exists logo_url          text;

-- ═══════════════════════════════════════════════════════════════════
-- RESET BLOCK — uncomment and run only if you want to wipe everything
-- and start over from scratch.
-- ═══════════════════════════════════════════════════════════════════
-- drop table if exists quote_line_items cascade;
-- drop table if exists quotes cascade;
-- drop table if exists intakes cascade;
-- drop table if exists calls cascade;
-- drop table if exists pricing_book cascade;
-- drop table if exists shared_materials cascade;
-- drop table if exists shared_assemblies cascade;
-- drop function if exists match_intakes(vector, int);
