-- Rollback for migration 153 — drop the tenant welcome-email idempotency stamp.
alter table public.tenants
  drop column if exists welcome_email_sent_at;

notify pgrst, 'reload schema';
