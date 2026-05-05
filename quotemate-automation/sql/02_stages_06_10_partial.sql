-- ───────────────────────────────────────────────────────────────────
-- Partial F3 migration — only the columns needed for the SMS+Stripe
-- "v0.5 wedge" (deposit links sent in SMS, no portal page yet).
--
-- This is a STRATEGIC SHORTCUT versus the full F3 in the SOP. Columns
-- skipped here (routing_decision, viewed_at, accepted_tier, scheduled_at)
-- and tables skipped here (tradies, payments) belong to S06/S07/S10
-- proper and will be added when those stages are built.
--
-- Safe to re-run.
-- ───────────────────────────────────────────────────────────────────

alter table quotes add column if not exists share_token text unique;
  -- random URL-safe token, generated at quote insert time, used in Stripe success URL

alter table quotes add column if not exists stripe_links jsonb;
  -- { "good": "https://checkout.stripe.com/c/...", "better": "...", "best": "..." }
  -- one Stripe Checkout Session URL per tier; persisted so we can re-send SMS
  -- without recreating the Sessions.

alter table quotes add column if not exists deposit_pct numeric(5,2) default 30;
  -- % of total_inc_gst charged as a deposit on each Checkout Session.
  -- Will move to tradies.default_deposit_pct when F3 lands properly.

alter table quotes add column if not exists paid_at timestamptz;
  -- set when the Stripe webhook receives checkout.session.completed

alter table quotes add column if not exists paid_tier text;
  -- 'good' | 'better' | 'best' — which Checkout the customer paid

alter table quotes add column if not exists paid_stripe_session_id text;
  -- 'cs_test_...' — the Session ID that fired the paid event.
  -- doubles as an idempotency check inside the webhook handler.

create index if not exists idx_quotes_share_token on quotes(share_token) where share_token is not null;
create index if not exists idx_quotes_paid_session on quotes(paid_stripe_session_id) where paid_stripe_session_id is not null;
