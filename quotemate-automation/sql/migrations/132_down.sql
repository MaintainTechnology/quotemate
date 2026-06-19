-- Rollback for migration 132 — drop tenant subscription / billing columns.
drop index if exists public.idx_tenants_stripe_customer_id;
drop index if exists public.idx_tenants_stripe_subscription_id;

alter table public.tenants
  drop column if exists stripe_customer_id,
  drop column if exists stripe_subscription_id,
  drop column if exists subscription_status,
  drop column if exists subscription_plan,
  drop column if exists subscription_interval,
  drop column if exists subscription_current_period_end,
  drop column if exists trial_ends_at,
  drop column if exists subscription_cancel_at_period_end;

notify pgrst, 'reload schema';
