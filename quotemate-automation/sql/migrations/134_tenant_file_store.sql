-- Migration 134 — per-tenant file store (spec 2026-06-19 tenant-file-store, R1).
--
-- Adds:
--   • tenants.file_store_id  — the tenant's Gemini File Search store id
--     (mirrors the twilio_sms_number / vapi_assistant_id / stripe_connect_account_id
--     provisioned-id precedent).
--   • tenant_file_documents  — one row per archived+ingested document. Tracks the
--     Supabase full-doc path, the minimized KB doc id, the async indexing state,
--     bounded-retry counter, and the content hash used for material-re-draft
--     detection. UNIQUE (tenant_id, display_name) is the idempotency backstop on
--     top of KB displayName dedup.

alter table tenants add column if not exists file_store_id text unique;

-- Where the calibration route archived the raw invoice image in the quote-pdfs
-- bucket. Persisted so the reconcile/backfill rebuild path (source-doc.ts) can
-- recover the full-doc path on a retry; without it a failed invoice ingest could
-- never recover (lockstep needs an archived full doc).
alter table invoice_uploads add column if not exists storage_path text;

create table if not exists tenant_file_documents (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id) on delete cascade,
  source_kind   text not null check (source_kind in ('quote','invoice')),
  -- uuid for electrical/plumbing/invoice; public_token for roofing/solar/painting.
  source_id     text not null,
  trade         text,
  display_name  text not null,
  -- Supabase Storage path of the FULL, unredacted document (source of truth).
  storage_path  text,
  -- Id of the PII-MINIMIZED markdown doc in the tenant's Gemini store.
  kb_document_id text,
  state         text not null default 'pending'
                  check (state in ('pending','active','failed','skipped')),
  skip_reason   text,
  bytes         int,
  error         text,
  -- Bounded-retry counter for the reconcile cron (R15b).
  attempts      int not null default 0,
  -- sha256 of the minimized kbText — drives material-re-draft replacement (R15).
  content_hash  text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz,
  unique (tenant_id, display_name)
);

create index if not exists tenant_file_documents_tenant_idx on tenant_file_documents (tenant_id);
create index if not exists tenant_file_documents_state_idx  on tenant_file_documents (state);

-- RLS posture matches migration 040 (Phase 1): enable RLS, no positive client
-- policy. The service-role key bypasses RLS so every /api route + cron works;
-- anon/auth roles see zero rows. Tenancy is enforced app-layer (P2 routes filter
-- by the authenticated tenant_id).
alter table tenant_file_documents enable row level security;
