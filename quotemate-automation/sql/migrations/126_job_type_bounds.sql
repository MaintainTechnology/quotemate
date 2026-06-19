-- ════════════════════════════════════════════════════════════════════
-- Migration 126 — job_type_bounds (R9 deterministic sanity-bounds).
--
-- WHY: per-line grounding can't see a grossly-wrong TOTAL or labour-hours
-- (the 6-downlight job that billed 17.5h is the canonical case). This table
-- holds a per-(trade, job_type) plausibility band; lib/estimate/sanity-bounds.ts
-- checks a built quote against it and routes an out-of-band quote to the $99
-- inspection (NOT auto-corrected — an out-of-band total signals a misread
-- scope).
--
-- ⚠ PROVISIONAL VALUES — FLAGGED FOR TRADIE CONFIRMATION (spec R9 + R13).
-- The seeded bounds below are conservative engineering estimates derived from
-- typical AU job shapes, NOT tradie-verified. They are wide on purpose (gross-
-- error catch, not fine pricing). They MUST be reviewed/tightened with a real
-- tradie before they gate auto-send for a job-type. Provenance: see
-- docs/markdown/measurable-targets.md (sanity-bounds source).
--
-- Idempotent: create-if-not-exists + insert guarded by NOT EXISTS.
-- NOT auto-applied to prod. Apply with:
--   node --env-file=.env.local scripts/run-migration-126.mjs
-- ════════════════════════════════════════════════════════════════════

create table if not exists public.job_type_bounds (
  id                    uuid primary key default gen_random_uuid(),
  trade                 text not null check (trade in ('electrical', 'plumbing')),
  job_type              text not null,
  max_labour_hours      numeric(6,2),
  min_total_ex_gst      numeric(10,2),
  max_total_ex_gst      numeric(10,2),
  per_unit_labour_hours numeric(6,2),
  notes                 text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (trade, job_type)
);

comment on table public.job_type_bounds is
  'R9 per-(trade,job_type) sanity band. Provisional values — flagged for tradie confirmation before they gate auto-send. checkSanityBounds() in lib/estimate/sanity-bounds.ts consumes this.';

-- Provisional bounds for the top-5 SMS auto-quote job types. PROVISIONAL.
insert into public.job_type_bounds (trade, job_type, max_labour_hours, min_total_ex_gst, max_total_ex_gst, per_unit_labour_hours, notes)
select v.trade, v.job_type, v.max_labour_hours, v.min_total_ex_gst, v.max_total_ex_gst, v.per_unit_labour_hours, v.notes
from (values
  ('electrical', 'downlights',   11.0, 300.0,  4000.0, 1.0,  'PROVISIONAL — confirm with tradie. ~0.5-0.7h/point + setup; cap catches the 17.5h defect.'),
  ('electrical', 'power_points',  8.0, 250.0,  3000.0, 1.0,  'PROVISIONAL — confirm with tradie.'),
  ('electrical', 'ceiling_fans',  8.0, 300.0,  3500.0, 1.5,  'PROVISIONAL — confirm with tradie.'),
  ('plumbing',   'hot_water',     6.0, 800.0,  6000.0, null, 'PROVISIONAL — confirm with tradie. Unit-supplied dominates total.'),
  ('plumbing',   'blocked_drain', 4.0, 150.0,  2500.0, null, 'PROVISIONAL — confirm with tradie. Labour/service dominated.')
) as v(trade, job_type, max_labour_hours, min_total_ex_gst, max_total_ex_gst, per_unit_labour_hours, notes)
where not exists (
  select 1 from public.job_type_bounds b
  where b.trade = v.trade and b.job_type = v.job_type
);

notify pgrst, 'reload schema';
