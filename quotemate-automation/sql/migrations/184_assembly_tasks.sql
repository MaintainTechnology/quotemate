-- ════════════════════════════════════════════════════════════════════
-- Migration 184 — an ordered task checklist per job (Phase 3).
--
-- Until now there was no task, step or checklist table anywhere in the
-- schema: the "task list" for a job was one free-text
-- shared_assemblies.description plus a single default_labour_hours
-- scalar. A tradie could see WHAT parts a job needs (the BOM tables) but
-- never WHAT STEPS it involves.
--
-- Mirrors the BOM pair exactly:
--   shared_assembly_tasks  ← the global baseline  (like 028's shared_assembly_bom)
--   tenant_assembly_tasks  ← the tradie's own copy (like 031's tenant_assembly_bom)
--
-- WHY a separate tenant table rather than a nullable tenant_id: migration
-- 028's header states the rule — tenant-owned data lives in a physically
-- separate table so a bug or a rogue tradie can never leak rows into
-- another tradie's job. Same reasoning, same shape.
--
-- NO HOURS PER TASK. Settled decision: default_labour_hours on
-- shared_assemblies stays the single source of labour. Adding an hours
-- column later is additive and does not need this table reshaped.
--
-- The estimator does NOT read these tables. Tasks carry no price and no
-- hours, so they are scope-of-works data for the quote document and the
-- tradie's own reference. buildBomHint and the deterministic builder are
-- untouched.
--
-- Idempotent. NOT auto-applied to prod — apply with:
--   node --env-file=.env.local scripts/run-migration-184.mjs --apply
-- ════════════════════════════════════════════════════════════════════

-- ── The global baseline. Read-only from the dashboard; curated at the
--    platform level, exactly like shared_assembly_bom. No updated_at and
--    no trigger, mirroring 028.
create table if not exists shared_assembly_tasks (
  id uuid primary key default gen_random_uuid(),
  assembly_id uuid not null references shared_assemblies(id) on delete cascade,
  trade text not null check (trade in ('electrical', 'plumbing')),

  -- The step itself, e.g. 'Isolate the circuit and prove dead'.
  title text not null,
  -- Optional detail the tradie wants on the quote or in the van.
  notes text,
  -- Required steps always appear; optional ones are scope-dependent, the
  -- same semantics as a BOM line's `required`.
  required boolean not null default true,
  sort int not null default 0,

  created_at timestamptz not null default now()
);

create unique index if not exists shared_assembly_tasks_unique
  on shared_assembly_tasks (assembly_id, lower(title));

create index if not exists shared_assembly_tasks_assembly_idx
  on shared_assembly_tasks (assembly_id);

-- ── The tradie's own checklist. Wins over the baseline when present, the
--    same precedence buildBomHint already applies to the BOM tables.
create table if not exists tenant_assembly_tasks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  assembly_id uuid not null references shared_assemblies(id) on delete cascade,
  trade text not null check (trade in ('electrical', 'plumbing')),

  title text not null,
  notes text,
  required boolean not null default true,
  sort int not null default 0,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists tenant_assembly_tasks_unique
  on tenant_assembly_tasks (tenant_id, assembly_id, lower(title));

create index if not exists tenant_assembly_tasks_lookup_idx
  on tenant_assembly_tasks (tenant_id, assembly_id);

create or replace function tenant_assembly_tasks_set_updated_at()
returns trigger as $$
begin
  new.updated_at := now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists tenant_assembly_tasks_set_updated_at on tenant_assembly_tasks;
create trigger tenant_assembly_tasks_set_updated_at
  before update on tenant_assembly_tasks
  for each row
  execute function tenant_assembly_tasks_set_updated_at();

-- ── RLS, matching the pair these tables mirror ──────────────────────────
-- shared_assembly_bom and tenant_assembly_bom are both RLS-on, and every
-- table-creating migration since 144 enables it in the same file (144, 150,
-- 152, 158, 172). Without this the two new tables would be the only
-- tenant-scoped feature tables in `public` with RLS off — the documented
-- exemption list is backup/staging tables only.
--
-- No positive policies: routes read and write with the service-role key,
-- which bypasses RLS, so anon/authenticated see zero rows. Tenant-scoped
-- positive policies are RLS Phase 2 and deferred repo-wide.
--
-- Idempotent — `enable row level security` is a no-op when already on, so
-- this file stays safe to re-run over an already-applied 184.
alter table public.shared_assembly_tasks enable row level security;
alter table public.tenant_assembly_tasks enable row level security;

comment on table public.shared_assembly_tasks is
  'Shared baseline step checklist per job. Read-only to tradies; forked into tenant_assembly_tasks to edit.';
comment on table public.tenant_assembly_tasks is
  'Tenant-owned step checklist per job. Scope-of-works only — carries no price and no hours.';

notify pgrst, 'reload schema';
