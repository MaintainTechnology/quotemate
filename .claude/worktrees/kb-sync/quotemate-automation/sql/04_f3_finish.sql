-- ───────────────────────────────────────────────────────────────────
-- F3 finish migration — completes the schema additions for stages 06-10.
-- Companion to sql/02_stages_06_10_partial.sql which already added
-- share_token, stripe_links, deposit_pct, paid_at, paid_tier,
-- paid_stripe_session_id earlier.
--
-- Safe to re-run. All alters are `if not exists`; tables use `if not exists`.
-- ───────────────────────────────────────────────────────────────────

-- Quote routing + view tracking + scheduling
alter table quotes add column if not exists routing_decision text;
  -- 'auto_send' (v3 only) | 'tradie_review' (v1 default) | 'inspection_required'

alter table quotes add column if not exists viewed_at timestamptz;
  -- first time the customer opened the quote URL (S07 portal load)

alter table quotes add column if not exists accepted_tier text;
  -- 'good' | 'better' | 'best' — set when the customer picks a tier on the
  -- portal. Mirrors paid_tier today (since accept = pay in our Checkout flow)
  -- but kept distinct so a future "accept first, pay later" path is wirable.

alter table quotes add column if not exists scheduled_at timestamptz;
  -- chosen booking slot (set after deposit success; populated by S10 booking flow)

-- Tradies — one row per electrical contractor onboarded
create table if not exists tradies (
  id                    uuid primary key default gen_random_uuid(),
  business_name         text not null,
  email                 text not null unique,
  phone                 text,
  licence_type          text,                            -- 'NECA' (NSW), 'ESV' (VIC), 'QBCC' (QLD), etc.
  licence_state         text,
  licence_number        text,
  stripe_account_id     text unique,                     -- 'acct_…' from Stripe Connect, null while platform-direct
  stripe_onboarded_at   timestamptz,                     -- set when Connect onboarding completes
  default_deposit_pct   numeric(5,2) default 30,         -- % of total taken upfront
  available_slots       jsonb default '[]'::jsonb,       -- ['2026-05-02T09:00:00+10:00', ...]
  created_at            timestamptz default now()
);

-- Payments — one row per Stripe charge attempt (success or fail)
create table if not exists payments (
  id                          uuid primary key default gen_random_uuid(),
  quote_id                    uuid references quotes(id) on delete cascade,
  tradie_id                   uuid references tradies(id),
  stripe_payment_intent_id    text unique,                       -- 'pi_…'
  stripe_charge_id            text,                              -- 'ch_…'
  amount_inc_gst              numeric(12,2),                     -- in dollars
  platform_fee_inc_gst        numeric(12,2),                     -- QuoteMate's cut
  status                      text,                              -- 'pending'|'succeeded'|'failed'|'refunded'
  created_at                  timestamptz default now(),
  succeeded_at                timestamptz,
  refunded_at                 timestamptz
);

create index if not exists idx_payments_quote_id    on payments(quote_id);
create index if not exists idx_payments_tradie_id   on payments(tradie_id);
create index if not exists idx_tradies_stripe_acct  on tradies(stripe_account_id) where stripe_account_id is not null;

-- RLS for the new tables (deny-by-default; service_role bypasses)
alter table tradies  enable row level security;
alter table payments enable row level security;
