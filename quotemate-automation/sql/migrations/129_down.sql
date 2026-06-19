-- ════════════════════════════════════════════════════════════════════
-- Migration 129 DOWN — drop the supplier_price_refs table (R12).
--
-- Reverses 129_supplier_price_refs.sql in full by dropping the table it
-- created. The forward migration seeds ZERO rows (it is intentionally empty
-- on create — the real prices come from a later verified-source calibration
-- pass), so this is DDL-only and there is no data snapshot to restore.
--
-- ⚠ DATA-LOSS CAVEAT once the table is in use: after the separate calibration
-- pass has populated supplier_price_refs, this rollback DROPS those captured
-- provenance rows. Re-running the forward migration recreates only the empty
-- table, not its contents. Do not roll back once provenance has been captured
-- unless that data has been exported / is otherwise recoverable.
--
-- Idempotent: DROP TABLE IF EXISTS — re-running is a clean no-op.
-- Apply with:
--   node --env-file=.env.local scripts/run-migration-129.mjs --rollback
-- ════════════════════════════════════════════════════════════════════

drop table if exists public.supplier_price_refs;

-- Keep PostgREST's schema cache fresh (the dropped table is no longer exposed).
notify pgrst, 'reload schema';
