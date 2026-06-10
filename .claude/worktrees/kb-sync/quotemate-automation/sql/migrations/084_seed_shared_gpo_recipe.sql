-- QuoteMate · migration 084 — seed the shared baseline recipe for
-- "Replace double GPO" (deterministic-pricing pilot).
--
-- WHY: lib/estimate/run.ts loadDeterministicInputs now falls back to
-- shared_assembly_bom when a tenant hasn't authored their own recipe
-- (mirroring buildBomHint). This row gives EVERY tenant a fixed,
-- structured recipe for "Replace double GPO" — 1 × gpo — so the job
-- quotes the same part every time, priced from each tenant's own
-- tier-hinted catalogue (shared_materials.gpo is the universal floor).
--
-- SAFE: additive single row. Inert in prod until the loadDeterministicInputs
-- fallback is DEPLOYED — current prod code ignores shared_assembly_bom in the
-- deterministic path, so this row is simply not read until then. The
-- grounding validator + min-labour floor still run on the deterministic
-- output, so a drifted line self-corrects to the $99 inspection.
--
-- VOCAB: category 'gpo' is the grounding vocab used by BOTH
-- tenant_material_catalogue.category and shared_materials.category for this
-- category, so chooseMaterial() resolves it for all three tenants (verified
-- read-only via scripts/dry-run-gpo-determinism.mjs before applying).
--
-- Idempotent via the not-exists guard (the table's unique index on
-- (assembly_id, lower(material_category), lower(coalesce(description,'')))
-- also protects against duplicates).

insert into shared_assembly_bom (assembly_id, trade, material_category, quantity, required, sort)
select a.id, 'electrical', 'gpo', 1, true, 1
from shared_assemblies a
where a.trade = 'electrical'
  and a.name = 'Replace double GPO'
  and not exists (
    select 1 from shared_assembly_bom b
    where b.assembly_id = a.id
      and lower(b.material_category) = 'gpo'
  );
