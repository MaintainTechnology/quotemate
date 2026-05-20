-- ════════════════════════════════════════════════════════════════════
-- Migration 038 — drop the stub "Sparky" tenant + add a partial unique
--                  guard on tenants(owner_email)
--
-- Background: scripts/report-services-full.mjs (2026-05-20) surfaced two
-- active tenants both literally named "Sparky" sharing the same owner
-- mobile (+61480808517). Investigation via
-- scripts/inspect-sparky-tenants.mjs:
--
--   • 4f93e688-deb1-41f0-84d9-0f57e956720d  — STUB
--       created 2026-05-12, vapi_assistant_id='vapi-stub-4f93e688',
--       0 intakes, 0 sms_conversations, 0 sms_messages, 0 customers,
--       0 calls, 0 quotes, 0 custom assemblies, 0 material catalogue.
--       Only 10 tenant_service_offerings + 1 pricing_book row hanging
--       off it (both ON DELETE CASCADE → cleaned automatically).
--   • 6dca084c-10d5-4459-b48f-9b45e4bbc68a  — LIVE
--       created 2026-05-13, real Vapi assistant id, 25 intakes,
--       21 conversations, 254 SMS messages, full electrical+plumbing
--       catalogue. KEEP.
--
-- ALL six SET-NULL FKs (calls/customers/intakes/quotes/sms_conversations/
-- tradie_signup_intents.resulting_tenant_id) returned 0 rows for the
-- stub in the pre-flight, so nothing orphans. Safe DELETE.
--
-- Also adds a partial unique index on lower(owner_email) for active +
-- pending tenants — would have prevented the original double-signup
-- if both had used the same email (this case used two emails on the
-- same mobile, so it doesn't catch THIS instance, but it does prevent
-- the more common "tradie tries to sign up twice" failure).
-- Restricted to active/pending so archived tenants don't block a
-- legitimate re-signup later.
--
-- NOT idempotent on the DELETE (the row will be gone after first run);
-- safe to re-run because the WHERE matches zero rows.
-- Idempotent on the index (if not exists).
--
-- Apply with:
--   node --env-file=.env.local scripts/run-migration-038.mjs
-- ════════════════════════════════════════════════════════════════════

begin;

-- 1. Drop the stub tenant.
--    CASCADE handled by FKs on: pricing_book, tenant_service_offerings,
--    tenant_custom_assemblies, tenant_licences, tenant_material_catalogue,
--    tenant_material_preferences, tenant_assembly_overrides, tenant_assembly_bom.
delete from tenants
 where id = '4f93e688-deb1-41f0-84d9-0f57e956720d'
   and vapi_assistant_id = 'vapi-stub-4f93e688'    -- belt + braces: only the stub
   and business_name = 'Sparky';

-- 2. Partial unique guard for future double-signups.
--    Allows the same email to be re-used after a tenant is archived/cancelled.
create unique index if not exists tenants_active_owner_email_unique
  on tenants (lower(owner_email))
  where status in ('active', 'pending');

-- Keep PostgREST's schema cache fresh (mirrors migrations 024/026/028/034).
notify pgrst, 'reload schema';

commit;
