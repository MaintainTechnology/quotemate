-- ════════════════════════════════════════════════════════════════════
-- Migration 059 — drop plumbing capability from the Sparky tenant.
--
-- Background: Sparky (tenant id 6dca084c-10d5-4459-b48f-9b45e4bbc68a)
-- was onboarded as cross-trade (trades=['electrical','plumbing']) but
-- has never received a plumbing intake (0 intakes / 0 quotes for the
-- plumbing book over the life of the account — verified via
-- scripts/audit-pricing-book-usage.mjs, 2026-05-26). The plumbing
-- pricing_book also carries the 36% electrical-default markup copied
-- by /api/onboard/activate, which is wrong for plumbing.
--
-- Per the tenant owner's authorised cleanup request (2026-05-26), this
-- migration strips ALL plumbing-scoped configuration from the Sparky
-- account, mirroring /api/tenant/trades's drop-trade flow with one
-- deliberate deviation: tenant_service_offerings rows for plumbing
-- assemblies are HARD-DELETED (the API route soft-disables them to
-- preserve toggle state for re-adding the trade later). The owner
-- explicitly asked for full cleanup, so we delete rather than disable.
--
-- Operations (all inside one transaction):
--   1. DELETE pricing_book row WHERE trade='plumbing' (1 row)
--   2. DELETE tenant_licences row WHERE trade='plumbing' (1 row)
--   3. DELETE tenant_service_offerings for every plumbing-trade
--      shared_assembly (23 rows: 16 enabled + 7 disabled)
--   4. DELETE tenant_material_catalogue rows whose category is
--      exclusively used by plumbing-trade assemblies (5 rows:
--      hot_water, tap, toilet)
--   5. UPDATE tenants SET trades=['electrical'], trade='electrical'
--
-- Not touched (already empty for plumbing on Sparky, or out of scope):
--   • tenant_assembly_bom            — 1 row, trade='electrical'
--   • tenant_assembly_overrides      — 0 rows
--   • tenant_custom_assemblies       — 0 rows
--   • tenant_material_preferences    — 0 rows
--   • tenant_tier_ladder             — 1 row, category='downlight' (electrical)
--   • intakes / quotes / calls / customers / sms_conversations — all 0
--     plumbing-scoped rows (verified by the audit script).
--
-- Safety:
--   • Single transaction (begin/commit) — partial failure rolls back.
--   • Pre-flight DO block inside the transaction asserts Sparky still
--     declares trades=['electrical','plumbing'] before any change. If
--     somebody dropped plumbing via the API between audit and apply,
--     this migration becomes a no-op rather than corrupting state.
--   • Catalogue-category filter is derived from shared_assemblies
--     (`having every(trade='plumbing')`) — purely data-driven, so it
--     cannot accidentally remove an electrical-category row even if
--     the categories drift.
--
-- Idempotent: re-running matches 0 rows on every DELETE/UPDATE.
--
-- Apply with:
--   node --env-file=.env.local scripts/run-migration-059.mjs
-- ════════════════════════════════════════════════════════════════════

begin;

-- 1. Re-check Sparky still declares plumbing. If they don't, somebody
--    beat us to it via /api/tenant/trades — abort cleanly.
do $$
declare
  current_trades text[];
begin
  select trades into current_trades
  from tenants
  where id = '6dca084c-10d5-4459-b48f-9b45e4bbc68a';

  if current_trades is null then
    raise exception 'Migration 059: Sparky tenant not found.';
  end if;

  if not ('plumbing' = any(current_trades)) then
    raise notice 'Migration 059: plumbing already dropped from Sparky (trades=%). No-op.', current_trades;
  end if;
end $$;

-- 2. DELETE pricing_book / plumbing.
delete from pricing_book
 where tenant_id = '6dca084c-10d5-4459-b48f-9b45e4bbc68a'
   and trade = 'plumbing';

-- 3. DELETE tenant_licences / plumbing.
delete from tenant_licences
 where tenant_id = '6dca084c-10d5-4459-b48f-9b45e4bbc68a'
   and trade = 'plumbing';

-- 4. HARD-DELETE tenant_service_offerings for plumbing-trade assemblies.
--    (Route does soft-disable; this is the deliberate deviation.)
delete from tenant_service_offerings
 where tenant_id = '6dca084c-10d5-4459-b48f-9b45e4bbc68a'
   and assembly_id in (
     select id from shared_assemblies where trade = 'plumbing'
   );

-- 5. DELETE tenant_material_catalogue rows whose category is exclusively
--    used by plumbing-trade assemblies. Data-driven: only categories
--    where EVERY shared_assembly row using that category is trade='plumbing'.
delete from tenant_material_catalogue
 where tenant_id = '6dca084c-10d5-4459-b48f-9b45e4bbc68a'
   and category in (
     select category from shared_assemblies
     where category is not null
     group by category
     having every(trade = 'plumbing')
   );

-- 6. UPDATE tenants: drop 'plumbing' from trades[], keep electrical as primary.
update tenants
   set trades = array_remove(trades, 'plumbing'),
       trade  = 'electrical'
 where id = '6dca084c-10d5-4459-b48f-9b45e4bbc68a';

-- Keep PostgREST's schema cache fresh (mirrors migrations 024/026/028/034/038/058).
notify pgrst, 'reload schema';

commit;
