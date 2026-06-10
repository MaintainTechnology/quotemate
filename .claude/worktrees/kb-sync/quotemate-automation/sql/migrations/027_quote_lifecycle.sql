-- ════════════════════════════════════════════════════════════════════
-- Migration 027 — reliable quote lifecycle + VA follow-up support (WP7)
--
-- (024 = pricing_book unique index, 025 = pricing_book.tenant_id NOT
--  NULL, 026 = WP6 price-hold/booking_state. 027 is the next free
--  number; WP7 is independent of those.)
--
-- Build brief: docs/wp7-implementation-brief.md (John's list item 10).
--
-- Problem: the quote `status` column is free text defaulting to 'draft'
-- and the lifecycle timestamps (sent_at / viewed_at / paid_at /
-- accepted_at) are only partially written, so today you cannot reliably
-- tell who received a quote but did not accept it (the data shows 0
-- accepted quotes). WP7 needs the lifecycle reliable enough to
-- distinguish sent / viewed / paid / accepted before a follow-up queue
-- can be trusted.
--
-- Canonical status ladder (monotonic — see lib/quote/lifecycle.ts):
--     draft (0) < sent (1) < viewed (2) < paid (3) < accepted (4)
-- Legacy / unknown values (e.g. 'inspection') are tolerated everywhere
-- and never crash the app; they simply rank below 'draft' so a real
-- lifecycle event can still advance them forward.
--
-- This migration is ADDITIVE and IDEMPOTENT only:
--   • new columns are `add column if not exists`
--   • the index is `create index if not exists` (NON-partial, NON-unique
--     — partial/unique indexes can't be inferred by PostgREST upserts;
--     see migration 024 for the lesson)
--   • backfill updates only ever UPGRADE a row's status (never regress a
--     paid/accepted quote) and only fill NULL last_status_at
-- ════════════════════════════════════════════════════════════════════

-- ── 1. New columns ────────────────────────────────────────────────
-- last_status_at: single sortable "last activity" timestamp, bumped on
-- every lifecycle transition by lib/quote/lifecycle.ts. Lets the
-- follow-up queue order by staleness with one column instead of
-- coalescing four timestamps at query time.
alter table quotes
  add column if not exists last_status_at timestamptz;

-- VA-workflow columns (additive, nullable). followed_up_at is set when a
-- human VA marks a follow-up as actioned (drives "leave room for
-- automation, human workflow first"). followup_note is free-form.
alter table quotes
  add column if not exists followed_up_at timestamptz;
alter table quotes
  add column if not exists followup_note text;

-- ── 2. Backfill status from existing timestamps (UPGRADE-ONLY) ─────
-- Classify historical rows so the follow-up queue is meaningful from
-- day one. Each statement only moves a row UP the ladder, and never
-- past a state a higher timestamp already implies, so a paid/accepted
-- quote is never downgraded.
update quotes
   set status = 'accepted'
 where accepted_at is not null
   and status is distinct from 'accepted';

update quotes
   set status = 'paid'
 where paid_at is not null
   and accepted_at is null
   and status not in ('accepted');

update quotes
   set status = 'viewed'
 where viewed_at is not null
   and paid_at is null
   and accepted_at is null
   and status not in ('accepted', 'paid');

update quotes
   set status = 'sent'
 where sent_at is not null
   and viewed_at is null
   and paid_at is null
   and accepted_at is null
   and status not in ('accepted', 'paid', 'viewed');

-- ── 3. Backfill last_status_at = newest known lifecycle timestamp ──
-- Postgres GREATEST() skips NULLs (returns NULL only if all are NULL);
-- created_at has a default of now() so the result is effectively never
-- NULL for a real row.
update quotes
   set last_status_at = greatest(
         accepted_at,
         paid_at,
         viewed_at,
         sent_at,
         created_at
       )
 where last_status_at is null;

-- ── 4. Follow-up query index ──────────────────────────────────────
-- The needs-follow-up view filters by tenant + status and orders by
-- age. A plain composite btree covers it. NON-unique, NON-partial on
-- purpose (idempotent + safe as a future ON CONFLICT/seek target).
create index if not exists quotes_followup_idx
  on quotes (tenant_id, status, created_at);

-- Secondary index for "order by staleness" within a tenant.
create index if not exists quotes_last_status_at_idx
  on quotes (tenant_id, last_status_at);
