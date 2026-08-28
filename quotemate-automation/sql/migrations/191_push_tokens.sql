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
  obsolete_unique record;
begin
  -- Inspect the index catalogue rather than rendered DDL. A legacy rollout may
  -- have used a constraint or a standalone unique index, an arbitrary name, or
  -- either column order. All enforce the same obsolete tenant+token key.
  for obsolete_unique in
    select index_class.relname as index_name,
           unique_constraint.conname as constraint_name,
           indexed_columns.columns
    from pg_index index_definition
    join pg_class index_class on index_class.oid = index_definition.indexrelid
    left join pg_constraint unique_constraint
      on unique_constraint.conindid = index_definition.indexrelid
     and unique_constraint.contype = 'u'
    cross join lateral (
      select array_agg(attribute.attname order by indexed.ordinality) as columns,
             array_agg(attribute.attname order by attribute.attname) as sorted_columns
      from unnest(index_definition.indkey::smallint[]) with ordinality
        as indexed(attnum, ordinality)
      join pg_attribute attribute
        on attribute.attrelid = index_definition.indrelid
       and attribute.attnum = indexed.attnum
      where indexed.ordinality <= index_definition.indnkeyatts
    ) indexed_columns
    where index_definition.indrelid = 'public.push_tokens'::regclass
      and index_definition.indisunique
      and not index_definition.indisprimary
      and index_definition.indpred is null
      and index_definition.indexprs is null
      and (
        indexed_columns.sorted_columns = array['tenant_id', 'token']::name[]
        or indexed_columns.sorted_columns = array['tenant_id', 'token', 'user_id']::name[]
      )
      and not (
        unique_constraint.conname is not null
        and indexed_columns.columns = array['tenant_id', 'user_id', 'token']::name[]
      )
  loop
    if obsolete_unique.constraint_name is not null then
      execute format(
        'alter table public.push_tokens drop constraint %I',
        obsolete_unique.constraint_name
      );
    else
      execute format('drop index public.%I', obsolete_unique.index_name);
    end if;
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
  fanout_started_at timestamptz,
  created_at        timestamptz not null default now()
);

alter table public.push_events
  add column if not exists fanout_started_at timestamptz;

-- One durable row per intended recipient. An event retry reads only pending
-- rows, so a later transient batch cannot make an already-ticketed batch send
-- again. Identity is snapshotted because push_tokens may later be pruned.
create table if not exists public.push_event_deliveries (
  id              uuid primary key default gen_random_uuid(),
  event_id        uuid not null references public.push_events(id) on delete cascade,
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  user_id         text not null,
  token           text not null,
  status          text not null default 'pending'
                    check (status in ('pending', 'ticketed', 'device_not_registered', 'terminal_error')),
  expo_ticket_id  text,
  terminal_error  text,
  terminal_message text,
  terminal_at     timestamptz,
  created_at      timestamptz not null default now(),
  unique (event_id, user_id, token)
);

create index if not exists push_event_deliveries_pending_idx
  on public.push_event_deliveries (event_id, id)
  where status = 'pending';

create index if not exists push_events_due_idx
  on public.push_events (next_attempt_at)
  where sent_at is null;

create or replace function public.initialise_push_event_deliveries(
  p_event_id uuid,
  p_now timestamptz
) returns boolean
language plpgsql
as $$
declare
  event_row record;
begin
  select id, tenant_id, sent_at, fanout_started_at
  into event_row
  from public.push_events
  where id = p_event_id
  for update;

  if not found or event_row.sent_at is not null then
    return false;
  end if;

  if event_row.fanout_started_at is null then
    insert into public.push_event_deliveries (event_id, tenant_id, user_id, token)
    select event_row.id, event_row.tenant_id, token_row.user_id, token_row.token
    from public.push_tokens token_row
    where token_row.tenant_id = event_row.tenant_id
    on conflict (event_id, user_id, token) do nothing;

    update public.push_events
    set fanout_started_at = p_now
    where id = event_row.id;
  end if;

  return true;
end;
$$;

