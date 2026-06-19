-- ════════════════════════════════════════════════════════════════════
-- Migration 127 — quotes observability columns (R7 + R27).
--
-- WHY: the deterministic-pricing build needs every quote to record HOW it
-- was priced and WHAT happened to it, so autonomy can be observed (R27:
-- "autonomy that cannot be observed cannot be responsibly sold") and so an
-- opus_fallback quote can be excluded from auto-send (R7).
--
-- This migration ADDs four observability columns to public.quotes:
--   • pricing_path     — how the price was produced. R7 persists this on
--                        every quotes row: 'deterministic' (recomputed from
--                        pricing_book + catalogue), 'opus_fallback' (LLM
--                        authored the number — NEVER auto-send-eligible), or
--                        'inspection' (routed to the $99 inspection). CHECK-
--                        constrained to that closed set. Default 'opus_fallback'
--                        is the SAFE default: pre-existing + un-stamped rows
--                        read as not-deterministic, so they can never be
--                        treated as auto-send-eligible by accident.
--   • routing_decision — the route chosen for the quote (text). NOTE: this
--                        column already exists on quotes from sql/04_f3_finish.sql;
--                        the `add column if not exists` below is therefore a
--                        deliberate idempotent no-op when it is already present
--                        (it is listed here for completeness per R27's
--                        "routing decision" surface). No type/default change is
--                        applied to the existing column.
--   • auto_sent        — boolean, default false. True only when the quote was
--                        autonomously sent to the customer (R27 "% auto-sent"
--                        and "0 ungrounded-sent" reporting).
--   • grounding_result — jsonb. The grounding validator's verdict for this
--                        quote (R10 tripwire output / R27 grounding surface).
--                        Nullable: NULL = not yet evaluated.
--
-- SAFETY: all four are ADDITIVE, nullable-or-defaulted columns. Adding a
-- column with a constant/NULL default does NOT rewrite or mutate existing
-- rows in Postgres — so this is treated as a DDL-ONLY change (no data
-- snapshot is taken by the runner; it logs 'DDL-only column add').
--
-- Idempotent: every ADD uses `add column if not exists`; the CHECK
-- constraint is added only when absent (guarded against pg_constraint).
-- NOT auto-applied to prod. Apply with:
--   node --env-file=.env.local scripts/run-migration-127.mjs
--   node --env-file=.env.local scripts/run-migration-127.mjs --rollback
-- ════════════════════════════════════════════════════════════════════

alter table public.quotes
  add column if not exists pricing_path text default 'opus_fallback';

alter table public.quotes
  add column if not exists routing_decision text;

alter table public.quotes
  add column if not exists auto_sent boolean default false;

alter table public.quotes
  add column if not exists grounding_result jsonb;

-- CHECK constraint on pricing_path's closed set. Added separately (not inline
-- on the ADD COLUMN) so it is guarded for idempotency: a re-run that already
-- has the constraint is a clean no-op. Named so 127_down.sql can drop it.
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'quotes_pricing_path_check'
       and conrelid = 'public.quotes'::regclass
  ) then
    alter table public.quotes
      add constraint quotes_pricing_path_check
      check (pricing_path in ('deterministic', 'opus_fallback', 'inspection'));
  end if;
end$$;

comment on column public.quotes.pricing_path is
  'R7/R27 — how the price was produced: deterministic | opus_fallback | inspection. opus_fallback is NEVER auto-send-eligible. Default opus_fallback is the safe default for pre-existing/un-stamped rows.';
comment on column public.quotes.auto_sent is
  'R27 — true only when this quote was autonomously sent to the customer (% auto-sent / 0 ungrounded-sent reporting).';
comment on column public.quotes.grounding_result is
  'R10/R27 — grounding validator verdict for this quote (jsonb). NULL = not yet evaluated.';

notify pgrst, 'reload schema';
