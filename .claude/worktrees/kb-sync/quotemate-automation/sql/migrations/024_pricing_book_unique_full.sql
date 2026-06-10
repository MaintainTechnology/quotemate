-- ════════════════════════════════════════════════════════════════════
-- Migration 024 — make pricing_book's (tenant_id, trade) unique index
-- NON-partial so PostgREST upserts can infer it as an ON CONFLICT target.
--
-- Background / bug being fixed:
--   Migration 015 created the uniqueness guarantee as a PARTIAL index:
--
--     create unique index pricing_book_tenant_trade_unique
--       on pricing_book (tenant_id, trade)
--       where tenant_id is not null;
--
--   PostgREST / supabase-js `.upsert(..., { onConflict: 'tenant_id,trade' })`
--   performs ON CONFLICT *inference*: it asks Postgres for a unique index
--   covering exactly those columns. Postgres will NOT match a partial
--   index during inference unless the statement also carries the index's
--   WHERE predicate — and PostgREST has no way to emit that predicate.
--   The result was a hard runtime failure on the Account → "SAVE TRADES"
--   path (POST /api/tenant/trades):
--
--     "there is no unique or exclusion constraint matching the
--      ON CONFLICT specification"
--
--   which blocked tradies from adding/dropping a second trade entirely.
--
-- Why dropping the WHERE predicate is safe:
--   A plain (non-partial) unique index on (tenant_id, trade) enforces the
--   EXACT SAME constraint for the rows that matter:
--     • tenant_id IS NOT NULL rows  → still uniquely (tenant_id, trade).
--       The partial index already enforced this, so no existing data can
--       violate the new index — the CREATE cannot fail on duplicates.
--     • tenant_id IS NULL rows      → Postgres treats NULL as DISTINCT in
--       unique indexes, so any number of legacy (NULL, trade) rows remain
--       allowed, identical to the partial index's behaviour.
--   Net effect on data: zero. Net effect on PostgREST: ON CONFLICT
--   inference on (tenant_id, trade) now resolves, so the documented
--   "upsert handles the rare race" intent in /api/tenant/trades and any
--   future upsert against this table works as written.
--
-- Idempotent: a same-named index is dropped first (CREATE UNIQUE INDEX
-- IF NOT EXISTS is a no-op when an index with that name already exists,
-- even if its definition differs — so we must DROP then CREATE to
-- actually swap a previously-partial index).
-- ════════════════════════════════════════════════════════════════════

drop index if exists pricing_book_tenant_trade_unique;

create unique index if not exists pricing_book_tenant_trade_unique
  on pricing_book (tenant_id, trade);
