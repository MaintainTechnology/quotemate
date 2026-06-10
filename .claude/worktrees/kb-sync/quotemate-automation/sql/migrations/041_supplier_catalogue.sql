-- ════════════════════════════════════════════════════════════════════
-- Migration 041 — supplier_catalogue (v7 Phase 2a · keystone schema)
--
-- The new master library tradies browse-and-tick from. Distinct from
-- the existing two material tables:
--
--   shared_materials             — generic fallback library (37 rows).
--                                  "What does a tenant with NO catalogue get?"
--                                  Used by chooseMaterial() when neither
--                                  tenant rows nor a catalogue link matches.
--   tenant_material_catalogue    — operator-owned (per-tenant). Their
--                                  real stocked SKUs, with their real prices.
--   supplier_catalogue (NEW)     — vendor SKU library (hand-curated by us).
--                                  Read-only to tradies — they BROWSE this
--                                  and add rows into tenant_material_catalogue
--                                  with their own price. The link is the
--                                  supplier_catalogue_id column added in
--                                  migration 042.
--
-- The grounding validator NEVER reads supplier_catalogue directly — money
-- flows only through tenant_material_catalogue and shared_materials. So
-- this table is money-path-adjacent (catalogue rows reference it) but
-- NOT money-path itself. Adding it cannot regress a live quote on its own.
--
-- Idempotent: create table if not exists + if-not-exists indexes.
-- Tenant-private? No — global library, read by every tenant.
-- (RLS Phase 1 / migration 040 will need amending to add a public-read
--  policy or to leave this table RLS-off, depending on the access path.
--  The current implementation reads via service-role from /api/supplier/*
--  routes so RLS-off is fine for now.)
--
-- NOT auto-applied to prod — apply with:
--   node --env-file=.env.local scripts/run-migration-041.mjs
-- ════════════════════════════════════════════════════════════════════

create table if not exists supplier_catalogue (
  id uuid primary key default gen_random_uuid(),
  trade text not null check (trade in ('electrical', 'plumbing')),

  -- Semantic grouping — aligns with shared_materials.category (migration
  -- 022) and tenant_material_catalogue.category so the same category
  -- string flows end-to-end from supplier_catalogue -> tenant catalogue
  -- -> BOM resolution -> grounding validator.
  category text not null,

  -- Required for the supplier library — every row IS a branded SKU.
  brand text not null,
  -- Optional sub-line: Clipsal Iconic vs Clipsal 2000, Caroma Liano vs
  -- Caroma Smartflush. resolveTierForBrandRange() in lib/estimate/catalogue.ts
  -- already infers tier from these range keywords; storing the raw string
  -- gives the operator the brand+range label without our regex losing data.
  range_series text,

  name text not null,
  -- Where it's typically bought (Reece, Bunnings, MM Electrical, etc.).
  -- Free-text — we don't enumerate suppliers because each trade has its
  -- own ecosystem and merging them now would over-constrain the data.
  supplier_label text,

  default_unit text not null default 'each',
  -- Vendor RRP ex-GST. NEVER read as a sell price by the estimator —
  -- when a tenant adds this SKU to their own catalogue, they choose their
  -- price (defaulting to RRP, editable). The grounding validator only
  -- accepts tenant_material_catalogue + shared_materials prices.
  default_unit_price_ex_gst numeric(10,2) not null,

  -- Tier mapping. NULL = let resolveTierForBrandRange() infer from
  -- brand+range. Set explicitly when the range keyword is ambiguous.
  tier_hint text check (tier_hint in ('good', 'better', 'best')),

  image_url text,
  description text,
  -- Free-form structured properties (kW, IP rating, GPM, flow class…).
  properties jsonb not null default '{}'::jsonb,

  -- Bumped whenever we refresh this row from supplier price lists.
  -- tenant_material_catalogue keeps the last_seen_revision (added by a
  -- later migration if/when supplier-refresh banner ships) so each tenant
  -- can see "this SKU has a new price you haven't reviewed".
  supplier_revision int not null default 1,

  -- Soft-delete instead of dropping so any tenant_material_catalogue
  -- rows linked to a discontinued SKU keep working (the on-delete-set-null
  -- in migration 042 covers hard delete; this is the more common case).
  retired_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Unique on (trade, brand, lowercased-name) for ACTIVE rows only.
-- Retired rows are excluded so a discontinued "Clipsal Iconic GPO" can
-- be replaced by a new one of the same name without dropping the old.
create unique index if not exists supplier_catalogue_unique_active_name
  on supplier_catalogue (trade, brand, lower(name))
  where retired_at is null;

-- The estimator and the browse UI both look up by (trade, category) —
-- partial index keeps active-only reads fast.
create index if not exists supplier_catalogue_lookup_idx
  on supplier_catalogue (trade, category)
  where retired_at is null;

-- Brand filter on the browse UI.
create index if not exists supplier_catalogue_brand_idx
  on supplier_catalogue (trade, brand)
  where retired_at is null;

create or replace function supplier_catalogue_set_updated_at()
returns trigger as $$
begin
  new.updated_at := now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists supplier_catalogue_set_updated_at
  on supplier_catalogue;
create trigger supplier_catalogue_set_updated_at
  before update on supplier_catalogue
  for each row
  execute function supplier_catalogue_set_updated_at();

-- Keep PostgREST's schema cache fresh (mirrors migration 028/034 pattern).
notify pgrst, 'reload schema';
