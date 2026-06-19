-- ════════════════════════════════════════════════════════════════════
-- Migration 131 — DOWN (drop pricing_book.rate_review_flag) (spec R13).
--
-- Reverses 131_pricing_book_rate_flag.sql in full.
--
-- The forward migration only ADDED a marker column and stamped a sentinel
-- ('rate_out_of_band: confirm') on out-of-band rows — it never changed any
-- tenant-entered rate/markup value. Dropping the column therefore restores
-- the table to its pre-131 shape and loses nothing tenant-owned: the only
-- data in the column is the code-derived flag, which the forward migration
-- (or a re-run) can reproduce. Routing simply stops seeing the flag and the
-- band check falls back to whatever the routing layer computes live.
--
-- For a true row-for-row restore of the whole table (if ever needed), the
-- runner takes a pre-apply snapshot on the forward path:
--     pricing_book_backup_mig131
-- (created by scripts/run-migration-131.mjs).
--
-- Idempotent: DROP COLUMN IF EXISTS.
-- Apply with: node --env-file=.env.local scripts/run-migration-131.mjs --rollback
-- ════════════════════════════════════════════════════════════════════

alter table public.pricing_book
  drop column if exists rate_review_flag;

notify pgrst, 'reload schema';
