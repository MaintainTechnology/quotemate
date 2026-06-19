-- Rollback for migration 133 — drop tenants.billing_exempt.
alter table public.tenants
  drop column if exists billing_exempt;

notify pgrst, 'reload schema';
