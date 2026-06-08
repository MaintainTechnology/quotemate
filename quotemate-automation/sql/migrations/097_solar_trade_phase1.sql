-- Migration 097 · Solar trade — Phase 1 foundation
--
-- Context: a self-serve solar PV estimate trade alongside electrical /
-- plumbing / roofing / painting. Like roofing (mig 080) and painting
-- (mig 088), solar runs on a self-contained DETERMINISTIC pipeline
-- (lib/solar/* — built in later phases), NOT the strict-grounding Opus
-- estimator. The money path is a per-kW rate card minus the STC rebate
-- (gross − STC = net); every $ figure derives from this config + roof
-- facts. See docs/superpowers/specs/2026-06-08-solar-estimate-design.md.
--
-- ADDITIVE ONLY. This migration does NOT:
--   • alter the IntakeSchema trade enum (solar intake runs through the
--     separate lib/solar/ pipeline, not lib/intake/structure.ts)
--   • insert a pricing_book row (tenant_id is NOT NULL since mig 025 —
--     per-tenant rows are created at tenant activation; tenants override
--     the shipped rate card via pricing_book.overlays)
--   • change any CHECK constraints on existing tables
--
-- What it DOES:
--   1. registers the 'solar' trade row in the trades registry (mig 046)
--   2. creates solar_estimates (token-keyed, mirrors roofing_measurements)
--   3. creates solar_config (dated, no magic numbers in code — spec §5)
--   4. seeds ONE default-AU solar_config row (rate card + STC schedule +
--      zone table + feed-in + export limits + derate + self-consumption)
--
-- Idempotent: create table if not exists + on-conflict / where-not-exists
-- guards so re-runs are no-ops. Apply with:
--   node --env-file=.env.local scripts/run-migration-097.mjs

-- ── 1. Register the solar trade row (trades registry, mig 046) ──────
insert into public.trades (name, display_name, is_job_based, active)
values ('solar', 'Solar', true, true)
on conflict (name) do nothing;

-- ── 2. solar_estimates (mirrors roofing_measurements, mig 081/086) ──
-- ONE row per estimate, token-keyed (the row's public identity), holding
-- normalised roof facts + chosen tiers + economics as jsonb (mirroring
-- how quotes embed good/better/best rather than normalising line items).
create table if not exists public.solar_estimates (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid references public.tenants(id) on delete set null,
  created_by           uuid,                        -- auth.users id of the tradie
  public_token         text not null unique,        -- base64url(16) public identity
  intake_id            uuid references public.intakes(id) on delete set null,
  quote_id             uuid references public.quotes(id) on delete set null,
  -- Property + STC context
  address              text not null,
  postcode             text,
  state                text,
  install_year         int,
  network              text,                        -- resolved DNSP (FiT + export limit)
  -- Coverage / imagery provenance (spec §3, §6)
  coverage_source      text not null default 'google',  -- google | manual
  imagery_quality      text,                        -- HIGH | MEDIUM | LOW | null
  imagery_date         text,                        -- ISO YYYY-MM-DD | null
  confidence_band      text,                        -- tight | wide
  -- Full deterministic payloads (the SolarEstimate shape, jsonb)
  roof                 jsonb,                        -- SolarRoofFacts
  sizing               jsonb,                        -- SolarSizingResult
  production           jsonb,                        -- SolarProductionResult[]
  price                jsonb,                        -- SolarQuotePrice
  economics            jsonb,                        -- SolarEconomicsResult
  guardrail_flags      jsonb not null default '[]'::jsonb,  -- string[] (spec §7)
  routing              text,                         -- tradie_review | inspection_required | auto_quote
  -- Visual + freshness
  satellite_image_path text,                         -- intake-photos bucket path
  config_version       text,                         -- solar_config.version used (spec §5)
  -- Customer confirmation gate (mirrors roofing mig 086)
  confirmed_at         timestamptz,
  created_at           timestamptz not null default now()
);

create index if not exists solar_estimates_tenant_idx
  on public.solar_estimates (tenant_id, created_at desc);

create index if not exists solar_estimates_token_idx
  on public.solar_estimates (public_token);

create index if not exists solar_estimates_created_by_idx
  on public.solar_estimates (created_by, created_at desc);

-- Defence in depth — enable RLS now; service role still bypasses it
-- (Phase-1.5 convention, mig 060/081). Anon key sees zero rows.
alter table public.solar_estimates enable row level security;

-- ── 3. solar_config (dated config, spec §5 — no magic numbers in code) ─
-- ONE active config row at a time; every published estimate stamps its
-- `version`. Stale config (deeming year past / stc_price_aud null) is
-- detected in code (lib/solar/config.ts, later phase) and blocks publish.
create table if not exists public.solar_config (
  version                  text primary key,          -- stamped on every estimate
  effective_date           text not null,             -- ISO date config published
  active                   boolean not null default true,
  -- STC (spec §5, §7)
  deeming_schedule         jsonb not null,            -- { "2026":5, ... "2030":1, "2031":0 }
  zone_table               jsonb not null,            -- { "2000":1.382, ... } postcode→rating
  stc_price_aud            numeric not null,          -- conservative $/STC, date-stamped
  -- Economics (spec §5, §6)
  feed_in                  jsonb not null,            -- { by_network:{}, default_aud_per_kwh }
  export_limits            jsonb not null,            -- { default_kw_per_phase, by_network:{} }
  default_rate_card        jsonb not null,            -- SolarRateCard ($/kW by panel grade)
  derate_factor            numeric not null,          -- DC→AC derate 0.80–0.82
  self_consumption_pct     numeric not null,          -- household self-consumption fraction
  retail_rate_aud_per_kwh  numeric not null,          -- retail $/kWh for savings calc
  created_at               timestamptz not null default now()
);

alter table public.solar_config enable row level security;

-- ── 4. Seed the default AU solar_config (spec §5 / §7 values) ───────
-- version is date-stamped; re-runs are no-ops via where-not-exists.
insert into public.solar_config (
  version, effective_date, active,
  deeming_schedule, zone_table, stc_price_aud,
  feed_in, export_limits, default_rate_card,
  derate_factor, self_consumption_pct, retail_rate_aud_per_kwh
)
select
  '2026-06-08',
  '2026-06-08',
  true,
  -- deeming_schedule: install year → deeming years remaining (SRES ends 2030)
  '{"2026":5,"2027":4,"2028":3,"2029":2,"2030":1,"2031":0}'::jsonb,
  -- zone_table: representative CER postcode→zone ratings (NSW spans 2–4,
  -- QLD 1–3 — never state-default). Expanded to a full table in a later
  -- config refresh; this seed carries the live-tenant capital-city anchors.
  '{
    "2000":1.382,"2150":1.382,"2300":1.382,"2500":1.382,"2600":1.382,
    "2640":1.536,"2480":1.536,
    "4000":1.622,"4350":1.622,"4870":1.622,"4810":1.622,
    "3000":1.185,"5000":1.382,"6000":1.382,"7000":1.185
  }'::jsonb,
  38.00,
  -- feed_in: $/kWh by DNSP (spec §5 — NSW IPART, QLD Energex/Ergon)
  '{
    "by_network":{"Ausgrid":0.05,"Endeavour":0.05,"Essential":0.05,"Energex":0.04,"Ergon":0.07},
    "default_aud_per_kwh":0.05
  }'::jsonb,
  -- export_limits: default 5 kW/phase, small per-DNSP override list (spec §3)
  '{
    "default_kw_per_phase":5.0,
    "by_network":{"Energex":5.0,"Ergon":5.0,"Ausgrid":5.0,"Endeavour":5.0,"Essential":5.0}
  }'::jsonb,
  -- default_rate_card: all-in $/kW DC by grade (within $700–$1,800/kW sane
  -- band, spec §7), loadings as fractions, GST registered, per-job floor.
  '{
    "install_rate_per_kw":{"standard_panels":1100,"premium_panels":1450,"unknown":0},
    "multi_storey_loading_pct":0.15,
    "complex_roof_loading_pct":0.10,
    "gst_registered":true,
    "call_out_minimum_ex_gst":3500
  }'::jsonb,
  0.81,
  0.40,
  0.30
where not exists (
  select 1 from public.solar_config sc where sc.version = '2026-06-08'
);

-- CRITICAL: refresh PostgREST's schema cache so supabase-js routes can
-- immediately read/write the new tables/columns (mirrors mig 085/086).
notify pgrst, 'reload schema';

-- ── 5. Sanity echo (read-only; visible on direct psql runs) ────────
do $$
declare
  has_trade   boolean;
  has_est     boolean;
  has_cfg     boolean;
  cfg_count   int;
begin
  select exists (select 1 from public.trades where name = 'solar') into has_trade;
  select exists (
    select 1 from information_schema.tables
     where table_schema = 'public' and table_name = 'solar_estimates'
  ) into has_est;
  select exists (
    select 1 from information_schema.tables
     where table_schema = 'public' and table_name = 'solar_config'
  ) into has_cfg;
  select count(*) into cfg_count from public.solar_config;
  raise notice 'Migration 097: solar trade=%, solar_estimates=%, solar_config=%, config rows=%',
    has_trade, has_est, has_cfg, cfg_count;
end $$;
