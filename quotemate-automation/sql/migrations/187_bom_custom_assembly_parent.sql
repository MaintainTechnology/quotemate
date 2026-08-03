-- ═══════════════════════════════════════════════════════════════════════
-- 187 — Phase 7: a recipe line can hang off a tenant's OWN assembly.
--
-- tenant_assembly_bom.assembly_id references shared_assemblies and is NOT
-- NULL, so a recipe can only ever describe a job from the shared library. A
-- tradie who creates their own service in tenant_custom_assemblies cannot give
-- it a recipe at all — the deterministic pricer has nothing to build from, so
-- their own jobs silently fall back to an Opus draft while the shared ones get
-- deterministic pricing.
--
-- THREE CHANGES, and the order matters:
--   1. add custom_assembly_id
--   2. drop NOT NULL from assembly_id  (a custom-parented row has none)
--   3. CHECK exactly one parent is set
--
-- Step 2 is the one to think about. Dropping NOT NULL widens what the table
-- accepts, so the CHECK in step 3 is not decoration — without it the column
-- would allow a row with NO parent at all, which is an orphan the estimator
-- would never find and nobody would ever see.
--
-- Safe on the current data: all 5 existing rows have assembly_id set and
-- custom_assembly_id NULL, which satisfies "exactly one" by construction. The
-- CHECK is added NOT VALID first and then validated, so the table is not
-- rewritten under a lock — habit, not necessity, at 5 rows.
--
-- ON DELETE CASCADE for the new parent, unlike catalogue_id in migration 185.
-- The distinction is real: a deleted PRODUCT leaves a recipe line that still
-- needs a part in that category, so 185 uses SET NULL. A deleted ASSEMBLY means
-- the job itself is gone, and its recipe lines describe nothing. Keeping them
-- would leave rows that can never be reached or repaired.
-- ═══════════════════════════════════════════════════════════════════════

alter table tenant_assembly_bom
  add column if not exists custom_assembly_id uuid
    references tenant_custom_assemblies(id) on delete cascade;

alter table tenant_assembly_bom
  alter column assembly_id drop not null;

alter table tenant_assembly_bom
  drop constraint if exists tenant_assembly_bom_one_parent;
alter table tenant_assembly_bom
  add constraint tenant_assembly_bom_one_parent
  check (
    (assembly_id is not null and custom_assembly_id is null)
    or (assembly_id is null and custom_assembly_id is not null)
  ) not valid;
alter table tenant_assembly_bom
  validate constraint tenant_assembly_bom_one_parent;

create index if not exists tenant_assembly_bom_custom_assembly_idx
  on tenant_assembly_bom (custom_assembly_id)
  where custom_assembly_id is not null;

comment on column tenant_assembly_bom.custom_assembly_id is
  'Phase 7 — parent when this recipe line belongs to a tenant_custom_assemblies job rather than a shared one. Exactly one of assembly_id / custom_assembly_id is set (tenant_assembly_bom_one_parent).';
comment on column tenant_assembly_bom.assembly_id is
  'Parent shared_assemblies job. NULL when the line belongs to a tenant_custom_assemblies job instead (Phase 7, migration 187).';

notify pgrst, 'reload schema';
