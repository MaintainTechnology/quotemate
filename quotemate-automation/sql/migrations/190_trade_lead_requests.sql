-- Migration 190 · trade_lead_requests — one self-serve quote-request form, every trade
--
-- Spec: specs/generic-quote-request-form.md §1 (Database).
--
-- One row per offered self-serve form link, for ANY trade. The unguessable
-- token is the unique segment of the SMS'd form URL (/quote-request/[token]);
-- on submit the form runs that trade's estimate path.
--
-- This mirrors painting_lead_requests (migration 154) plus a `trade` column,
-- so the four receptionists (roofing, electrical, plumbing, painting) share
-- one table instead of one table each.
--
-- ⚠ painting_lead_requests is DELIBERATELY UNTOUCHED. Painting keeps working
-- on its own table until this one is proven; a follow-up spec retires it.
-- Nothing here reads, writes, backfills or migrates that table.
--
-- Additive only; no data backfill. Idempotent.

create table if not exists public.trade_lead_requests (
  -- crypto.randomBytes(16).toString('hex') at mint time — 32 hex chars.
  token            text primary key,
  -- electrical | plumbing | roofing | painting. NOT NULL, but deliberately
  -- NOT a check constraint: a new trade is a `trades` registry row + admin CSV
  -- load (docs/strategy.md v9), never a code — or schema — change. A check
  -- here would make every new trade need a migration.
  trade            text not null,
  tenant_id        uuid,
  conversation_id  uuid,
  customer_phone   text,
  -- pending   → form link sent, not yet filled in
  -- submitted → customer filled it in (one-shot; the link is spent)
  -- expired   → link retired without a submission
  -- Constrained in the DB because the status vocabulary is a fixed lifecycle,
  -- not data. painting_lead_requests left it unconstrained and drifted: its
  -- mint writes 'pending', suggest-address 410s on anything but 'pending',
  -- its POST rejects only 'submitted', and a test seeds 'new' — a value that
  -- passes one gate and fails the other. One enum, enforced once, ends that.
  status           text not null default 'pending'
                     check (status in ('pending', 'submitted', 'expired')),
  -- the quote token the submitted form produced (per-trade: quotes.public_token,
  -- roofing_measurements.public_token, painting_measurements.public_token …).
  quote_token      text,
  created_at       timestamptz not null default now(),
  submitted_at     timestamptz
);

-- RLS on, no policies. The table holds customer_phone, so it must not be
-- readable with the anon key via PostgREST. Every route that touches it uses
-- SUPABASE_SERVICE_ROLE_KEY (which bypasses RLS), exactly like the painting
-- form routes — tenancy stays app-layer + token-gated. Deny-by-default here
-- costs nothing and closes the anon read that painting_lead_requests leaves
-- open. If a browser-side client ever needs this table, add a policy then.
alter table public.trade_lead_requests enable row level security;

-- Tenant's recent leads (dashboard / ops listing).
create index if not exists trade_lead_requests_tenant_idx
  on public.trade_lead_requests (tenant_id, created_at desc);

-- Sweeping pending links (expiry job) and counting submissions.
create index if not exists trade_lead_requests_status_idx
  on public.trade_lead_requests (status);

-- CRITICAL: refresh PostgREST's schema cache so supabase-js (every route) can
-- read/write the new table immediately. Without this, writes are silently
-- dropped with PGRST204 — the trap migrations 085 and 154 both document; it is
-- what made the roofing receptionist lose its memory.
notify pgrst, 'reload schema';

do $$
declare
  has_table boolean;
  idx_count integer;
begin
  select exists (
    select 1 from information_schema.tables
     where table_schema = 'public' and table_name = 'trade_lead_requests'
  ) into has_table;
  if not has_table then
    raise exception 'migration 190 failed: trade_lead_requests missing';
  end if;

  select count(*) into idx_count
    from pg_indexes
   where schemaname = 'public'
     and tablename = 'trade_lead_requests'
     and indexname in ('trade_lead_requests_tenant_idx', 'trade_lead_requests_status_idx');
  if idx_count <> 2 then
    raise exception 'migration 190 failed: expected 2 indexes, found %', idx_count;
  end if;

  raise notice 'migration 190: trade_lead_requests created with % index(es). '
               'painting_lead_requests untouched.', idx_count;
end $$;
