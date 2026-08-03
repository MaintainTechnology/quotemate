-- Rollback for 185 — Phase 4 R7 / R8 / R11 BOM columns.
--
-- ⚠ DESTRUCTIVE. Dropping these columns discards every condition, ratio and
-- product pin a tradie has set on their recipe lines. There is no backup
-- table: the columns are nullable additions, so a forward re-apply restores
-- the SCHEMA but not the DATA. Take a copy first if any row is non-null:
--
--   create table tenant_assembly_bom_backup_mig185 as
--     select id, include_when, quantity_per, catalogue_id
--       from tenant_assembly_bom
--      where include_when is not null
--         or quantity_per is not null
--         or catalogue_id is not null;

alter table tenant_assembly_bom
  drop constraint if exists tenant_assembly_bom_quantity_per_positive;
alter table tenant_assembly_bom
  drop constraint if exists tenant_assembly_bom_include_when_object;

drop index if exists tenant_assembly_bom_catalogue_idx;

alter table tenant_assembly_bom
  drop column if exists include_when,
  drop column if exists quantity_per,
  drop column if exists catalogue_id;

notify pgrst, 'reload schema';
