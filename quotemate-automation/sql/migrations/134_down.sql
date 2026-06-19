-- Rollback for migration 134 (per-tenant file store).
drop table if exists tenant_file_documents;
alter table tenants drop column if exists file_store_id;
alter table invoice_uploads drop column if exists storage_path;
