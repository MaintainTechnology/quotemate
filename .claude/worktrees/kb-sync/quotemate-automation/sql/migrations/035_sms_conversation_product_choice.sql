-- ════════════════════════════════════════════════════════════════════
-- Migration 035 — WP9: mid-conversation product choice (durable store).
--
-- Holds the customer's "Clipsal 2000 vs Caroma Liano" pick for the
-- conversation:
--   { category, token, status:'pending'|'chosen',
--     options:[{catalogue_id,name,brand,range_series,price_ex_gst,
--               image_path,description,tier}],
--     chosen_catalogue_id, chosen_name, offered_at, chosen_at }
--
-- WHY ITS OWN COLUMN (not conversation_state): the SMS slot-merge
-- REPLACES sms_conversations.conversation_state wholesale every turn —
-- migration 030 added dedicated columns for exactly this reason after a
-- pin stashed in conversation_state got wiped. A mid-chat product pick
-- must survive every subsequent turn, so it gets its own jsonb column
-- the slot-merge never touches.
--
-- Purely ADDITIVE + idempotent. NULL = no choice offered (today's
-- behaviour). The WP9 route wiring is flag-gated (WP9_PRODUCT_OPTIONS)
-- so nothing reads/writes this until explicitly enabled — safe before
-- or after the code deploy, cannot regress a live conversation.
--
-- Apply:
--   node --env-file=.env.local scripts/run-migration-035.mjs
-- ════════════════════════════════════════════════════════════════════

alter table sms_conversations
  add column if not exists product_choice jsonb;

-- Keep PostgREST's schema cache fresh (mirrors migration 028/034 pattern).
notify pgrst, 'reload schema';
