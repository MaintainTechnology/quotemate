-- ════════════════════════════════════════════════════════════════════
-- Migration 135 — admin_audit_log (admin customer-management console).
--
-- WHY: the admin customer console (specs/admin-customer-console.md) lets
-- internal staff mutate tenant state — suspend/reactivate, comp billing,
-- toggle trades, and change/start a Stripe subscription. Every such
-- mutation is money- or access-affecting, so it must leave an immutable
-- record of WHO did WHAT to WHICH tenant, and the before→after values.
--
-- WHAT IT DOES: creates an append-only audit table. The app only ever
-- INSERTs (no update/delete path), so a committed row is permanent. RLS
-- is enabled (post-040 baseline) with no policies — the table is reached
-- only via the service-role key from admin-gated routes; anon/auth roles
-- see zero rows.
--
-- No hard FKs on admin_user_id / tenant_id — mirrors admin_users
-- (mig 050) and import_batches (mig 049), which keep these as plain uuid
-- columns so the audit row survives even if the referenced row is later
-- removed (the whole point of an audit trail).
--
-- ADDITIVE ONLY. Idempotent (create if not exists).
-- Apply with: node --env-file=.env.local scripts/run-migration-135.mjs
-- ════════════════════════════════════════════════════════════════════

create table if not exists admin_audit_log (
  id uuid primary key default gen_random_uuid(),
  admin_user_id uuid not null,          -- auth.users(id) of the acting admin
  tenant_id uuid not null,              -- tenants(id) the action targeted
  action text not null check (action in (
    'suspend',
    'reactivate',
    'set_billing_exempt',
    'update_trades',
    'change_plan',
    'start_subscription'
  )),
  before jsonb not null default '{}'::jsonb,   -- changed fields, prior values
  after  jsonb not null default '{}'::jsonb,   -- changed fields, new values
  created_at timestamptz not null default now()
);

-- The detail page reads a tenant's history newest-first.
create index if not exists admin_audit_log_tenant_idx
  on admin_audit_log (tenant_id, created_at desc);

-- Append-only, admin-service-role-only. RLS on, no policies → anon/auth
-- see nothing; service-role (used by the admin routes) bypasses RLS.
alter table admin_audit_log enable row level security;

comment on table admin_audit_log is
  'Append-only audit trail for the admin customer console. One row per mutating admin action (suspend/reactivate/set_billing_exempt/update_trades/change_plan/start_subscription) with before→after jsonb. Written only via service-role from admin-gated routes.';

notify pgrst, 'reload schema';
