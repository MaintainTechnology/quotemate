-- Migration 137 — tenant historical quotes (spec specs/historical-quotes.md, R1/R2).
--
-- Lets a tradie import their existing quote history (CSV exports + PDF quote
-- documents) so QuoteMate can categorise it against the canonical job-type
-- taxonomy and surface pricing analytics / hints / pricing-book calibration.
--
-- Two tables, both tenant_id-scoped with RLS enabled and NO positive client
-- policy (service-role bypasses; tenancy enforced app-layer) — matching the
-- posture of tenant_file_documents (migration 134) and tenant_custom_assemblies
-- (migration 023).
--
--   • tenant_historical_import_batches — one row per uploaded file. Tracks the
--     parse → categorise → review lifecycle and the LLM-derived column mapping.
--   • tenant_historical_quotes — one row per imported historical quote (one CSV
--     data row, or one PDF document). Holds the parsed price (ex + inc GST), the
--     categorised job_type + confidence, and the review status. Only
--     status='confirmed' rows feed analytics, hints and calibration.
--
-- Also extends tenant_file_documents.source_kind to allow 'historical_quote' so
-- imported PDF history is browsable through the existing per-tenant file store.
--
-- Idempotent: create table if not exists + if-not-exists indexes + drop/add of
-- the source_kind check constraint by its conventional auto-name.

-- ── Import batches ──────────────────────────────────────────────────
create table if not exists tenant_historical_import_batches (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references tenants(id) on delete cascade,
  source_kind    text not null check (source_kind in ('csv','pdf')),
  filename       text,
  status         text not null default 'parsing'
                   check (status in ('parsing','categorizing','awaiting_review','committed','failed')),
  -- LLM-derived map from the file's columns to canonical fields (csv only).
  column_mapping jsonb not null default '{}'::jsonb,
  row_count      int not null default 0,
  error          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz
);

create index if not exists tenant_historical_import_batches_tenant_idx
  on tenant_historical_import_batches (tenant_id);

alter table tenant_historical_import_batches enable row level security;

-- ── Historical quotes ──────────────────────────────────────────────
create table if not exists tenant_historical_quotes (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references tenants(id) on delete cascade,
  batch_id            uuid references tenant_historical_import_batches(id) on delete cascade,
  source_kind         text not null check (source_kind in ('csv','pdf')),
  trade               text,
  -- Canonical job_type from lib/intake/schema.ts; nullable until categorised.
  job_type            text,
  job_type_confidence text check (job_type_confidence in ('high','medium','low')),
  raw_description     text,
  quoted_at           date,
  -- Currency stored ex-GST (repo convention); inc-GST persisted alongside for
  -- display + analytics so callers don't re-derive GST.
  price_ex_gst        numeric(12,2),
  price_inc_gst       numeric(12,2),
  gst_basis           text not null default 'unknown' check (gst_basis in ('inc','ex','unknown')),
  currency            text not null default 'AUD',
  status              text not null default 'pending_review'
                        check (status in ('pending_review','confirmed','rejected')),
  -- Links a PDF import to its browsable tenant_file_documents row (null for csv).
  file_document_id    uuid references tenant_file_documents(id) on delete set null,
  -- sha256 of the normalised row/document — drives import dedup.
  content_hash        text,
  raw_row             jsonb,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz
);

create index if not exists tenant_historical_quotes_tenant_idx
  on tenant_historical_quotes (tenant_id);
create index if not exists tenant_historical_quotes_job_type_idx
  on tenant_historical_quotes (tenant_id, job_type);
create index if not exists tenant_historical_quotes_status_idx
  on tenant_historical_quotes (tenant_id, status);

-- Dedup: the same row content can't be imported twice for a tenant. Non-partial
-- so PostgREST upsert(onConflict='tenant_id,content_hash') works; Postgres treats
-- NULL content_hash as distinct, so rows whose hash couldn't be computed still
-- coexist rather than colliding.
create unique index if not exists tenant_historical_quotes_dedup_idx
  on tenant_historical_quotes (tenant_id, content_hash);

alter table tenant_historical_quotes enable row level security;

-- updated_at auto-bump (mirrors tenant_custom_assemblies' trigger pattern).
create or replace function tenant_historical_quotes_set_updated_at()
returns trigger as $$
begin
  new.updated_at := now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists tenant_historical_quotes_set_updated_at on tenant_historical_quotes;
create trigger tenant_historical_quotes_set_updated_at
  before update on tenant_historical_quotes
  for each row execute function tenant_historical_quotes_set_updated_at();

-- ── Extend tenant_file_documents.source_kind for browsable PDF history ──
alter table tenant_file_documents
  drop constraint if exists tenant_file_documents_source_kind_check;
alter table tenant_file_documents
  add constraint tenant_file_documents_source_kind_check
  check (source_kind in ('quote','invoice','historical_quote'));
