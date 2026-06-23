-- Migration 136 — Files tab commenting (specs/files-tab.md R6/R7).
--
-- A flat, two-party (tenant ↔ QuoteMate staff) comment thread per archived
-- document, plus a per-document "resolved" state for that thread.
--
-- RLS posture matches tenant_file_documents (migration 134) and Phase 1
-- (migration 040): enable RLS, no positive client policy. The service-role key
-- bypasses RLS so the role-scoped /api routes work; anon/auth see zero rows.
-- Tenancy + author ownership are enforced app-layer in the routes.

create table if not exists tenant_file_comments (
  id               uuid primary key default gen_random_uuid(),
  file_document_id uuid not null references tenant_file_documents(id) on delete cascade,
  -- Denormalized tenant (always equals the parent doc's tenant) so the
  -- isolation filter + index don't need a join. Cascades with the tenant.
  tenant_id        uuid not null references tenants(id) on delete cascade,
  author_role      text not null check (author_role in ('tenant','admin')),
  -- The Supabase auth user id of the author (tenant owner or admin staffer).
  author_user_id   uuid not null,
  body             text not null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz,
  -- Soft delete: an author may remove their own comment; the row is retained
  -- (and excluded from listings) so the thread stays auditable.
  deleted_at       timestamptz
);

create index if not exists tenant_file_comments_doc_idx    on tenant_file_comments (file_document_id);
create index if not exists tenant_file_comments_tenant_idx on tenant_file_comments (tenant_id);

alter table tenant_file_comments enable row level security;

-- Per-document resolved state for the comment thread (R7). Null = open;
-- comments_resolved_by records which role ('tenant'|'admin') resolved it.
alter table tenant_file_documents add column if not exists comments_resolved_at timestamptz;
alter table tenant_file_documents add column if not exists comments_resolved_by text;
