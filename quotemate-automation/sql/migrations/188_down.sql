-- Rollback for 188 — task conditions.
--
-- DESTRUCTIVE: discards every condition set on a task. Back up first if any row
-- is non-null:
--   create table shared_assembly_tasks_backup_mig188 as
--     select id, include_when from shared_assembly_tasks where include_when is not null;
--   create table tenant_assembly_tasks_backup_mig188 as
--     select id, include_when from tenant_assembly_tasks where include_when is not null;

alter table shared_assembly_tasks
  drop constraint if exists shared_assembly_tasks_include_when_object;
alter table tenant_assembly_tasks
  drop constraint if exists tenant_assembly_tasks_include_when_object;

alter table shared_assembly_tasks drop column if exists include_when;
alter table tenant_assembly_tasks drop column if exists include_when;

notify pgrst, 'reload schema';
