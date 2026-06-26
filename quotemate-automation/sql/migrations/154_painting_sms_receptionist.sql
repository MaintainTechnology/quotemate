-- Migration 154 · SMS painting receptionist
--
-- Supports gathering a residential painting quote over SMS plus the
-- per-request self-serve form link, mirroring the roofing receptionist
-- (migration 085).
--
--   1. sms_conversations.painting_state (jsonb) — the deterministic painting
--      receptionist's gathered PaintingSlots + last_step, decoupled from the
--      electrical/plumbing conversation_state.slots AND the roofing_state so
--      the three flows never collide.
--   2. painting_lead_requests — one row per offered self-serve form link. The
--      unguessable token is the unique hash in the SMS'd form URL
--      (/paint-request/[token]); on submit the form runs the painting estimate
--      and texts the customer their quote ("your quote is on its way").
--
-- Additive only; no data backfill. Idempotent.

alter table public.sms_conversations
  add column if not exists painting_state jsonb;

create table if not exists public.painting_lead_requests (
  token            text primary key,
  tenant_id        uuid,
  conversation_id  uuid,
  customer_phone   text,
  -- pending → form link sent; submitted → customer filled it in. The SMS
  -- Q&A fallback never creates a row (it quotes inline).
  status           text not null default 'pending',
  -- the painting_measurements.public_token the submitted form produced.
  quote_token      text,
  created_at       timestamptz not null default now(),
  submitted_at     timestamptz
);

create index if not exists painting_lead_requests_conversation_idx
  on public.painting_lead_requests (conversation_id, created_at desc);

-- CRITICAL: refresh PostgREST's schema cache so supabase-js (every route)
-- can read/write the new column + table immediately. Without this, writes to
-- painting_state are silently dropped (the PGRST204 trap migration 085
-- documents — it made the roofing receptionist lose its memory).
notify pgrst, 'reload schema';

do $$
declare
  has_state boolean;
  has_table boolean;
begin
  select exists (
    select 1 from information_schema.columns
     where table_schema='public' and table_name='sms_conversations' and column_name='painting_state'
  ) into has_state;
  select exists (
    select 1 from information_schema.tables
     where table_schema='public' and table_name='painting_lead_requests'
  ) into has_table;
  raise notice 'Migration 154: sms_conversations.painting_state=%, painting_lead_requests=%', has_state, has_table;
end $$;
