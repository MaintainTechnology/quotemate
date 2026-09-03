-- ═══════════════════════════════════════════════════════════════════
-- Migration 194 — the post-visit money chain: parent_quote_id + quote_kind.
--
-- NUMBERING: the spec (specs/post-visit-money-sequence.md R1) calls this
-- migration 193. 193 was already taken by 193_quotes_inspection_cause.sql
-- (+ its 193_down.sql and runner) before this landed, so the chain took the
-- next free number. Nothing else about R1 changes.
--
-- One customer charge per quotes row is structural in this codebase:
-- finalisePaidQuote claims with .is('paid_at', null) and the Stripe webhook
-- skips any session for a row that already has paid_at. So a job is not one
-- row that gets paid three times — it is a CHAIN of rows:
--
--   initial  — the $99 site visit (unchanged, this is every row today)
--     └─ final    — the confirmed quote; the customer pays the job-type
--                   deposit less the $99 already paid
--          └─ balance — the remainder, requested by the tradie on the job
--
-- parent_quote_id links a child to the row above it; ON DELETE SET NULL
-- because losing the parent must never cascade away a row that holds real
-- money. quote_kind defaults to 'initial' so every existing row keeps
-- exactly today's behaviour and no reader changes meaning on deploy.
--
-- WHY THE PARTIAL UNIQUE INDEX IS THE WHOLE POINT:
-- quotes_open_child_uniq IS the idempotency guarantee for the "Issue final
-- quote" and "Request final payment" tradie buttons. Both are one tap on a
-- phone, on a job site, on flaky reception — the double-click is not an edge
-- case, it is the normal case. Those routes INSERT first and catch 23505,
-- rather than read-then-insert (which races with itself). The DB is the only
-- place that check can be atomic, so at most one UNPAID child of each kind
-- can exist per parent; once a child is paid it leaves the index and the
-- next one in the chain may be created.
--
-- The `parent_quote_id is not null` term in the WHERE is intent, not
-- correctness: Postgres already treats NULLs as distinct in a unique index,
-- so the thousands of unpaid legacy rows (parent_quote_id NULL, kind
-- 'initial') would not collide with each other even without it. It is
-- spelled out so nobody reading this later has to reason about NULL
-- semantics to convince themselves the migration is safe on live data.
--
-- ⚠ sql/init.sql's quotes DDL is NOT prod schema and must never be treated
-- as such. It already lacks share_token, paid_at, paid_tier, deposit_pct and
-- tenant_id — those live in sql/02_stages_06_10_partial.sql,
-- sql/04_f3_finish.sql and later numbered migrations. Both columns below are
-- mirrored into init.sql per the repo rule, but the index is not: it is
-- partial on paid_at, a column init.sql does not have.
--
-- Idempotent: add-if-missing columns, if-not-exists index, and the CHECK is
-- created only when it is absent (mirrors migration 193's pattern).
-- ═══════════════════════════════════════════════════════════════════

alter table public.quotes
  add column if not exists parent_quote_id uuid references public.quotes(id) on delete set null;

alter table public.quotes
  add column if not exists quote_kind text not null default 'initial';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'quotes_quote_kind_check'
  ) then
    alter table public.quotes
      add constraint quotes_quote_kind_check
      check (quote_kind in ('initial', 'final', 'balance'));
  end if;
end $$;

create unique index if not exists quotes_open_child_uniq
  on public.quotes (parent_quote_id, quote_kind)
  where paid_at is null and parent_quote_id is not null;

comment on column public.quotes.parent_quote_id is
  'Chain link to the quote above this one: initial ($99 site visit) -> final (deposit) -> balance. NULL for chain roots. See migration 194.';

comment on column public.quotes.quote_kind is
  'Which charge this row carries: initial | final | balance. Defaults to initial so every legacy row keeps its current behaviour. See migration 194.';

comment on index public.quotes_open_child_uniq is
  'At most one UNPAID child of each kind per parent. This is the idempotency guarantee for the Issue-final-quote / Request-final-payment buttons: a double tap becomes a 23505 the route catches and answers with the existing child, never a second row.';

notify pgrst, 'reload schema';
