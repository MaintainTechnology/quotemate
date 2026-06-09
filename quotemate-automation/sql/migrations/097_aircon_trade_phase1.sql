-- Migration 097 · Air-conditioning trade — Phase 1 seed
--
-- Like painting (088) and roofing (080), aircon runs on a self-contained
-- deterministic pipeline (lib/aircon/*) — the money path is a rate card
-- (lib/aircon/recommend.ts DEFAULT_AC_RATE_CARD), NOT the Opus estimator.
-- These rows register the trade and seed a couple of forward-looking
-- catalogue entries; the deterministic engine does not read them.
--
-- Additive + idempotent. Does NOT alter the IntakeSchema trade enum
-- (aircon has no lib/intake/structure.ts path) and does NOT insert a
-- pricing_book row (tenant_id NOT NULL since mig 025 — created at tenant
-- activation). Apply with:
--   node --env-file=.env.local scripts/run-migration-097.mjs

-- ── 1. Trades registry row ─────────────────────────────────────────
insert into trades (name, display_name, is_job_based, active)
values ('aircon', 'Air Conditioning', true, true)
on conflict (name) do nothing;

-- ── 2. Forward-looking shared_assemblies (engine does not read these) ─
insert into shared_assemblies (
  trade, name, description, default_unit,
  default_unit_price_ex_gst, default_labour_hours, default_exclusions,
  category, properties
)
select * from (values
  ('aircon', 'Split system — supply & install (per head)', 'Supply and back-to-back install of a wall-mounted split-system indoor head + outdoor unit on a sound external wall.', 'each', 1400.00, 4.0, 'Excludes long pipe runs, electrical upgrades, crane/height access, asbestos handling', 'split_install', '{"system":"split"}'::jsonb),
  ('aircon', 'Ducted system — supply & install (per kW)', 'Ducted reverse-cycle system supply and install priced per kW of capacity, incl. ductwork and zoning.', 'kw', 1100.00, 2.0, 'Excludes 3-phase upgrades, roof access loading, structural modifications', 'ducted_install', '{"system":"ducted"}'::jsonb)
) as v(trade, name, description, default_unit, default_unit_price_ex_gst, default_labour_hours, default_exclusions, category, properties)
where not exists (
  select 1 from shared_assemblies sa where sa.name = v.name and sa.trade = v.trade
);

-- Keep PostgREST's schema cache fresh.
notify pgrst, 'reload schema';

-- ── 3. Sanity check (read-only) ────────────────────────────────────
do $$
declare trade_count int; asm_count int;
begin
  select count(*) into trade_count from trades where name = 'aircon';
  select count(*) into asm_count from shared_assemblies where trade = 'aircon';
  raise notice 'Migration 097: aircon trade rows = %, assemblies = %', trade_count, asm_count;
end $$;
