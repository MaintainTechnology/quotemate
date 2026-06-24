-- Rollback for migration 140 — roofing measurement selection + measure link.
-- Drops the two additive columns (and the unique index with them). The
-- customer public_token + quote payloads are untouched, so rolling back only
-- loses the tradie-facing /m link and the persisted structure selection
-- (readers fall back to "all structures").
drop index if exists public.roofing_measurements_measure_token_idx;

alter table public.roofing_measurements
  drop column if exists measure_token,
  drop column if exists included_indices;

notify pgrst, 'reload schema';
