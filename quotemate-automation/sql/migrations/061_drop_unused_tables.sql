-- Migration 061 · Drop unused tables (Phase 1 of DB cleanup audit)
--
-- Audit ran 2026-05-26 against prod. Two tables identified as DEAD:
--
--   • payments
--       0 rows. Schema reserved for Stripe Connect Express flows;
--       Connect isn't wired (every tenant has stripe_connect_account_id
--       NULL). One passive reader in /api/tenant/me has been replaced
--       with an empty Set in the same change (commit before this
--       migration).
--
--   • quote_line_items
--       0 rows. Init.sql declared it for normalised line items, but
--       the estimator never wrote to it — every quote stores its lines
--       inside the quotes.good / .better / .best jsonb columns. One
--       fallback reader in lib/ig-engine/generate.ts has been removed
--       in the same change.
--
-- Both code-side reads have been deleted before this migration runs;
-- a grep confirms zero `.from('payments')` or `.from('quote_line_items')`
-- remains. Re-introducing either path means re-creating the table from
-- this migration's history.
--
-- Idempotent: `drop table if exists` so a re-run is a no-op.

drop table if exists payments cascade;
drop table if exists quote_line_items cascade;
