-- Migration 165 · roofing on-page site-visit payment + customer acceptance
--
-- Extends the customer accept/pay flow (Gap #1/#3/#4) to the two dedicated
-- surfaces that are NOT backed by public.quotes:
--
--   roofing_measurements (/q/roof/[token]) — previously had NO payment path at
--     all ("reply over SMS"). Adds a refundable $99 site-visit deposit paid via
--     /r/roof/[token]/inspection → Stripe → this table's paid_at (mirrors the
--     painting_measurements deposit columns from migration 156). Plus the
--     customer-acceptance record.
--
--   painting_measurements (/q/paint/[token]) — already has the deposit columns
--     (mig 156); only needs the customer-acceptance record so the explicit
--     "Accept & confirm" block can log acceptance like the quotes surfaces do.
--
-- Additive + idempotent. No backfill (existing rows are simply not-accepted /
-- not-paid, which is correct).

alter table public.roofing_measurements
  add column if not exists paid_at                timestamptz,
  add column if not exists paid_tier              text,
  add column if not exists paid_stripe_session_id text,
  add column if not exists customer_accepted_at   timestamptz,
  add column if not exists customer_accepted_tier text;

alter table public.painting_measurements
  add column if not exists customer_accepted_at   timestamptz,
  add column if not exists customer_accepted_tier text;

-- Refresh PostgREST's cache so supabase-js sees the new columns immediately.
notify pgrst, 'reload schema';

do $$
declare
  roof_paid boolean;
  roof_acc  boolean;
  paint_acc boolean;
begin
  select exists (select 1 from information_schema.columns
     where table_schema='public' and table_name='roofing_measurements' and column_name='paid_at') into roof_paid;
  select exists (select 1 from information_schema.columns
     where table_schema='public' and table_name='roofing_measurements' and column_name='customer_accepted_at') into roof_acc;
  select exists (select 1 from information_schema.columns
     where table_schema='public' and table_name='painting_measurements' and column_name='customer_accepted_at') into paint_acc;
  raise notice 'Migration 165: roofing.paid_at=%, roofing.customer_accepted_at=%, painting.customer_accepted_at=%',
    roof_paid, roof_acc, paint_acc;
end $$;
