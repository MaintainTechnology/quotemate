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
  last_seen_at  timestamptz not null default now(),
  unique (tenant_id, user_id, token)
);

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

-- Dialog-first leads notify before an intake exists. The later intake route
-- reads this marker to avoid a second push for the same business event.
alter table public.sms_conversations
  add column if not exists lead_push_sent_at timestamptz;

alter table public.push_tokens enable row level security;
alter table public.push_tickets enable row level security;

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
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'push_tickets'
  ) then
    raise exception 'migration 191 failed: push_tickets missing';
  end if;
  raise notice 'migration 191: seat-scoped tokens and delayed receipts ready';
end $$;
