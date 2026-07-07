-- Rollback for migration 163 — drop the Clerk link column + its index.
drop index if exists public.idx_tenants_clerk_user_id;

alter table public.tenants
  drop column if exists clerk_user_id;

notify pgrst, 'reload schema';
