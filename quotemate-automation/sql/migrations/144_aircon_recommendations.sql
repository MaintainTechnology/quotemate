-- 144 — aircon_recommendations: persist the AC recommender output so it has a
-- customer-facing page at /q/aircon/[token] (spec per-trade-quote-formats
-- R11/R22). Today the recommender computes in-memory per request and persists
-- nothing — this table is the missing piece. Mirrors painting_measurements
-- (089) and roofing_measurements (081). Additive + idempotent.
--
-- After applying, /api/aircon/recommend must INSERT a row here with a
-- public_token for the page to have anything to read (see the route TODO).
--
-- Apply: node --env-file=.env.local scripts/run-migration-144.mjs

create table if not exists public.aircon_recommendations (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid references public.tenants(id) on delete set null,
  created_by     uuid,                         -- auth.users id of the tradie
  address        text,
  postcode       text,
  state          text,
  customer_name  text,
  customer_phone text,
  -- The full AcRecommendation object (lib/aircon/types.ts): sizing, options
  -- (ducted + split), routing, confidence.
  recommendation jsonb not null,
  routing        text,                          -- e.g. 'book_assessment'
  public_token   text,                          -- unguessable customer share token
  created_at     timestamptz not null default now()
);

create unique index if not exists aircon_recommendations_public_token_idx
  on public.aircon_recommendations (public_token)
  where public_token is not null;

create index if not exists aircon_recommendations_tenant_idx
  on public.aircon_recommendations (tenant_id, created_at desc);

-- Match the migration-040 RLS posture: enable RLS with no anon policy. The
-- dashboard + customer page read via the service-role key (RLS bypassed); anon
-- sees zero rows.
alter table public.aircon_recommendations enable row level security;
