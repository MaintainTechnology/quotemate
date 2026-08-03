-- Rollback for 187 — Phase 7 custom-assembly parent.
--
-- ⚠ DESTRUCTIVE, and asymmetric with the forward migration. Dropping
-- custom_assembly_id discards every recipe line a tradie wrote for their OWN
-- job, and restoring NOT NULL on assembly_id is impossible while such rows
-- exist. So this DELETES them, and that has to be a conscious act:
--
--   select count(*) from tenant_assembly_bom where assembly_id is null;
--
-- If that is non-zero, back the rows up before rolling back:
--   create table tenant_assembly_bom_backup_mig187 as
--     select * from tenant_assembly_bom where assembly_id is null;
--
-- Order matters here too: the CHECK has to go before the delete, or a partially
-- rolled-back table can violate it mid-transaction.

alter table tenant_assembly_bom
  drop constraint if exists tenant_assembly_bom_one_parent;

drop index if exists tenant_assembly_bom_custom_assembly_idx;

-- Custom-parented lines cannot survive: assembly_id is about to be NOT NULL
-- again and they have none.
delete from tenant_assembly_bom where assembly_id is null;

alter table tenant_assembly_bom
  drop column if exists custom_assembly_id;

alter table tenant_assembly_bom
  alter column assembly_id set not null;

notify pgrst, 'reload schema';
