-- 160_connect_payouts.sql
--
-- Stripe Connect funds flow — the ledger columns for "collect via
-- destination charge → hold → release on job completion".
--
-- Charge side (stamped by /api/stripe/webhook on checkout.session.completed):
--   paid_amount_cents           what the customer paid (Session amount_total)
--   platform_fee_cents          QuoteMax's 2% application fee (null for
--                               legacy platform-direct charges)
--   stripe_connect_destination  the acct_… the funds settled to (null for
--                               legacy platform-direct charges)
--
-- Release side (written by /api/quote/[id]/complete):
--   completed_at                tradie marked the job complete
--   stripe_payout_id            po_… on the connected account; holds the
--                               'pending' claim sentinel while a release is
--                               in flight (single-payout race guard)
--   payout_amount_cents         net released to the tradie's bank
--                               (paid − fee)
--   payout_created_at           when the payout was created
--
-- Additive + idempotent — no data change, safe to re-run.

alter table quotes add column if not exists paid_amount_cents          bigint;
alter table quotes add column if not exists platform_fee_cents         bigint;
alter table quotes add column if not exists stripe_connect_destination text;
alter table quotes add column if not exists completed_at               timestamptz;
alter table quotes add column if not exists stripe_payout_id           text;
alter table quotes add column if not exists payout_amount_cents        bigint;
alter table quotes add column if not exists payout_created_at          timestamptz;

-- The payouts dashboard lists a tenant's Connect-routed paid jobs.
create index if not exists idx_quotes_connect_paid
  on quotes (tenant_id, paid_at desc)
  where stripe_connect_destination is not null;