-- Atomically persist every accepted ticket (including exact receipt identity)
-- and terminalise its matching delivery. If any insert/update fails, the RPC
-- transaction rolls back and the entire batch remains pending for retry.
create or replace function public.record_push_delivery_results(
  p_event_id uuid,
  p_results jsonb,
  p_sent_at timestamptz,
  p_next_check_at timestamptz,
  p_expires_at timestamptz
) returns boolean
language plpgsql
as $$
declare
  result_row jsonb;
  delivery_row public.push_event_deliveries%rowtype;
  outcome text;
  ticket_id text;
begin
  if jsonb_typeof(p_results) <> 'array' then
    raise exception 'push delivery results must be an array';
  end if;

  for result_row in select value from jsonb_array_elements(p_results)
  loop
    select * into delivery_row
    from public.push_event_deliveries
    where id = (result_row ->> 'delivery_id')::uuid
      and event_id = p_event_id
      and status = 'pending'
    for update;

    if not found then
      raise exception 'pending push delivery not found';
    end if;

    outcome := result_row ->> 'outcome';
    if outcome = 'ticket' then
      ticket_id := nullif(result_row ->> 'expo_ticket_id', '');
      if ticket_id is null then
        raise exception 'accepted push delivery is missing its Expo ticket id';
      end if;

      insert into public.push_tickets (
        expo_ticket_id, tenant_id, user_id, token,
        sent_at, next_check_at, expires_at
      ) values (
        ticket_id, delivery_row.tenant_id, delivery_row.user_id, delivery_row.token,
        p_sent_at, p_next_check_at, p_expires_at
      )
      on conflict (expo_ticket_id) do nothing;

      if not exists (
        select 1 from public.push_tickets ticket
        where ticket.expo_ticket_id = ticket_id
          and ticket.tenant_id = delivery_row.tenant_id
          and ticket.user_id = delivery_row.user_id
          and ticket.token = delivery_row.token
      ) then
        raise exception 'Expo ticket id is already mapped to another recipient';
      end if;

      update public.push_event_deliveries
      set status = 'ticketed', expo_ticket_id = ticket_id, terminal_at = p_sent_at
      where id = delivery_row.id;
    elsif outcome = 'device_not_registered' then
      delete from public.push_tokens
      where tenant_id = delivery_row.tenant_id
        and user_id = delivery_row.user_id
        and token = delivery_row.token;

      update public.push_event_deliveries
      set status = 'device_not_registered',
          terminal_error = 'DeviceNotRegistered',
          terminal_at = p_sent_at
      where id = delivery_row.id;
    elsif outcome = 'terminal_error' then
      update public.push_event_deliveries
      set status = 'terminal_error',
          terminal_error = left(result_row ->> 'error', 200),
          terminal_message = left(result_row ->> 'message', 500),
          terminal_at = p_sent_at
      where id = delivery_row.id;
    else
      raise exception 'unsupported push delivery outcome';
    end if;
  end loop;

  return true;
end;
$$;

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
revoke all on function public.initialise_push_event_deliveries(uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.record_push_delivery_results(uuid, jsonb, timestamptz, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.claim_push_event(uuid, uuid, timestamptz) to service_role;
grant execute on function public.complete_push_event(uuid, uuid, timestamptz) to service_role;
grant execute on function public.release_push_event(uuid, uuid, text, timestamptz) to service_role;
grant execute on function public.initialise_push_event_deliveries(uuid, timestamptz) to service_role;
grant execute on function public.record_push_delivery_results(uuid, jsonb, timestamptz, timestamptz, timestamptz) to service_role;

-- Retain the original marker for rows created during the first Task 01 rollout.
-- New dialog-first leads dedupe through push_events.event_key instead.
alter table public.sms_conversations
  add column if not exists lead_push_sent_at timestamptz;

alter table public.push_tokens enable row level security;
alter table public.push_tickets enable row level security;
alter table public.push_events enable row level security;
alter table public.push_event_deliveries enable row level security;

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
  if not exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'push_event_deliveries'
  ) then
    raise exception 'migration 191 failed: push_event_deliveries missing';
  end if;
  raise notice 'migration 191: seat-scoped tokens and delayed receipts ready';
end $$;
