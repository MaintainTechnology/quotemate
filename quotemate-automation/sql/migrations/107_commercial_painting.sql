-- Migration 107 · Commercial Painting estimator (strategy v11, spec 2026-06-12)
--
-- Backs the "Commercial Painting" dashboard tab: a tradie uploads a set of
-- construction documents (plan set required; measurement takeoff / services
-- layout / site photo optional), Claude classifies + extracts a painting
-- takeoff, the tradie confirms it, and a pure-TS pricer over `paint_rates`
-- produces a single tender-style quote.
--
-- Extends the Estimator-Beta plumbing (migration 099) rather than forking:
--   paint_runs       — one row per multi-document run (owns N plan_uploads)
--   plan_uploads     — gains trade / doc_type / paint_run_id
--   plan_extractions — gains trade / paint_run_id (a painting extraction spans
--                      every document in the run; plan_upload_id keeps pointing
--                      at the primary plan_set upload)
--   paint_rates      — trade-scoped, tenant-overridable labour/material/
--                      modifier/equipment reference rates. Seed rows are
--                      researched AU commercial defaults flagged is_default
--                      pending real-painter validation (strategy v11).
--
-- Idempotent throughout. Apply with:
--   node --env-file=.env.local scripts/run-migration-107.mjs

-- ── 1. paint_runs — one row per commercial painting run ──────────────
create table if not exists public.paint_runs (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id) on delete cascade,

  job_name     text,            -- e.g. "IGA Swan Street fit-out"
  site_address text,            -- e.g. "480 Swan St, Richmond VIC 3121"

  -- draft → extracting → ready → priced | failed
  status       text not null default 'draft',
  status_note  text,            -- model/system note on failure

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists paint_runs_tenant_idx
  on public.paint_runs (tenant_id, created_at desc);

-- ── 2. plan_uploads / plan_extractions gain trade scoping ────────────
alter table public.plan_uploads
  add column if not exists trade        text not null default 'electrical',
  add column if not exists doc_type     text,   -- plan_set | measurement_takeoff | services_layout | site_photo | other
  add column if not exists paint_run_id uuid references public.paint_runs(id) on delete cascade;

alter table public.plan_extractions
  add column if not exists trade        text not null default 'electrical',
  add column if not exists paint_run_id uuid references public.paint_runs(id) on delete cascade;

create index if not exists plan_uploads_paint_run_idx
  on public.plan_uploads (paint_run_id) where paint_run_id is not null;
create index if not exists plan_extractions_paint_run_idx
  on public.plan_extractions (paint_run_id) where paint_run_id is not null;

-- ── 3. paint_rates — labour / material / modifier / equipment rates ──
create table if not exists public.paint_rates (
  id                  uuid primary key default gen_random_uuid(),
  trade               text not null default 'commercial_painting',
  tenant_id           uuid references tenants(id) on delete cascade, -- null = shared default
  kind                text not null check (kind in ('labour','material','modifier','equipment')),
  code                text not null,  -- stable matching key, e.g. 'labour:spray_matt:spray'
  label               text not null,

  system              text,           -- spray_matt | flat | low_sheen | semi_gloss
  method              text,           -- spray | roller | brush | per_item
  product             text,           -- materials: product display name

  coverage_m2_per_hr  numeric(8,2),   -- labour rows (per painter, per coat)
  spread_m2_per_l     numeric(8,2),   -- material rows (per coat)
  price_per_l_ex_gst  numeric(8,2),   -- material rows
  unit_hours          numeric(8,2),   -- per-item labour rows (hours/unit/coat)
  value               numeric(10,4),  -- modifiers (multiplier/pct) + equipment day rates
  unit                text,           -- 'multiplier' | 'pct' | 'aud_per_hr' | 'aud_per_day' | 'hours' | 'count'

  notes               text,
  is_default          boolean not null default true,  -- seeded, pending painter validation
  created_at          timestamptz not null default now()
);

-- One row per (trade, tenant, code); shared defaults use tenant_id null.
create unique index if not exists paint_rates_trade_tenant_code_idx
  on public.paint_rates (trade, tenant_id, code) nulls not distinct;

-- ── 4. Seed: researched AU commercial defaults (is_default = true) ───
-- Labour coverage is m²/hr per painter PER COAT, masking included.
insert into public.paint_rates
  (trade, kind, code, label, system, method, coverage_m2_per_hr, unit_hours, notes)
values
  ('commercial_painting','labour','labour:spray_matt:spray','Exposed/concrete ceiling — airless spray', 'spray_matt','spray', 25.00, null, 'Effective rate incl. masking of services; IGA-style exposed soffits'),
  ('commercial_painting','labour','labour:flat:spray',      'Suspension ceiling — flat spray',          'flat',     'spray', 28.00, null, 'Grid + tile sets sprayed in place'),
  ('commercial_painting','labour','labour:flat:roller',     'Flat ceiling — roller',                    'flat',     'roller',12.00, null, null),
  ('commercial_painting','labour','labour:low_sheen:roller','Walls low-sheen — roller',                 'low_sheen','roller',10.00, null, 'Standard interior wall rate per coat'),
  ('commercial_painting','labour','labour:semi_gloss:roller','Wet-area walls semi-gloss — roller',      'semi_gloss','roller', 9.00, null, 'Kitchen/bathroom premium washable'),
  ('commercial_painting','labour','labour:low_sheen:brush', 'Cut-in / detail — brush (low sheen)',      'low_sheen','brush',  4.00, null, null),
  ('commercial_painting','labour','labour:semi_gloss:brush','Trim & cut-in — brush (semi-gloss)',       'semi_gloss','brush', 4.00, null, null),
  ('commercial_painting','labour','labour:door:per_item',   'Door + frame — per unit',                  'semi_gloss','per_item', null, 0.75, 'Hours per door per coat, both faces + frame')
