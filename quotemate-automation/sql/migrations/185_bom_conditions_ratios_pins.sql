-- ═══════════════════════════════════════════════════════════════════════
-- 185 — Phase 4 R7 / R8 / R11: a recipe line can be conditional, scaled by
--       a ratio, and pinned to an exact product.
--
-- ONE migration for three spec items on purpose. All three add a nullable
-- column to the same table, all three are read by the same function
-- (buildBomQuoteLines), and splitting them into 185/186/187 would mean three
-- runners and three prod applications for what is a single ALTER.
--
-- Every column is NULLABLE with NULL meaning "behave exactly as today", so
-- this migration changes no price on its own. It is the schema for R7/R8/R11;
-- the code that reads it lands separately.
--
--   include_when  jsonb  R7 — condition evaluated against the RESOLVED
--                        product's attributes. NULL = always include.
--                        Include-on-unknown is enforced in code, not here:
--                        a missing attribute must never silently drop a
--                        required part from a quote.
--
--   quantity_per  numeric R8 — ratio denominator. "one driver per four
--                        lights" is quantity_per = 4, and the line's
--                        quantity becomes ceil(item_count / 4). NULL = use
--                        `quantity` as-is, today's behaviour.
--
--   catalogue_id  uuid   R11 — pin this line to one exact product from the
--                        tenant's own catalogue, editable from the Recipes
--                        line editor.
--
-- R12 fixes the precedence for the pin: tier-ladder hit BEATS it, because the
-- ladder is explicitly per-tier while a pin is not — a tier-agnostic pin
-- would otherwise flatten all three tiers onto one product.
--
-- ON DELETE SET NULL for catalogue_id, deliberately NOT cascade. Deleting a
-- product must not delete the recipe LINE — the job still needs a part in
-- that category, it just falls back to normal resolution. Cascade here would
-- silently remove a required part from every future quote for that job.
-- (tenant_tier_ladder uses cascade because there the row IS the pin; here the
-- pin is one optional attribute of a line that stands on its own.)
-- ═══════════════════════════════════════════════════════════════════════

alter table tenant_assembly_bom
  add column if not exists include_when jsonb,
  add column if not exists quantity_per numeric(10,2),
  add column if not exists catalogue_id uuid
    references tenant_material_catalogue(id) on delete set null;

-- A ratio of zero or below would divide a quantity into nonsense. Left
-- nullable; only a stated value is constrained.
alter table tenant_assembly_bom
  drop constraint if exists tenant_assembly_bom_quantity_per_positive;
alter table tenant_assembly_bom
  add constraint tenant_assembly_bom_quantity_per_positive
  check (quantity_per is null or quantity_per > 0);

-- include_when must be a JSON OBJECT when set. A bare string or array would
-- pass jsonb typing and then silently fail every evaluation, which reads as
-- "the part vanished" rather than "the condition is malformed".
alter table tenant_assembly_bom
  drop constraint if exists tenant_assembly_bom_include_when_object;
alter table tenant_assembly_bom
  add constraint tenant_assembly_bom_include_when_object
  check (include_when is null or jsonb_typeof(include_when) = 'object');

-- Supports the R11 lookup and keeps the FK's delete-time scan off a seq scan.
create index if not exists tenant_assembly_bom_catalogue_idx
  on tenant_assembly_bom (catalogue_id)
  where catalogue_id is not null;

comment on column tenant_assembly_bom.include_when is
  'Phase 4 R7 — condition on the resolved product''s attributes. NULL = always include. Include-on-unknown.';
comment on column tenant_assembly_bom.quantity_per is
  'Phase 4 R8 — ratio denominator; quantity becomes ceil(item_count / quantity_per). NULL = use quantity as-is.';
comment on column tenant_assembly_bom.catalogue_id is
  'Phase 4 R11 — pin this line to one tenant_material_catalogue product. Tier-ladder hits still win (R12).';

notify pgrst, 'reload schema';
