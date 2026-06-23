-- Rollback for migration 136 (Files tab commenting).
drop table if exists tenant_file_comments;
alter table tenant_file_documents drop column if exists comments_resolved_at;
alter table tenant_file_documents drop column if exists comments_resolved_by;
