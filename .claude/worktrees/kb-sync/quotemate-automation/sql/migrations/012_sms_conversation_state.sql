-- ════════════════════════════════════════════════════════════════════
-- QuoteMate · SMS conversation slot-state
--
-- Adds a structured per-conversation state object to sms_conversations.
-- Replaces the implicit "Haiku reads name + suburb out of the transcript
-- every turn" design with a real slot store that's filled in turn-by-turn
-- by lib/sms/extract-slots.ts.
--
-- Why: the previous design had no source of truth for what we knew about
-- a conversation MID-flow. Two failure modes followed:
--   1. Customer corrections (e.g. "Chandler" when stored suburb is
--      "Coorparoo") were silently ignored because Haiku weighted the
--      KNOWN CUSTOMER MEMORY block over the live transcript.
--   2. The deterministic scrubAskingForKnownSuburb fired even when the
--      customer had just provided the corrected value, rewriting Haiku's
--      reply into the canned "still at the Coorparoo place?" override.
-- Real bug observed 2026-05-11 (Con/Coorparoo→Chandler).
--
-- Shape (nested keeps slots and source attribution cleanly separated):
--   {
--     "slots":   { "first_name": "Mike", "suburb": "Bondi", ... },
--     "sources": { "first_name": "from_memory",
--                  "suburb": "customer_corrected", ... },
--     "verified": false,
--     "last_extracted_at": "2026-05-11T..."
--   }
-- Source values: 'from_memory' | 'from_transcript' | 'customer_corrected'.
--
-- Idempotent: safe to re-run.
-- ════════════════════════════════════════════════════════════════════

alter table public.sms_conversations
  add column if not exists conversation_state jsonb not null default '{}'::jsonb;

comment on column public.sms_conversations.conversation_state is
  'Structured per-conversation slot state. Pre-seeded from customers row at conversation start, updated turn-by-turn by lib/sms/extract-slots.ts. Shape: {slots, sources, verified, last_extracted_at}. Source values: from_memory | from_transcript | customer_corrected.';
