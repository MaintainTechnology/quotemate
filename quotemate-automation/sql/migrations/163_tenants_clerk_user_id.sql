-- ════════════════════════════════════════════════════════════════════
-- Migration 163 — link QuoteMax accounts to Clerk.
--
-- WHY: the app is migrating auth to Clerk. To capture a tenant's
-- subscription + admin state as Clerk publicMetadata we first need a stable
-- link from a tenant row to its Clerk user. This adds that link column.
--
-- WHAT IT DOES: one additive, nullable column on public.tenants plus a
-- partial unique index. No existing row is mutated (defaults null). The
-- column is populated by scripts/link-accounts-clerk.ts.
--
-- DDL-only, idempotent (add column IF NOT EXISTS). NOT auto-applied to prod.
-- Apply:
--   node --env-file=.env.local scripts/run-migration-163.mjs
--   node --env-file=.env.local scripts/run-migration-163.mjs --rollback
-- ════════════════════════════════════════════════════════════════════

alter table public.tenants
  add column if not exists clerk_user_id text;

-- One Clerk user per tenant. Partial unique index (WHERE NOT NULL) keeps the
-- many un-linked rows unconstrained while enforcing uniqueness on links.
create unique index if not exists idx_tenants_clerk_user_id
  on public.tenants (clerk_user_id)
  where clerk_user_id is not null;

comment on column public.tenants.clerk_user_id is
  'Clerk user id (user_...) linked to this tenant''s owner. Set by scripts/link-accounts-clerk.ts. The Clerk user holds is_admin + a subscription mirror (publicMetadata.subscription = {plan,status,interval}) synced by the Stripe webhook. SOURCE OF TRUTH for billing is Stripe → tenants.subscription_* (Supabase); Clerk metadata is the app-facing mirror, not an independent authority.';

notify pgrst, 'reload schema';
