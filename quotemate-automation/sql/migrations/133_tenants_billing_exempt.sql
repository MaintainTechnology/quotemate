-- ════════════════════════════════════════════════════════════════════
-- Migration 133 — tenants.billing_exempt (enforcement grandfather flag).
--
-- WHY: billing enforcement (gate in /api/estimate/draft, flag
-- BILLING_ENFORCEMENT_ENABLED) would cut off any tenant without an active
-- subscription the moment it's switched on. The existing pilot / founding
-- tradies are on the free test phase and must keep working. This flag lets
-- the gate bypass specific tenants so enforcement can be enabled safely.
--
-- WHAT IT DOES: adds one additive, non-null boolean (default false). No
-- existing behaviour changes — every tenant is non-exempt until explicitly
-- set true (e.g. UPDATE tenants SET billing_exempt = true WHERE ...).
--
-- DDL-only, idempotent. NOT auto-applied to prod. Apply:
--   node --env-file=.env.local scripts/run-migration-133.mjs
--   node --env-file=.env.local scripts/run-migration-133.mjs --rollback
-- ════════════════════════════════════════════════════════════════════

alter table public.tenants
  add column if not exists billing_exempt boolean not null default false;

comment on column public.tenants.billing_exempt is
  'When true, billing enforcement (BILLING_ENFORCEMENT_ENABLED) is bypassed for this tenant. Used to grandfather pilot / founding tradies so flipping enforcement on does not cut them off.';

notify pgrst, 'reload schema';
