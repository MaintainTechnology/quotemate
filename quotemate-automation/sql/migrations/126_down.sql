-- ════════════════════════════════════════════════════════════════════
-- Migration 126 DOWN — drop the job_type_bounds table (R9).
--
-- Reverses 126_job_type_bounds.sql in full. The table holds only provisional,
-- code-derived sanity bounds (no tenant-entered data), so dropping it is safe;
-- the sanity-bounds layer simply becomes a no-op (checkSanityBounds returns
-- ok:true when no bound row exists). Idempotent (IF EXISTS).
-- ════════════════════════════════════════════════════════════════════

drop table if exists public.job_type_bounds;

notify pgrst, 'reload schema';
