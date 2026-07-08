-- 168 — link a promoted roofing measurement to its quotes row (spec
-- tradie-onsite-quote-editing R6a). POST /api/roofing/save-as-quote stamps
-- these after a measure_token promotion so a second promotion returns the
-- existing quote instead of inserting a duplicate. Additive + idempotent.
--
-- Apply: node --env-file=.env.local scripts/run-migration-168.mjs

alter table public.roofing_measurements
  add column if not exists quote_id uuid,
  add column if not exists quote_share_token text;
