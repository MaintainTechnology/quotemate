-- 056_stripe_connect_state.sql
--
-- Stripe Connect (Express) — connected-account readiness state on tenants.
--
-- `tenants.stripe_connect_account_id` already exists (migration 015) but
-- was never populated. To pay a tradie we also need to know whether their
-- connected account has finished Stripe-hosted onboarding + KYC. These
-- four flags mirror the Stripe Account object fields of the same name and
-- are kept in sync by the `account.updated` Connect webhook
-- (/api/stripe/connect-webhook).
--
-- A tradie is payout-eligible ONLY when payouts_enabled is true.
--
-- Additive + idempotent — no data change, safe to re-run.

alter table tenants add column if not exists stripe_connect_charges_enabled   boolean not null default false;
alter table tenants add column if not exists stripe_connect_payouts_enabled   boolean not null default false;
alter table tenants add column if not exists stripe_connect_details_submitted boolean not null default false;
-- Stamped once the account first reaches charges_enabled && payouts_enabled.
alter table tenants add column if not exists stripe_connect_onboarded_at      timestamptz;

-- Webhook resolves the tenant from the inbound acct_… id; index that lookup.
create index if not exists idx_tenants_stripe_connect_account
  on tenants (stripe_connect_account_id)
  where stripe_connect_account_id is not null;
