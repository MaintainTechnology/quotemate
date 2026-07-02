-- Migration 159 · 2-hour MID-CONVERSATION follow-up check-in
--
-- Extends the migration-079 feature (quote-level check-ins) to cover the
-- stage BEFORE a quote exists: the SMS receptionist asked the customer a
-- question and the customer went quiet mid-intake. Trade-agnostic — the
-- unit is the sms_conversations thread, so electrical/plumbing dialog
-- threads and the roofing/painting/solar receptionist flows are all
-- covered by the same sweep.
--
--   1. sms_conversations.followup_2h_sent_at — idempotency marker for
--      the cron sweep. ONE auto check-in per conversation, ever
--      (mirrors quotes.followup_2h_sent_at from migration 079).
--
--   2. Partial index for the cron's hot path: open customer threads not
--      yet followed up, scanned by idle time (last_message_at).
--
-- Reuses pricing_book.followup_2h_enabled (migration 079) as the tenant
-- toggle — one dashboard switch covers both quote-level and
-- conversation-level check-ins.
--
-- NOT auto-applied. Apply with:
--   node --env-file=.env.local scripts/run-migration-159.mjs

begin;

alter table public.sms_conversations
  add column if not exists followup_2h_sent_at timestamptz;

comment on column public.sms_conversations.followup_2h_sent_at is
  'Migration 159: idempotency marker for the 2h mid-conversation auto check-in (/api/cron/followup-2h). Non-null = the one-and-only check-in SMS for this thread was sent at this time.';

create index if not exists sms_conversations_followup_2h_pending_idx
  on public.sms_conversations (last_message_at)
  where followup_2h_sent_at is null
    and status = 'open'
    and conversation_type = 'customer_quote';

commit;

-- Refresh PostgREST's schema cache so supabase-js (which every route
-- uses) can read/write the new column immediately (mirrors 085/154).
notify pgrst, 'reload schema';
