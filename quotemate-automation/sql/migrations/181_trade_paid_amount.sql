-- 181 · record what the customer actually paid, on the trade measurement tables.
--
-- roofing_measurements / painting_measurements carried paid_tier +
-- paid_stripe_session_id (mig 165) but no AMOUNT, so the thank-you page could
-- only infer the figure from the INSPECTION_FEE_AUD constant — wrong the moment
-- a tenant charges anything else, and reconciliation meant calling Stripe with
-- paid_stripe_session_id.
--
-- Mirrors quotes.paid_amount_cents (mig 160). Stamped from the Stripe Session's
-- amount_total by the webhook and by the page-level webhook-race guard.
-- Existing rows stay null and fall back in lib/quote/paid-amount.ts.

alter table public.roofing_measurements
  add column if not exists paid_amount_cents bigint;

alter table public.painting_measurements
  add column if not exists paid_amount_cents bigint;

comment on column public.roofing_measurements.paid_amount_cents is
  'Stripe Session amount_total, in cents. Null on rows paid before mig 181.';

comment on column public.painting_measurements.paid_amount_cents is
  'Stripe Session amount_total, in cents. Null on rows paid before mig 181.';
