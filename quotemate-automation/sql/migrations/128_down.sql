-- ════════════════════════════════════════════════════════════════════
-- Migration 128 DOWN — drop tenants.pricing_confirmed_at (R14).
--
-- Reverses 128_tenants_pricing_confirmed_at.sql in full by dropping the
-- single column it added. DDL-only — it changes no data rows, so there is
-- no snapshot to restore (the forward migration only ever set the column to
-- null on existing rows).
--
-- ⚠ BEHAVIOURAL RISK after rollback: any code path that reads
-- tenants.pricing_confirmed_at (the R23 deploy gate) will break once the
-- column is gone. Coordinate this rollback with a code revert so nothing
-- still references the dropped column.
--
-- Idempotent: DROP COLUMN IF EXISTS — re-running is a clean no-op.
-- Apply with:
--   node --env-file=.env.local scripts/run-migration-128.mjs --rollback
-- ════════════════════════════════════════════════════════════════════

alter table public.tenants
  drop column if exists pricing_confirmed_at;

-- Keep PostgREST's schema cache fresh (the dropped column is no longer exposed).
notify pgrst, 'reload schema';
