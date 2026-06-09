-- Migration 098 · kb_sync_state + dirty-tracking triggers on all public tables
-- Drives the DB→MT-QM-PRICING-KB CSV sync. Additive + idempotent.
-- Highest existing migration before this is 097.
-- (Originally authored as 096; renumbered to 098 because 096_signage_two_stage
--  and 097_aircon_trade_phase1 landed on main first. Already applied to prod
--  under the old number; the SQL is idempotent so the number is just bookkeeping.)

create table if not exists public.kb_sync_state (
  table_name       text primary key,
  dirty            boolean not null default true,
  bumped_at        timestamptz not null default now(),
  content_hash     text,
  kb_document_name text,
  last_synced_at   timestamptz,
  last_error       text,
  row_count        integer
);

-- One generic statement-level trigger fn: marks the touched table dirty.
create or replace function public.mark_kb_table_dirty()
returns trigger
language plpgsql
as $$
begin
  insert into public.kb_sync_state (table_name, dirty, bumped_at)
  values (tg_table_name, true, now())
  on conflict (table_name) do update
    set dirty = true, bumped_at = now();
  return null;
end;
$$;

-- Attach to every base table in public (except our own bookkeeping table
-- and PostGIS's spatial_ref_sys if present). Idempotent: drop-if-exists first.
do $$
declare r record;
begin
  for r in
    select c.relname
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r'
       and c.relname not in ('kb_sync_state', 'spatial_ref_sys')
  loop
    execute format('drop trigger if exists kb_sync_dirty on public.%I', r.relname);
    execute format(
      'create trigger kb_sync_dirty after insert or update or delete on public.%I '
      || 'for each statement execute function public.mark_kb_table_dirty()',
      r.relname);
    insert into public.kb_sync_state (table_name, dirty, bumped_at)
    values (r.relname, true, now())
    on conflict (table_name) do nothing;
  end loop;
end $$;

notify pgrst, 'reload schema';

do $$
declare cnt int;
begin
  select count(*) into cnt from public.kb_sync_state;
  raise notice 'Migration 096: kb_sync_state seeded with % table(s)', cnt;
end $$;
