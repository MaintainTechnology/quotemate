-- ════════════════════════════════════════════════════════════════════
-- 182 · roofing_measurements.measure_token — column default + backfill
--
-- WHY
-- measure_token is the capability token for the tradie-facing Measurement
-- Results page at /m/[measure_token]. Every dashboard surface gates on it:
--   app/api/tenant/trade-jobs/route.ts:149   tradieHref: measure_token ? …
--   app/api/tenant/trade-jobs/owner-link     tokenColumn: 'measure_token'
--   app/api/roofing/save-as-quote            claims rows .eq('measure_token', …)
--
-- Migration 140 added the column, backfilled it, but left it NULLABLE with
-- NO DEFAULT. So correctness depended on every writer remembering to mint
-- one. /api/roofing/save did; the SMS receptionist never did — leaving 16
-- SMS-origin jobs with no Measurement Results page, and (because
-- save-as-quote claims BY measure_token) unable to be promoted to a quote
-- at all.
--
-- WHAT
-- 1. Backfill the NULL rows (same expression migration 140 used).
-- 2. Set a column DEFAULT so an INSERT that omits the column still gets a
--    token. This is the structural backstop: it fixes every current and
--    future writer in one place, not just the two that exist today.
--
-- Deliberately NOT adding NOT NULL. The failure mode was OMISSION, which
-- the default now covers. NOT NULL would additionally hard-fail any insert
-- that passes an explicit null — and a hard-failing SMS webhook is a worse
-- outcome than a missing link. No production writer passes explicit null
-- (verified 2026-07-23); if that changes, revisit.
--
-- Idempotent. Additive only — no column meaning changes, no data loss.
--
-- Apply with: node --env-file=.env.local scripts/run-migration-182.mjs
-- Rollback:   sql/migrations/182_down.sql
-- ════════════════════════════════════════════════════════════════════

create extension if not exists pgcrypto;

-- 1 · Backfill every token-less row (volatile per-row → unique per row).
update public.roofing_measurements
   set measure_token = encode(gen_random_bytes(16), 'hex')
 where measure_token is null;

-- 2 · Structural backstop: an omitted column now mints its own token.
alter table public.roofing_measurements
  alter column measure_token set default encode(gen_random_bytes(16), 'hex');

comment on column public.roofing_measurements.measure_token is
  'Tradie capability token for /m/[measure_token]. Defaults to a fresh 16-byte '
  'hex value (mig 182) so a writer that omits it still gets a Measurement '
  'Results page — the SMS receptionist omitted it and left 16 jobs unreachable.';

notify pgrst, 'reload schema';
