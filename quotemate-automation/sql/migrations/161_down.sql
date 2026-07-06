-- Rollback for 161_full_quote_document.sql
alter table quotes drop column if exists report_style;
alter table quotes drop column if exists report_doc;
