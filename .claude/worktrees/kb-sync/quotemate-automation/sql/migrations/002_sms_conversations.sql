-- ═══════════════════════════════════════════════════════════════════
-- QuoteMate · SMS conversation state
-- Adds two tables for the SMS quoting channel:
--   - sms_conversations — one row per ongoing dialog with a customer
--   - sms_messages      — one row per inbound or outbound SMS, in order
-- Idempotent: safe to re-run.
-- ═══════════════════════════════════════════════════════════════════

create table if not exists sms_conversations (
  id                  uuid primary key default gen_random_uuid(),
  from_number         text not null,            -- customer mobile, E.164
  to_number           text not null,            -- our SMS dev number
  status              text not null default 'open',
                                                -- open | structuring | done | abandoned
  turn_count          int  not null default 0,  -- bumped per outbound reply
  intake_id           uuid references intakes(id) on delete set null,
                                                -- set once handed off to structureIntake
  assumptions_made    jsonb not null default '[]'::jsonb,
                                                -- accumulated assumption strings
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  last_message_at     timestamptz not null default now()
);

create index if not exists sms_conversations_from_open_idx
  on sms_conversations (from_number, status)
  where status = 'open';

create table if not exists sms_messages (
  id                  uuid primary key default gen_random_uuid(),
  conversation_id     uuid not null references sms_conversations(id) on delete cascade,
  direction           text not null,            -- 'inbound' | 'outbound'
  body                text not null,
  twilio_message_sid  text,                     -- Twilio's message id, useful for debugging
  created_at          timestamptz not null default now()
);

create index if not exists sms_messages_conversation_idx
  on sms_messages (conversation_id, created_at);
