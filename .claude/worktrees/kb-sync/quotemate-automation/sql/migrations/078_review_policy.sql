-- Migration 078 · Tradie review-before-send policy
--
-- Adds two columns to pricing_book so each tenant can pick whether
-- drafted quotes auto-send to the customer (today's behaviour) or
-- wait for the tradie's approval first.
--
-- Three policies:
--   'auto_send'              — quotes go straight to the customer (default,
--                              matches the live system pre-migration)
--   'always_review'          — every quote waits for tradie approval
--                              before customer SMS fires
--   'review_over_threshold'  — quotes whose total_inc_gst >= the threshold
--                              wait; smaller quotes auto-send
--
-- review_threshold_inc_gst is only meaningful when review_policy =
-- 'review_over_threshold'. Stored on every pricing_book row so multi-
-- trade tradies get one policy across all their trades (set once in the
-- dashboard's Pricing tab, fanned out via /api/tenant/me PATCH — same
-- pattern as quote_display in migration 071).
--
-- Storage model mirrors migration 071's quote_display:
--   • NOT NULL with sensible default (auto_send, 0)
--   • CHECK constraint on the policy enum so the dashboard form +
--     downstream code can rely on the union being exhaustive
--   • Idempotent guards so the migration is safe to re-run

begin;

alter table public.pricing_book
  add column if not exists review_policy text
  not null
  default 'auto_send';

alter table public.pricing_book
  add column if not exists review_threshold_inc_gst numeric(10,2)
  not null
  default 0;

-- Policy enum guard
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.pricing_book'::regclass
      and conname  = 'pricing_book_review_policy_check'
  ) then
    alter table public.pricing_book
      add constraint pricing_book_review_policy_check
      check (review_policy in ('auto_send', 'always_review', 'review_over_threshold'));
  end if;
end $$;

-- Threshold sanity — non-negative. Zero is meaningful for the
-- always_review case (it's not used) and for auto_send (same).
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.pricing_book'::regclass
      and conname  = 'pricing_book_review_threshold_check'
  ) then
    alter table public.pricing_book
      add constraint pricing_book_review_threshold_check
      check (review_threshold_inc_gst >= 0);
  end if;
end $$;

-- Belt-and-braces backfill for any rows that slipped in with null
-- (the default should prevent this; the update is a no-op if the
-- defaults applied cleanly).
update public.pricing_book
  set review_policy = 'auto_send'
  where review_policy is null;

update public.pricing_book
  set review_threshold_inc_gst = 0
  where review_threshold_inc_gst is null;

-- ─── Quotes table — 'awaiting_tradie_approval' is now a valid status ─
--
-- The status column is unconstrained text in the current schema
-- (per init.sql / migration history) so no enum widening is required.
-- We document the new value here and add an index for fast lookups
-- ("show me everything waiting for my approval") on the dashboard.

create index if not exists quotes_awaiting_approval_idx
  on public.quotes (tenant_id, created_at desc)
  where status = 'awaiting_tradie_approval';

commit;
