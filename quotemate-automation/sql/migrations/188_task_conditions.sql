-- ═══════════════════════════════════════════════════════════════════════
-- 188 — Phase 4 R9, the task half: a step can depend on the product.
--
-- Migration 184 created shared_assembly_tasks and tenant_assembly_tasks, gave
-- them a CRUD API and a dashboard panel, and stopped there. Neither table has a
-- condition column, so R9's second acceptance scenario — "a smart product adds
-- its dimmer part AND its pairing task" — is unexpressible: the part half
-- landed in 185/186, the task half had nowhere to go.
--
-- Same column, same semantics, same evaluator as the BOM side (R7): the
-- condition is judged against the attributes of the product that actually
-- landed on the tier, and shouldIncludeLine's unknown rule applies unchanged —
-- a REQUIRED step survives an unevaluable condition, an optional one does not.
-- One rule for parts and steps rather than two that drift.
--
-- Nullable, NULL = always include, so this changes nothing on its own. Both
-- tables are empty today (0 rows each), so there is no backfill to consider.
--
-- No quantity_per and no catalogue_id here, deliberately. A step is not a
-- quantity — "isolate the circuit and prove dead" happens once whether there
-- are 6 downlights or 10 — and a step cannot be pinned to a product.
-- ═══════════════════════════════════════════════════════════════════════

alter table shared_assembly_tasks
  add column if not exists include_when jsonb;
alter table tenant_assembly_tasks
  add column if not exists include_when jsonb;

-- A bare string or array would pass jsonb typing and then silently fail every
-- evaluation, which reads as "the step vanished" rather than "the condition is
-- malformed". Same guard as 185/186 on the BOM side.
alter table shared_assembly_tasks
  drop constraint if exists shared_assembly_tasks_include_when_object;
alter table shared_assembly_tasks
  add constraint shared_assembly_tasks_include_when_object
  check (include_when is null or jsonb_typeof(include_when) = 'object');

alter table tenant_assembly_tasks
  drop constraint if exists tenant_assembly_tasks_include_when_object;
alter table tenant_assembly_tasks
  add constraint tenant_assembly_tasks_include_when_object
  check (include_when is null or jsonb_typeof(include_when) = 'object');

comment on column shared_assembly_tasks.include_when is
  'Phase 4 R9 — condition on the resolved product''s attributes. NULL = always include. Include-on-unknown for required steps, same evaluator as the BOM side.';
comment on column tenant_assembly_tasks.include_when is
  'Phase 4 R9 — condition on the resolved product''s attributes. NULL = always include. Include-on-unknown for required steps, same evaluator as the BOM side.';

notify pgrst, 'reload schema';
