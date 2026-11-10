-- 226: the takeoff start ledger (TKO-28, DEC-038).
--
-- The hourly limit (TAKEOFF_RUNS_PER_HOUR) counted the starts stamped in each
-- run's usage.starts, so a deleted run took its starts with it, and a tenant
-- could start runs, delete them and start more past the limit. Each start is
-- now a row here, with no foreign key to its run, so it outlives the run.
--
-- A row holds a tenant, a run id and a time, nothing personal, and rows are
-- kept: they also count a tenant's runs for D-02's per-run price.

create table if not exists public.roof_takeoff_starts (
  id          bigint generated always as identity primary key,
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  run_id      uuid not null,  -- no foreign key: a start outlives its run
  started_at  timestamptz not null default now()
);

create index if not exists roof_takeoff_starts_tenant_time
  on public.roof_takeoff_starts (tenant_id, started_at desc);

-- The service role writes and reads it, and no one else.
alter table public.roof_takeoff_starts enable row level security;

-- Every start the runs still hold, once.
insert into public.roof_takeoff_starts (tenant_id, run_id, started_at)
select r.tenant_id, r.id, s.started_at::timestamptz
  from public.roof_takeoff_runs r
 cross join lateral jsonb_array_elements_text(coalesce(r.usage -> 'starts', '[]'::jsonb)) as s(started_at)
 where not exists (
   select 1 from public.roof_takeoff_starts x
    where x.run_id = r.id and x.started_at = s.started_at::timestamptz
 );
