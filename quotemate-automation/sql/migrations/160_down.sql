-- 160_down.sql — revert 160_connect_payouts.sql

drop index if exists idx_quotes_connect_paid;

alter table quotes drop column if exists payout_created_at;
alter table quotes drop column if exists payout_amount_cents;
alter table quotes drop column if exists stripe_payout_id;
alter table quotes drop column if exists completed_at;
alter table quotes drop column if exists stripe_connect_destination;
alter table quotes drop column if exists platform_fee_cents;
alter table quotes drop column if exists paid_amount_cents;
