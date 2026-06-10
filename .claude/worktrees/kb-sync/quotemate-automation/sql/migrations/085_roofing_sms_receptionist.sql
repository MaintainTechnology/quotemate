-- Migration 085 · SMS roofing receptionist
--
-- Two additive columns to support gathering a roofing quote over SMS and
-- sharing it on a public, token-gated page (the MMS link).
--
--   1. sms_conversations.roofing_state (jsonb) — the deterministic
--      receptionist's gathered RoofingSlots + last_step, decoupled from
--      the electrical/plumbing conversation_state.slots so the two flows
--      never collide.
--   2. roofing_measurements.public_token (text, unique) — an unguessable
--      share token so /q/roof/[token] + its static-map image can be
--      fetched publicly (the customer link + the Twilio MMS image source)
--      without a Supabase session.
--
-- Additive only; no data backfill. Idempotent.

alter table public.sms_conversations
  add column if not exists roofing_state jsonb;

alter table public.roofing_measurements
  add column if not exists public_token text;

create unique index if not exists roofing_measurements_public_token_idx
  on public.roofing_measurements (public_token)
  where public_token is not null;

-- CRITICAL: refresh PostgREST's schema cache so the API layer (supabase-js,
-- which every route uses) can immediately read/write the new columns.
-- Without this, adding a column via SQL leaves PostgREST unaware of it and
-- writes to roofing_state are silently rejected (PGRST204) — which made the
-- SMS receptionist lose its memory and re-ask the first question forever.
notify pgrst, 'reload schema';

do $$
declare
  has_state  boolean;
  has_token  boolean;
begin
  select exists (
    select 1 from information_schema.columns
     where table_schema='public' and table_name='sms_conversations' and column_name='roofing_state'
  ) into has_state;
  select exists (
    select 1 from information_schema.columns
     where table_schema='public' and table_name='roofing_measurements' and column_name='public_token'
  ) into has_token;
  raise notice 'Migration 085: sms_conversations.roofing_state=%, roofing_measurements.public_token=%', has_state, has_token;
end $$;
