-- ════════════════════════════════════════════════════════════════════
-- Migration 040 — RLS Phase 1 (close the public-anon-key leak)
--
-- (originally drafted as 039 but renamed to avoid collision with
--  Anant's WIP 039_quote_followup_events.sql which was already
--  staged in-tree.)
--
-- Background: scripts/audit-rls-state.mjs (2026-05-20) confirmed
-- CLAUDE.md's "RLS reality" note had the threat shape inverted.
--
-- The dangerous tables aren't the RLS-on + no-policies ones — those are
-- safe (deny-by-default for anon, service-role bypass for the app).
-- The dangerous tables are the RLS-OFF ones: anyone with the public
-- NEXT_PUBLIC_SUPABASE_ANON_KEY (it ships in every browser bundle —
-- it's *supposed* to be public, Supabase expects RLS to be the access
-- control layer) can today
--   select * from tenants;             -- owner_email, mobile, stripe IDs
--   select * from customers;           -- PII
--   select * from sms_messages;        -- every SMS body + customer phone
--   select * from tenant_*;            -- catalogue, costs, licences
--
-- This migration enables RLS on those 13 tables. Every API route + every
-- server component already uses SUPABASE_SERVICE_ROLE_KEY (service role
-- bypasses RLS), so they continue to work unchanged. The ONLY positive
-- policy needed is for app/auth/callback/page.tsx:131-135 — the post-
-- signup `from('tenants').select(...).eq('owner_user_id', user.id)` read
-- via the browser anon client. Without it, the post-magic-link flow
-- breaks for every new tenant.
--
-- Phase 2 (tenant-scoped policies on the per-tenant tables) is deferred
-- — see quotemate-automation/docs/rls-design.md for the design. Phase 2
-- only matters when an /api/tenant/* route is ever ported off service-
-- role to direct anon access. That isn't on the v1 critical path.
--
-- ROLLBACK (single-statement-per-table, run from psql / Supabase SQL editor
-- if anything breaks post-deploy):
--   begin;
--     drop policy if exists tenants_self_select on tenants;
--     alter table tenants                       disable row level security;
--     alter table customers                     disable row level security;
--     alter table sms_conversations             disable row level security;
--     alter table sms_messages                  disable row level security;
--     alter table tradie_signup_intents         disable row level security;
--     alter table tenant_assembly_bom           disable row level security;
--     alter table tenant_assembly_overrides     disable row level security;
--     alter table tenant_custom_assemblies      disable row level security;
--     alter table tenant_licences               disable row level security;
--     alter table tenant_material_catalogue     disable row level security;
--     alter table tenant_material_preferences   disable row level security;
--     alter table tenant_service_offerings      disable row level security;
--     alter table shared_assembly_bom           disable row level security;
--   commit;
--
-- Idempotent: `enable row level security` is a no-op when RLS is already
-- on; `create policy if not exists` (via OR REPLACE pattern below) keeps
-- the policy declaration safe to re-run.
--
-- Apply with:
--   node --env-file=.env.local scripts/run-migration-040.mjs
-- ════════════════════════════════════════════════════════════════════

begin;

-- 1. Enable RLS on the 13 leaking tables. Service role still bypasses
--    RLS, so every existing API route / server component keeps working.
alter table tenants                       enable row level security;
alter table customers                     enable row level security;
alter table sms_conversations             enable row level security;
alter table sms_messages                  enable row level security;
alter table tradie_signup_intents         enable row level security;
alter table tenant_assembly_bom           enable row level security;
alter table tenant_assembly_overrides     enable row level security;
alter table tenant_custom_assemblies      enable row level security;
alter table tenant_licences               enable row level security;
alter table tenant_material_catalogue     enable row level security;
alter table tenant_material_preferences   enable row level security;
alter table tenant_service_offerings      enable row level security;
alter table shared_assembly_bom           enable row level security;

-- 2. The one positive anon-readable policy: app/auth/callback/page.tsx
--    reads the signed-in user's own tenant row to decide where to send
--    them next. Without this, every post-signup flow breaks.
--    The `to authenticated` role limits this policy to logged-in users
--    (anon callers still see nothing). The `owner_user_id = auth.uid()`
--    predicate ensures a user can only see THEIR tenant row, never
--    anyone else's.
drop policy if exists tenants_self_select on tenants;
create policy tenants_self_select on tenants
  for select to authenticated
  using (owner_user_id = auth.uid());

-- Keep PostgREST's schema cache fresh — mirrors migrations 024/026/028/034/038.
notify pgrst, 'reload schema';

commit;
