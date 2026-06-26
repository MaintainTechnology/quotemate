-- Rollback for migration 151 — painting estimate tradie link.
-- Drops the additive estimate_token column (and its unique index with it).
-- The customer public_token + estimate payloads are untouched, so rolling
-- back only loses the tradie-facing /p link.
drop index if exists public.painting_measurements_estimate_token_idx;

alter table public.painting_measurements
  drop column if exists estimate_token;

notify pgrst, 'reload schema';
