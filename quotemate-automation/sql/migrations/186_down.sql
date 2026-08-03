-- Rollback for 186 — shared_assembly_bom R7/R8 columns.
--
-- DESTRUCTIVE: discards every condition and ratio seeded on the shared
-- recipes. Back up first if any row is non-null:
--   create table shared_assembly_bom_backup_mig186 as
--     select id, include_when, quantity_per from shared_assembly_bom
--      where include_when is not null or quantity_per is not null;

alter table shared_assembly_bom
  drop constraint if exists shared_assembly_bom_quantity_per_positive;
alter table shared_assembly_bom
  drop constraint if exists shared_assembly_bom_include_when_object;

alter table shared_assembly_bom
  drop column if exists include_when,
  drop column if exists quantity_per;

notify pgrst, 'reload schema';
