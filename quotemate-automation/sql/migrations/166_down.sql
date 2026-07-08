-- 166_down.sql — revert 166_crm_connection_dc.sql

alter table public.crm_connections drop column if exists provider_metadata;

notify pgrst, 'reload schema';
