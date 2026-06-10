-- ════════════════════════════════════════════════════════════════════
-- Migration 083 — spec-aware pricing data layer (trades-as-data)
--
--  1. trade_spec_defs — registry of which spec keys matter per (trade,
--     category). The CODE SEED in lib/estimate/spec-registry.ts is the source
--     of truth for canonical GRAMMAR (canonicalise stays code-only); this
--     table only ADDS keys for new trades/categories (v9 admin loader). On a
--     conflict the code seed wins — see getSpecDefs(... overrides).
--
--  2. Widen tenant_material_catalogue.trade — migration 028 pinned it to
--     check (trade in ('electrical','plumbing')). A v9 trade (roofing,
--     carpentry…) can't insert a catalogue row under that CHECK. Drop it so
--     trade is governed by the app + the trades registry, not a hard column.
--
-- Additive + idempotent. NOT auto-applied to prod — apply with:
--   node --env-file=.env.local scripts/run-migration-083.mjs
-- ════════════════════════════════════════════════════════════════════

create table if not exists trade_spec_defs (
  id uuid primary key default gen_random_uuid(),
  trade text not null,
  category text not null,
  spec_key text not null,
  -- Reserved: hard = must-match-or-inspection (the guard reads this later).
  hard boolean not null default false,
  created_at timestamptz not null default now(),
  unique (trade, category, spec_key)
);

-- New tables ship RLS-on, no policy (RLS Phase 1.5 convention). This is a
-- global reference table — service-role (every API route) bypasses RLS, and
-- the anon key sees zero rows.
alter table trade_spec_defs enable row level security;

create index if not exists trade_spec_defs_lookup_idx
  on trade_spec_defs (lower(trade), lower(category));

-- Drop the 2-trade CHECK so v9 trades can hold catalogue rows. Postgres names
-- an inline column CHECK `<table>_<column>_check`.
alter table tenant_material_catalogue
  drop constraint if exists tenant_material_catalogue_trade_check;

-- Keep PostgREST's schema cache fresh.
notify pgrst, 'reload schema';
