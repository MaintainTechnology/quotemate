-- Reverse 184. Tables first (the trigger goes with tenant_assembly_tasks via
-- cascade), then the trigger function, which nothing else references.
--
-- Purely additive migration, so this is a clean drop — no data lives anywhere
-- else that depends on these rows, and the estimator never read them.

drop table if exists public.tenant_assembly_tasks cascade;

drop table if exists public.shared_assembly_tasks cascade;

drop function if exists public.tenant_assembly_tasks_set_updated_at() cascade;
