-- ════════════════════════════════════════════════════════════════════
-- Migration 128 — tenants.pricing_confirmed_at (R14 tenant cold-start gate).
--
-- WHY: a tenant whose catalogue/rates are unconfirmed (or empty) would
-- auto-quote off generic shared-library defaults, not their real AU buy
-- prices. That is exactly the cold-start under/over-quote this column
-- guards against. Auto-send becomes eligible for a tenant only AFTER the
-- tradie confirms rates + top buy prices in onboarding; the deploy gate
-- (lib/routing/decide.ts, spec R23) reads this timestamp. Until it is set,
-- every quote for that tenant routes to tradie_review.
--
-- WHAT: adds a single nullable column to public.tenants:
--   pricing_confirmed_at timestamptz (default null)
-- NULL = not yet confirmed (the safe default for every existing tenant).
-- Set to now() by the onboarding confirm step (a later, separate change —
-- this migration only adds the column, it confirms nothing).
--
-- DDL-ONLY: this migration changes no existing data rows (it adds a column
-- that defaults to null on every row), so the runner intentionally SKIPS
-- the pre-apply data snapshot (the spec backup rule applies to data-
-- correction migrations only — see 122 / 126 for the same treatment).
--
-- Idempotent: ADD COLUMN IF NOT EXISTS — re-running is a clean no-op.
-- NOT auto-applied to prod. Apply with:
--   node --env-file=.env.local scripts/run-migration-128.mjs
-- Rollback with:
--   node --env-file=.env.local scripts/run-migration-128.mjs --rollback
-- ════════════════════════════════════════════════════════════════════

alter table public.tenants
  add column if not exists pricing_confirmed_at timestamptz default null;

comment on column public.tenants.pricing_confirmed_at is
  'R14 cold-start gate. NULL = catalogue/rates not yet confirmed by the tradie (auto-send blocked → tradie_review). Set to the confirm time once the tradie confirms rates + top buy prices in onboarding; the R23 deploy gate requires it non-null before auto-send.';

-- Keep PostgREST's schema cache fresh (the new column is now exposed).
notify pgrst, 'reload schema';
