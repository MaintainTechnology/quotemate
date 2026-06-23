-- Rollback for migration 137 (tenant historical quotes).
drop trigger if exists tenant_historical_quotes_set_updated_at on tenant_historical_quotes;
drop function if exists tenant_historical_quotes_set_updated_at();
drop table if exists tenant_historical_quotes;
drop table if exists tenant_historical_import_batches;

-- Restore the original tenant_file_documents.source_kind check.
alter table tenant_file_documents
  drop constraint if exists tenant_file_documents_source_kind_check;
alter table tenant_file_documents
  add constraint tenant_file_documents_source_kind_check
  check (source_kind in ('quote','invoice'));
