-- ════════════════════════════════════════════════════════════════════
-- Migration 122 — DOWN (rollback of the active-conversation race backstop).
--
-- Reverses: 122_sms_conversation_active_unique.sql, which created
--   1. the partial unique index
--        sms_conversations_active_customer_quote_unique
--   2. the idempotent-create RPC
--        public.create_sms_conversation_idempotent(text,text,text,uuid,uuid,text,jsonb)
-- This down migration drops BOTH. It is DDL-only — it changes no data rows.
--
-- IRREVERSIBILITY / OPERATIONAL CAVEATS:
--   • DDL-ONLY: there are no data rows to back up or restore for 122, so the
--     runner intentionally skips the pre-apply snapshot for this migration.
--     Re-applying the forward migration (without --rollback) fully recreates
--     both objects (it is itself idempotent: CREATE UNIQUE INDEX IF NOT
--     EXISTS + CREATE OR REPLACE FUNCTION).
--   • BEHAVIOURAL RISK after rollback: dropping the partial unique index
--     removes the database-level guard against split-brain duplicate active
--     customer_quote conversations. If the inbound route still calls
--     create_sms_conversation_idempotent via supabase.rpc(), that call will
--     ERROR once the function is gone — coordinate this rollback with a route
--     revert so the app stops calling the dropped RPC first.
--   • The function signature in the DROP below MUST match the forward
--     definition exactly (7 args: text,text,text,uuid,uuid,text,jsonb).
--
-- Idempotent: IF EXISTS on both drops — re-running is a clean no-op.
-- Apply with: node --env-file=.env.local scripts/run-migration-122.mjs --rollback
--   (add --dev to target the development DB; --dry to BEGIN; … ROLLBACK;)
-- ════════════════════════════════════════════════════════════════════

drop index if exists sms_conversations_active_customer_quote_unique;

drop function if exists public.create_sms_conversation_idempotent(text,text,text,uuid,uuid,text,jsonb);

-- Keep PostgREST's schema cache fresh (the dropped RPC is no longer exposed).
notify pgrst, 'reload schema';
