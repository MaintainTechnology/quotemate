-- Rollback for 190 — trade_lead_requests.
--
-- DESTRUCTIVE: every outstanding form link dies with the table. A customer
-- holding a /quote-request/<token> SMS gets a dead-end page, and the tradie
-- has no record the link was ever sent. Back it up first:
--
--   create table trade_lead_requests_backup_mig190 as
--     select * from public.trade_lead_requests;
--
-- painting_lead_requests is untouched by 190 and untouched here — painting
-- keeps running on its own table either way.

drop index if exists public.trade_lead_requests_status_idx;
drop index if exists public.trade_lead_requests_tenant_idx;
drop table if exists public.trade_lead_requests;

notify pgrst, 'reload schema';
