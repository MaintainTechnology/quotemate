-- ════════════════════════════════════════════════════════════════════
-- Migration 132 — tenant subscription / billing columns (Stripe Billing).
--
-- WHY: QuoteMate is moving from "free test phase" to paid subscription
-- tiers (Starter / Pro / Crew, monthly + annual, 14-day trial). Stripe is
-- the authoritative source for a subscription's state; these columns are a
-- queryable MIRROR synced by /api/stripe/webhook so the dashboard + future
-- plan-gating can read "what plan is this tenant on" off the tenant row
-- without a Stripe round-trip.
--
-- WHAT IT DOES: adds 8 additive, nullable columns to public.tenants and two
-- partial indexes for the webhook's customer/subscription lookups. No
-- existing row is mutated (every column defaults null / false).
--
-- DDL-only, idempotent (add column IF NOT EXISTS). NOT auto-applied to prod.
-- Apply:
--   node --env-file=.env.local scripts/run-migration-132.mjs
--   node --env-file=.env.local scripts/run-migration-132.mjs --rollback
-- ════════════════════════════════════════════════════════════════════

alter table public.tenants
  add column if not exists stripe_customer_id text,
  add column if not exists stripe_subscription_id text,
  add column if not exists subscription_status text,
  add column if not exists subscription_plan text,
  add column if not exists subscription_interval text,
  add column if not exists subscription_current_period_end timestamptz,
  add column if not exists trial_ends_at timestamptz,
  add column if not exists subscription_cancel_at_period_end boolean not null default false;

-- One Stripe customer per tenant; one subscription per tenant. Partial
-- unique/lookup indexes (WHERE NOT NULL) keep the webhook's reverse lookup
-- (customer → tenant) fast without constraining the many NULL rows.
create unique index if not exists idx_tenants_stripe_customer_id
  on public.tenants (stripe_customer_id)
  where stripe_customer_id is not null;

create index if not exists idx_tenants_stripe_subscription_id
  on public.tenants (stripe_subscription_id)
  where stripe_subscription_id is not null;

comment on column public.tenants.subscription_status is
  'Stripe subscription status mirror: trialing|active|past_due|canceled|incomplete|incomplete_expired|unpaid|paused. NULL = never subscribed. Authoritative source is Stripe; synced via /api/stripe/webhook.';
comment on column public.tenants.subscription_plan is
  'starter|pro|crew — parsed from the subscribed price lookup_key (qm_<plan>_<interval>).';
comment on column public.tenants.subscription_interval is
  'month|year — billing interval of the active subscription.';

notify pgrst, 'reload schema';
