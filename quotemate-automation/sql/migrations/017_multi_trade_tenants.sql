-- Migration 017 — multi-trade tenants (a single tradie can run both
-- an electrical AND a plumbing business out of the same QuoteMate
-- account).
--
-- Rationale: real owner-operator companies often hold both licences
-- (e.g. a small Sydney company doing residential reno work).
-- Pre-017 the wizard forced a single trade and the rest of the
-- pipeline assumed `tenants.trade` was a scalar. This migration
-- introduces a `trades text[]` column on tenants and backfills it
-- from the existing single value, so legacy single-trade tenants
-- continue to work without code changes elsewhere.
--
-- Backwards-compat strategy:
--   • `tenants.trade` stays on the table (still NOT NULL via existing
--     check) and is kept in sync with `trades[0]` by the activate
--     route. Old code paths that read `tenant.trade` keep working
--     against the primary trade.
--   • `pricing_book.tenant_id + pricing_book.trade` is already the
--     uniqueness key (migration 015), so multi-trade tenants get one
--     `pricing_book` row per trade — no schema change needed there.
--   • `tenant_service_offerings` is trade-agnostic (just links
--     assemblies); no change.
--
-- Idempotent: `if not exists` + conditional backfill.

-- ── 1. Add trades[] column ─────────────────────────────────────────
alter table tenants
  add column if not exists trades text[] not null default array[]::text[];

-- Backfill from the legacy scalar column.
update tenants
   set trades = array[trade]
 where trade is not null
   and (trades is null or array_length(trades, 1) is null);

-- Guard: every tenant should now have at least one trade.
-- (We don't enforce a CHECK constraint here because the wizard
-- validates min(1) at submit time; a runtime constraint would block
-- the rare admin/back-office workflow that inserts a placeholder row.)

-- ── 2. Index for trade-scoped lookups ──────────────────────────────
-- Inbound SMS / voice routing will need to find tenants that handle
-- a given trade. A GIN index on the array makes `trades @> array['plumbing']`
-- lookups fast even at thousands-of-tenants scale.
create index if not exists tenants_trades_gin_idx on tenants using gin (trades);
