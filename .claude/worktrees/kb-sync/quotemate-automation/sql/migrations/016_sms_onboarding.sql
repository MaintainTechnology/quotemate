-- Migration 016 — SMS-initiated tradie onboarding.
--
-- Adds the data layer for the SMS onboarding flow:
--   • sms_conversations.conversation_type     — branch flag set on turn 1
--   • tradie_signup_intents                   — short-lived token row linking
--                                                a tradie's SMS thread to a
--                                                pending web onboarding
--
-- See /docs/sms-onboarding-flow for the full scenario.
--
-- Idempotent — `if not exists` and `add column if not exists` guards.

-- ── 1. sms_conversations.conversation_type ────────────────────────
-- Default 'customer_quote' so every existing row stays untouched.
-- The SMS inbound route flips this on turn 1 when the intent classifier
-- detects tradie registration phrases.
alter table sms_conversations
  add column if not exists conversation_type text not null default 'customer_quote';

-- Constrain to known values. Drop+recreate to keep idempotent.
do $$
begin
  alter table sms_conversations
    drop constraint if exists sms_conversations_conversation_type_check;
  alter table sms_conversations
    add constraint sms_conversations_conversation_type_check
    check (conversation_type in ('customer_quote', 'tradie_registration', 'converted'));
end$$;

create index if not exists sms_conversations_conversation_type_idx
  on sms_conversations (conversation_type)
  where conversation_type <> 'customer_quote';

-- ── 2. tradie_signup_intents ──────────────────────────────────────
-- One row per tradie who SMS-initiated a signup. The token is the
-- short URL-safe slug we send in the welcome SMS link. Resolved by
-- /api/onboard/intent/[token] when the tradie taps the link.
create table if not exists tradie_signup_intents (
  id                   uuid primary key default gen_random_uuid(),
  token                text not null unique,
  owner_mobile         text not null,
  sms_conversation_id  uuid references sms_conversations(id) on delete set null,
  expires_at           timestamptz not null default now() + interval '24 hours',
  used_at              timestamptz,
  resulting_tenant_id  uuid references tenants(id) on delete set null,
  created_at           timestamptz default now()
);

-- Fast lookup of an active (unused, unexpired) token by its slug.
create index if not exists tradie_signup_intents_active_lookup
  on tradie_signup_intents (token)
  where used_at is null;

-- One active intent per mobile at a time — prevents spam-creation of
-- tokens if a tradie texts repeatedly before tapping the link.
create unique index if not exists tradie_signup_intents_one_active_per_mobile
  on tradie_signup_intents (owner_mobile)
  where used_at is null;
