-- Migration 156 · painting deposit flow (per-tier Stripe links)
--
-- Wires the residential painting customer quote for per-tier Stripe deposits,
-- mirroring the columns the main quotes flow + solar_estimates already carry.
-- Until now painting_measurements had no payment columns, so the quote page's
-- "Pay deposit" CTA rendered disabled and the SMS could not carry deposit
-- links (no /r/paint redirect target existed).
--
--   • stripe_links            jsonb  — { good, better, best } → Checkout URL,
--                                       read by /r/paint/[token]/[tier].
--   • paid_at                 timestamptz — set by the Stripe webhook when a
--                                       deposit completes (idempotent).
--   • paid_tier               text   — which tier the customer deposited on.
--   • paid_stripe_session_id  text   — the Checkout Session id (dedupe).
--
-- Additive only; no data backfill. Idempotent.

alter table public.painting_measurements
  add column if not exists stripe_links jsonb,
  add column if not exists paid_at timestamptz,
  add column if not exists paid_tier text,
  add column if not exists paid_stripe_session_id text;

-- Refresh PostgREST's cache so supabase-js sees the new columns immediately.
notify pgrst, 'reload schema';

do $$
declare
  has_links boolean;
  has_paid boolean;
begin
  select exists (
    select 1 from information_schema.columns
     where table_schema='public' and table_name='painting_measurements' and column_name='stripe_links'
  ) into has_links;
  select exists (
    select 1 from information_schema.columns
     where table_schema='public' and table_name='painting_measurements' and column_name='paid_at'
  ) into has_paid;
  raise notice 'Migration 156: painting_measurements.stripe_links=%, paid_at=%', has_links, has_paid;
end $$;
