-- ═══════════════════════════════════════════════════════════════════════
-- 186 — Phase 4 R7/R8 on the SHARED recipe table.
--
-- 185 added include_when / quantity_per / catalogue_id to
-- tenant_assembly_bom. This adds the first two to shared_assembly_bom.
--
-- WHY IT IS A SEPARATE MIGRATION: 185 is already applied to production.
-- Editing an applied migration makes the file disagree with the database,
-- so the follow-up gets its own number.
--
-- WHY SHARED NEEDS THEM. R9's acceptance scenarios are "a smart product adds
-- its dimmer part" and "an integrated_driver product drops the separate
-- driver line". Those are properties of how a DOWNLIGHT JOB works, not of one
-- tradie's preferences, so they belong on the shared recipe every tenant
-- falls back to. Tenant-only columns would mean the behaviour exists solely
-- for tenants who have customised their recipe, which is the minority.
--
-- WHY catalogue_id IS NOT HERE. It references tenant_material_catalogue. A
-- shared row is tenant-agnostic and cannot point at one tenant's product;
-- the pin is a per-tenant idea and stays on the tenant table.
--
-- Both columns nullable, NULL = behave exactly as today, so this changes no
-- price on its own.
-- ═══════════════════════════════════════════════════════════════════════

alter table shared_assembly_bom
  add column if not exists include_when jsonb,
  add column if not exists quantity_per numeric(10,2);

alter table shared_assembly_bom
  drop constraint if exists shared_assembly_bom_quantity_per_positive;
alter table shared_assembly_bom
  add constraint shared_assembly_bom_quantity_per_positive
  check (quantity_per is null or quantity_per > 0);

alter table shared_assembly_bom
  drop constraint if exists shared_assembly_bom_include_when_object;
alter table shared_assembly_bom
  add constraint shared_assembly_bom_include_when_object
  check (include_when is null or jsonb_typeof(include_when) = 'object');

comment on column shared_assembly_bom.include_when is
  'Phase 4 R7 — condition on the resolved product''s attributes. NULL = always include. Include-on-unknown for required lines.';
comment on column shared_assembly_bom.quantity_per is
  'Phase 4 R8 — ratio denominator; quantity becomes ceil(item_count / quantity_per). NULL = use quantity as-is.';

notify pgrst, 'reload schema';