on conflict do nothing;

-- Materials: spread is m²/L PER COAT; prices ex-GST trade pricing.
insert into public.paint_rates
  (trade, kind, code, label, system, product, spread_m2_per_l, price_per_l_ex_gst, notes)
values
  ('commercial_painting','material','mat:ceiling_spray_matt','Spray-grade ceiling matt',            'spray_matt','Spray-grade ceiling matt (white)', 12.00, 10.00, 'Spread allows airless overspray loss'),
  ('commercial_painting','material','mat:ceiling_flat',      'Flat ceiling acrylic',                'flat',      'Flat ceiling acrylic (white)',      14.00,  9.50, null),
  ('commercial_painting','material','mat:wall_low_sheen',    'Low-sheen interior acrylic',          'low_sheen', 'Low-sheen acrylic interior',        15.00, 11.00, null),
  ('commercial_painting','material','mat:wet_semi_gloss',    'Premium semi-gloss acrylic (wet areas)','semi_gloss','Premium semi-gloss acrylic',      15.00, 14.00, 'Kitchen/bathroom washable spec'),
  ('commercial_painting','material','mat:enamel_trim',       'Water-based enamel (doors/trim)',     'semi_gloss','Water-based enamel',                14.00, 16.00, 'Used for per-item door/frame lines'),
  ('commercial_painting','material','mat:sealer_undercoat',  'Acrylic sealer undercoat',            null,        'Acrylic sealer undercoat',          14.00,  9.00, 'Bare/patched substrate first coat')
on conflict do nothing;

-- Modifiers + crew assumptions.
insert into public.paint_rates
  (trade, kind, code, label, value, unit, notes)
values
  ('commercial_painting','modifier','mod:height_low',         'Height multiplier ≤ 3.4 m',          1.0000, 'multiplier', null),
  ('commercial_painting','modifier','mod:height_mid',         'Height multiplier 3.4–5 m',          1.2500, 'multiplier', 'Mobile scaffold / short lift work'),
  ('commercial_painting','modifier','mod:height_high',        'Height multiplier > 5 m',            1.4000, 'multiplier', 'Scissor-lift territory (IGA walls 5.2 m)'),
  ('commercial_painting','modifier','mod:prep_pct',           'Surface prep allowance',             0.1000, 'pct',        'Fill/sand/spot-prime on sound commercial substrates'),
  ('commercial_painting','modifier','mod:sundries_pct',       'Materials sundries',                 0.0800, 'pct',        'Masking film, tape, drop sheets, rollers'),
  ('commercial_painting','modifier','mod:labour_rate',        'Charge-out labour rate',            75.0000, 'aud_per_hr', 'AU metro commercial painter ex-GST'),
  ('commercial_painting','modifier','mod:crew_hours_per_day', 'Productive hours per painter day',   7.6000, 'hours',      null),
  ('commercial_painting','modifier','mod:default_crew_size',  'Default crew size',                  3.0000, 'count',      null)
on conflict do nothing;

-- Equipment day rates (ex-GST), auto-triggered by takeoff attributes.
insert into public.paint_rates
  (trade, kind, code, label, value, unit, notes)
values
  ('commercial_painting','equipment','equip:scissor_lift',   'Scissor lift hire (19 ft electric)', 300.0000, 'aud_per_day', 'Triggered when any priced surface has height > 3.4 m'),
  ('commercial_painting','equipment','equip:scaffold_mobile','Mobile scaffold hire',               180.0000, 'aud_per_day', 'Manual add — not auto-triggered in v1')
on conflict do nothing;

-- ── 5. RLS + grants (post-040 posture; service role does the work) ───
alter table public.paint_runs  enable row level security;
alter table public.paint_rates enable row level security;

grant select, insert, update, delete
  on public.paint_runs, public.paint_rates
  to service_role;

notify pgrst, 'reload schema';

-- ── Verification ─────────────────────────────────────────────────────
do $$
declare
  runs_ok   boolean;
  rates_ok  boolean;
  seed_n    integer;
  trade_ok  boolean;
begin
  select exists (select 1 from information_schema.tables
                  where table_schema='public' and table_name='paint_runs') into runs_ok;
  select exists (select 1 from information_schema.tables
                  where table_schema='public' and table_name='paint_rates') into rates_ok;
  select count(*) from public.paint_rates
    where trade='commercial_painting' and tenant_id is null into seed_n;
  select exists (select 1 from information_schema.columns
                  where table_schema='public' and table_name='plan_uploads'
                    and column_name='paint_run_id') into trade_ok;
  raise notice 'Migration 107: paint_runs=% paint_rates=% seed_rows=% plan_uploads.paint_run_id=%',
    runs_ok, rates_ok, seed_n, trade_ok;
end $$;
