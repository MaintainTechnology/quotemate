-- ════════════════════════════════════════════════════════════════════
-- Migration 058 — drop the v5 seed tenants Pilot Sparky + Pilot Plumber.
--
-- Background: these two tenants were created on 2026-05-12 by the
-- migration-015 backfill so the original electrical/plumbing pricing_book
-- rows would have a tenant owner once tenant_id became required (WP1,
-- migration 025). They were never wired to a real Vapi assistant
-- (vapi_assistant_id IS NULL on both) and have ZERO customer traffic:
-- 0 intakes, 0 quotes, 0 calls, 0 customers, 0 sms_conversations
-- (verified via scripts/audit-pilot-tenant-deletion.mjs, 2026-05-26).
--
-- With four real tenants now operating their own pricing_books
-- (Atomic Electrical, Peppers Plumbing, Sparky x2 books), the pilots
-- are redundant scaffolding. Dashboard reports + the ↔pricing_book join
-- get cleaner with them gone.
--
-- Blast radius (all ON DELETE CASCADE, all hanging off the seed config):
--   • 2 pricing_book rows           (one electrical, one plumbing)
--   • 43 tenant_service_offerings   (20 electrical + 23 plumbing)
--   • 4 tenant_material_catalogue   (Pilot Sparky's WP2 demo catalogue)
--   • 0 of every other CASCADE table
-- All SET-NULL FKs (intakes/quotes/calls/customers/sms_conversations/
-- supplier_catalogue.created_by_tenant_id/tradie_signup_intents.resulting_tenant_id)
-- have 0 rows pointing at either tenant — no orphans created.
--
-- Code dependency: lib/tenant/lookup.ts:110 defined a
-- tenantByLegacyPilotTrade() helper for pre-v6 SMS fallback. Grep of
-- *.ts files confirmed zero runtime callers; that function is removed
-- in the same PR.
--
-- Safety:
--   • Belt-and-braces guards on id + business_name + owner_email +
--     vapi_assistant_id IS NULL. If any pilot row has been edited since
--     audit (e.g. activated Vapi) the DELETE matches zero and the
--     migration is a no-op rather than wiping a now-live tenant.
--   • Pre-flight traffic re-check inside the DO block aborts the
--     transaction if any intake/quote/call/customer/sms row points at
--     either pilot — protecting against a race between audit and apply.
--
-- NOT idempotent on the DELETE (rows will be gone after first run); safe
-- to re-run because the WHERE matches zero rows on a second pass.
--
-- Apply with:
--   node --env-file=.env.local scripts/run-migration-058.mjs
-- ════════════════════════════════════════════════════════════════════

begin;

-- 1. Re-check traffic inside the transaction. If anything has landed
--    between the audit and the apply (race window), abort cleanly.
do $$
declare
  pilot_ids uuid[] := array[
    'dc744841-f09d-4edb-a08e-e36d2025351f'::uuid,  -- Pilot Plumber
    'f77d5b1d-8cff-418d-94fa-a434c57ab88c'::uuid   -- Pilot Sparky
  ];
  traffic int;
begin
  select
      (select count(*) from intakes            where tenant_id = any(pilot_ids))
    + (select count(*) from quotes             where tenant_id = any(pilot_ids))
    + (select count(*) from calls              where tenant_id = any(pilot_ids))
    + (select count(*) from customers          where tenant_id = any(pilot_ids))
    + (select count(*) from sms_conversations  where tenant_id = any(pilot_ids))
  into traffic;

  if traffic > 0 then
    raise exception
      'Migration 058: pilot tenants have % traffic row(s). Refusing to delete. Audit drift since 2026-05-26 — re-run scripts/audit-pilot-tenant-deletion.mjs.',
      traffic;
  end if;
end $$;

-- 2. Delete Pilot Plumber. CASCADE handles pricing_book +
--    tenant_service_offerings + all other CASCADE FKs.
delete from tenants
 where id = 'dc744841-f09d-4edb-a08e-e36d2025351f'
   and business_name = 'Pilot Plumber'
   and owner_email = 'plumber@quotemate.dev'
   and vapi_assistant_id is null;

-- 3. Delete Pilot Sparky.
delete from tenants
 where id = 'f77d5b1d-8cff-418d-94fa-a434c57ab88c'
   and business_name = 'Pilot Sparky'
   and owner_email = 'sparky@quotemate.dev'
   and vapi_assistant_id is null;

-- Keep PostgREST's schema cache fresh (mirrors migrations 024/026/028/034/038).
notify pgrst, 'reload schema';

commit;
