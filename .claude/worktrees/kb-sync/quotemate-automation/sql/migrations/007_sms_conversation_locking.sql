-- ════════════════════════════════════════════════════════════════════
-- Per-conversation lock for SMS inbound — eliminates the duplicate-reply
-- race when a customer fires multiple messages in quick succession AND
-- enables the completion-aware "smart re-engagement" logic.
--
-- Background: Twilio sends one webhook per inbound SMS. If a customer
-- texts "Hey there" + "Hi there" within a second, two Vercel functions
-- fire in parallel and each calls Haiku independently — customer gets
-- 2 awkward replies. With this column, the second webhook sees that
-- the first one already holds the lock, persists its message, and
-- bails. The leader's debounce + tail-check catches the second message
-- when it loads conversation history.
--
-- The lock auto-expires after 60s if a function dies mid-flow, so a
-- crashed lock holder never permanently blocks a customer.
-- ════════════════════════════════════════════════════════════════════

alter table public.sms_conversations
  add column if not exists processing_until timestamptz;

comment on column public.sms_conversations.processing_until is
  'Per-conversation lock for SMS inbound. While set and >NOW(), no other webhook should run Haiku for this conversation. Auto-expires after 60s. Cleared by the leader after dispatching the reply.';

-- Index on (from_number, last_message_at) so the smart-reuse lookup
-- ("most recent conversation for this number") is fast at scale.
create index if not exists sms_conversations_from_number_last_message_at_idx
  on public.sms_conversations (from_number, last_message_at desc);
