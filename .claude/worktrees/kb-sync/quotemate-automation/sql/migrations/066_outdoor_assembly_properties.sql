-- Migration 066 · Stamp weatherproof+outdoor properties on 2 electrical
-- assemblies that were missing them.
--
-- Context: shared_assemblies.properties is read by applyPropertyFilters
-- in lib/estimate/tools.ts. When Opus calls lookupAssembly with
-- weatherproof=true, the WHERE clause is strict:
--   properties->>weatherproof = 'true'
-- A row with empty '{}'::jsonb properties has properties->>weatherproof
-- IS NULL, so it gets EXCLUDED — even when the row is semantically a
-- match (its NAME says it's outdoor / IP-rated).
--
-- This caught 2 rows whose names clearly indicate they're outdoor /
-- weatherproof but whose properties were left as '{}':
--   • "Install outdoor IP-rated GPO"
--   • "Install motion sensor flood light"
--
-- For comparison, the existing "Install outdoor IP-rated LED light"
-- row already had {"outdoor":true,"weatherproof":true} — this migration
-- brings the sibling rows into the same shape.
--
-- Scope deliberately tight:
--   • Only the 2 rows above (named explicitly).
--   • Not touching "Install security camera (single)" — marginal call
--     (most cameras are outdoor but indoor variants exist). Leave to
--     a future, evidence-based decision.
--   • Not touching the other 31 empty rows — they are correctly empty
--     (indoor jobs, plumbing-trade rows whose schema doesn't use these
--     filters, etc.).
--
-- Idempotent: WHERE includes `properties = '{}'::jsonb` so a re-run is
-- a no-op on already-populated rows. New row UPDATEs match the existing
-- weatherproof-true shape used by 'Install outdoor IP-rated LED light'.

update shared_assemblies
  set properties = '{"outdoor": true, "weatherproof": true}'::jsonb
  where trade = 'electrical'
    and name = 'Install outdoor IP-rated GPO'
    and properties = '{}'::jsonb;

update shared_assemblies
  set properties = '{"outdoor": true, "weatherproof": true}'::jsonb
  where trade = 'electrical'
    and name = 'Install motion sensor flood light'
    and properties = '{}'::jsonb;
