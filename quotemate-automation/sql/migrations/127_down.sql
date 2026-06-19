-- ════════════════════════════════════════════════════════════════════
-- Migration 127 DOWN — drop the quotes observability columns (R7 + R27).
--
-- Reverses 127_quotes_pricing_path.sql. DDL-only: it removes columns this
-- migration ADDED; no data rows are mutated (and the runner takes no
-- snapshot for a DDL-only change).
--
-- Drops the CHECK constraint first (it depends on pricing_path), then the
-- three columns this migration genuinely introduced:
--   • pricing_path
--   • auto_sent
--   • grounding_result
--
-- DELIBERATELY NOT DROPPED: routing_decision.
--   That column PRE-EXISTS this migration (created by sql/04_f3_finish.sql).
--   127's forward SQL only `add column if not exists`-es it as an idempotent
--   no-op, so it did NOT create it — dropping it here would destroy a column
--   that existed before 127 and is used elsewhere. Leaving it in place is the
--   correct, non-destructive rollback.
--
-- Idempotent: IF EXISTS on every drop — re-running is a clean no-op.
-- Apply with:
--   node --env-file=.env.local scripts/run-migration-127.mjs --rollback
-- ════════════════════════════════════════════════════════════════════

alter table public.quotes
  drop constraint if exists quotes_pricing_path_check;

alter table public.quotes
  drop column if exists pricing_path;

alter table public.quotes
  drop column if exists auto_sent;

alter table public.quotes
  drop column if exists grounding_result;

-- routing_decision intentionally retained (pre-existed migration 127).

notify pgrst, 'reload schema';
