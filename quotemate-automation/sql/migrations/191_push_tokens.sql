-- Migration 191 · seat-scoped Expo tokens and delayed receipt tracking.
-- Additive and idempotent. No external service is contacted by this migration.

create table if not exists public.push_tokens (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  user_id       text not null,
  token         text not null,
  platform      text not null check (platform in ('ios', 'android')),
  device_name   text check (device_name is null or char_length(device_name) <= 100),
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz not null default now()
);

-- CREATE TABLE IF NOT EXISTS does not upgrade a table created by an earlier
-- partial rollout. Ownership cannot be reconstructed from an old device token,
-- so retire ownerless registrations and let authenticated devices re-register.
alter table public.push_tokens
  add column if not exists user_id text;

delete from public.push_tokens
where user_id is null or btrim(user_id) = '';

-- A partial rollout may have accepted the same registration more than once
-- before the seat-scoped key existed. The rows are equivalent; keep one.
delete from public.push_tokens duplicate
using public.push_tokens keeper
where duplicate.ctid < keeper.ctid
  and duplicate.tenant_id = keeper.tenant_id
  and duplicate.user_id = keeper.user_id
  and duplicate.token = keeper.token;

alter table public.push_tokens
  alter column user_id set not null;

-- Remove the legacy tenant+token key (which incorrectly prevents two seats
-- from registering the same token) and enforce the exact seat-scoped key.
do $$
declare
  legacy_constraint record;
begin
  for legacy_constraint in
    select c.conname
    from pg_constraint c
    where c.conrelid = 'public.push_tokens'::regclass
      and c.contype = 'u'
      and pg_get_constraintdef(c.oid) = 'UNIQUE (tenant_id, token)'
  loop
    -- drop constraint for the legacy unique (tenant_id, token) shape
    execute format(
      'alter table public.push_tokens drop constraint %I',
      legacy_constraint.conname
    );
  end loop;

  if not exists (
    select 1
    from pg_constraint c
    where c.conrelid = 'public.push_tokens'::regclass
      and c.contype = 'u'
      and pg_get_constraintdef(c.oid) = 'UNIQUE (tenant_id, user_id, token)'
  ) then
    alter table public.push_tokens
      add constraint push_tokens_tenant_user_token_key
      unique (tenant_id, user_id, token);
  end if;
end $$;

create index if not exists push_tokens_tenant_idx on public.push_tokens (tenant_id);

create table if not exists public.push_tickets (
  id              uuid primary key default gen_random_uuid(),
  expo_ticket_id  text not null unique,
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  user_id         text not null,
  token           text not null,
  sent_at         timestamptz not null default now(),
  next_check_at   timestamptz not null,
  expires_at      timestamptz not null,
  checked_at      timestamptz,
  receipt_status  text check (receipt_status is null or receipt_status in ('ok', 'error', 'expired')),
  receipt_error   text,
  receipt_message text,
  created_at      timestamptz not null default now()
);

create index if not exists push_tickets_due_idx
  on public.push_tickets (next_check_at) where checked_at is null;

-- Durable business-event outbox. event_key is stable across the dialog-first
-- and later intake paths, so only one of them can own a new-lead notification.
create table if not exists public.push_events (
  id                uuid primary key default gen_random_uuid(),
  event_key         text not null unique,
  tenant_id         uuid not null references public.tenants(id) on delete cascade,
  title             text not null,
  body              text not null,
  url               text not null,
  next_attempt_at   timestamptz not null default now(),
  claimed_at        timestamptz,
  claim_expires_at  timestamptz,
  claim_token       uuid,
  sent_at           timestamptz,
  last_error        text,
  created_at        timestamptz not null default now()
);

create index if not exists push_events_due_idx
  on public.push_events (next_attempt_at)
  where sent_at is null;

create or replace function public.claim_push_event(
  p_event_id uuid,
  p_claim_token uuid,
  p_now timestamptz
) returns boolean
language plpgsql
as $$
declare
  claimed boolean;
begin
  update public.push_events
  set claimed_at = p_now,
      claim_expires_at = p_now + interval '5 minutes',
      claim_token = p_claim_token,
      last_error = null
  where id = p_event_id
    and sent_at is null
    and (claim_expires_at is null or claim_expires_at <= p_now)
  returning true into claimed;
  return coalesce(claimed, false);
end;
$$;

create or replace function public.complete_push_event(
  p_event_id uuid,
  p_claim_token uuid,
  p_sent_at timestamptz
) returns boolean
language plpgsql
as $$
declare
  completed boolean;
begin
  update public.push_events
  set sent_at = p_sent_at,
      claimed_at = null,
      claim_expires_at = null,
      claim_token = null,
      last_error = null
  where id = p_event_id
    and sent_at is null
    and claim_token = p_claim_token
  returning true into completed;
  return coalesce(completed, false);
end;
$$;

create or replace function public.release_push_event(
  p_event_id uuid,
  p_claim_token uuid,
  p_error text,
  p_next_attempt_at timestamptz
) returns boolean
language plpgsql
as $$
declare
  released boolean;
begin
  update public.push_events
  set next_attempt_at = p_next_attempt_at,
      claimed_at = null,
      claim_expires_at = null,
      claim_token = null,
      last_error = left(p_error, 500)
  where id = p_event_id
    and sent_at is null
    and claim_token = p_claim_token
  returning true into released;
  return coalesce(released, false);
end;
$$;

revoke all on function public.claim_push_event(uuid, uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.complete_push_event(uuid, uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.release_push_event(uuid, uuid, text, timestamptz) from public, anon, authenticated;
grant execute on function public.claim_push_event(uuid, uuid, timestamptz) to service_role;
grant execute on function public.complete_push_event(uuid, uuid, timestamptz) to service_role;
grant execute on function public.release_push_event(uuid, uuid, text, timestamptz) to service_role;

-- Retain the original marker for rows created during the first Task 01 rollout.
-- New dialog-first leads dedupe through push_events.event_key instead.
alter table public.sms_conversations
  add column if not exists lead_push_sent_at timestamptz;

alter table public.push_tokens enable row level security;
alter table public.push_tickets enable row level security;
alter table public.push_events enable row level security;

notify pgrst, 'reload schema';

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'push_tokens'
      and column_name = 'user_id' and is_nullable = 'NO'
  ) then
    raise exception 'migration 191 failed: push_tokens.user_id must be non-null';
  end if;
  if not exists (
    select 1
    from pg_constraint c
    where c.conrelid = 'public.push_tokens'::regclass
      and c.contype = 'u'
      and pg_get_constraintdef(c.oid) = 'UNIQUE (tenant_id, user_id, token)'
  ) then
    raise exception 'migration 191 failed: push_tokens unique key must be (tenant_id, user_id, token)';
  end if;
  if not exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'push_tickets'
  ) then
    raise exception 'migration 191 failed: push_tickets missing';
  end if;
  if not exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'push_events'
  ) then
    raise exception 'migration 191 failed: push_events missing';
  end if;
  raise notice 'migration 191: seat-scoped tokens and delayed receipts ready';
end $$;
