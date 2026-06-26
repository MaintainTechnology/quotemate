-- ════════════════════════════════════════════════════════════════════
-- Migration 153 — tenant welcome-email idempotency stamp.
--
-- WHY: when a freshly-onboarded tradie reaches the dashboard we send a
-- one-time introduction/welcome email (lib/email/welcome.ts) via Resend.
-- This column is the single-send guard: the send path claims the row by
-- flipping NULL → now() in one conditional UPDATE, so concurrent dashboard
-- loads (or repeated visits) can never send the email twice.
--
-- WHAT IT DOES:
--   1. adds one additive, nullable timestamptz column to public.tenants.
--   2. back-fills it for tenants that are ALREADY active, so existing
--      tradies who onboarded before this feature are treated as
--      "already welcomed" and never receive a retroactive blast. Tenants
--      still in 'onboarding' stay NULL so they DO get the email when they
--      activate and first open the dashboard.
--
-- DDL-only, idempotent (add column IF NOT EXISTS). NOT auto-applied to prod.
-- Apply:
--   node --env-file=.env.local scripts/run-migration-153.mjs
--   node --env-file=.env.local scripts/run-migration-153.mjs --rollback
-- ════════════════════════════════════════════════════════════════════

alter table public.tenants
  add column if not exists welcome_email_sent_at timestamptz;

-- Backfill ONLY already-active tenants → mark them as previously welcomed so
-- the feature never emails an existing tradie retroactively. Onboarding rows
-- intentionally stay NULL so they receive the email on first dashboard visit
-- after activation.
update public.tenants
   set welcome_email_sent_at = coalesce(activated_at, now())
 where welcome_email_sent_at is null
   and status = 'active';

comment on column public.tenants.welcome_email_sent_at is
  'When the one-time onboarding welcome email was sent (lib/email/welcome.ts). NULL = not yet sent. The send path claims the row with a conditional NULL→now() UPDATE so the email is sent at most once per tenant.';

notify pgrst, 'reload schema';
