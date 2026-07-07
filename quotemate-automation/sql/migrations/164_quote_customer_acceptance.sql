-- Migration 164 · customer quote acceptance (Gap #1 / #3)
--
-- Records the customer's EXPLICIT acceptance of a quote BEFORE payment — the
-- "Accept quote & confirm site visit" action added to every customer surface
-- (/q/[token], /q/solar, /q/roof, /q/commercial-paint, /q/paint).
--
-- This is a DIFFERENT concept from the existing lifecycle `accepted` status,
-- which means "booked a slot AFTER paying" and ranks ABOVE `paid`
-- (lib/quote/lifecycle.ts). Customer acceptance is a pre-payment intent-to-
-- proceed, so it gets its own columns and deliberately does NOT touch the
-- monotonic status ladder or the follow-up analytics that read `accepted_at`.
--
--   customer_accepted_at    — when the customer tapped "Accept & confirm".
--   customer_accepted_tier  — which tier / 'inspection' they accepted, so the
--                             record ties acceptance to the specific price/scope
--                             the customer saw (the legal record Jon asked for).
--
-- Every customer surface (solar included) has a public.quotes row keyed by
-- share_token, so recording here covers all trades from one endpoint.
--
-- Additive + idempotent. No backfill — existing quotes are simply "not yet
-- accepted" (NULL), which is correct.

alter table public.quotes
  add column if not exists customer_accepted_at   timestamptz,
  add column if not exists customer_accepted_tier text;

-- Refresh PostgREST's cache so supabase-js sees the new columns immediately.
notify pgrst, 'reload schema';

do $$
declare
  has_at   boolean;
  has_tier boolean;
begin
  select exists (
    select 1 from information_schema.columns
     where table_schema='public' and table_name='quotes' and column_name='customer_accepted_at'
  ) into has_at;
  select exists (
    select 1 from information_schema.columns
     where table_schema='public' and table_name='quotes' and column_name='customer_accepted_tier'
  ) into has_tier;
  raise notice 'Migration 164: quotes.customer_accepted_at=%, quotes.customer_accepted_tier=%', has_at, has_tier;
end $$;
