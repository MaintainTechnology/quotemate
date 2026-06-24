-- 143 — public_token on paint_runs (commercial painting).
--
-- Adds the unguessable share token that powers the customer-facing
-- /q/commercial-paint/[token] page (spec per-trade-quote-formats R11/R20).
-- Mirrors painting_measurements.public_token (089) and roofing_measurements
-- (081). Additive + idempotent — safe to re-run.
--
-- Apply: node --env-file=.env.local scripts/run-migration-143.mjs

alter table public.paint_runs
  add column if not exists public_token text;

create unique index if not exists paint_runs_public_token_idx
  on public.paint_runs (public_token)
  where public_token is not null;

-- paint_runs already has RLS enabled (migration 040 posture); the customer
-- page reads via the service-role key, so no anon policy is added here.
