-- Migration 079 · Customer 2-hour follow-up check-in
--
-- Adds two things:
--
--   1. quotes.followup_2h_sent_at — idempotency marker for the cron
--      sweep. Stamped when the auto check-in SMS is sent for THIS quote.
--      Per-quote (not per-customer) so a customer who got 5 quotes
--      receives 5 separate check-ins (one per quote — feature brief is
--      explicit on this).
--
--   2. pricing_book.followup_2h_enabled — per-tenant on/off toggle.
--      Default FALSE — opt-in. Mirrors migration 078 (review_policy):
--      scalar boolean column on every pricing_book row this tenant owns,
--      fanned out by /api/tenant/me PATCH so multi-trade tradies see one
--      preference across their trades. Trade-agnostic.
--
-- Partial index supports the cron query's hot path: scan only quotes
-- that have been delivered (sent or viewed) and haven't been followed-
-- up yet. Without it, every cron tick full-scans the quotes table.
--
-- NOT auto-applied. Apply with:
--   node --env-file=.env.local scripts/run-migration-079.mjs --apply

begin;

-- 1. quotes.followup_2h_sent_at — idempotency marker (NULL = never sent)
alter table public.quotes
  add column if not exists followup_2h_sent_at timestamptz;

-- 2. pricing_book.followup_2h_enabled — per-tenant on/off (default OFF)
alter table public.pricing_book
  add column if not exists followup_2h_enabled boolean
  not null
  default false;

-- Belt-and-braces backfill for any rows that slipped in with null
-- (the default should prevent this; the update is a no-op if defaults
-- applied cleanly — same pattern as migration 078).
update public.pricing_book
  set followup_2h_enabled = false
  where followup_2h_enabled is null;

-- 3. Hot-path index for the every-15-min cron sweep. WHERE clause
--    matches the cron query precisely so the planner picks it. status
--    is unconstrained text in init.sql, so the IN list is the safe
--    filter shape (no enum casting).
create index if not exists quotes_followup_2h_pending_idx
  on public.quotes (sent_at)
  where followup_2h_sent_at is null
    and status in ('sent', 'viewed')
    and sent_at is not null
    and paid_at is null
    and accepted_at is null
    and needs_inspection is not true;

commit;
