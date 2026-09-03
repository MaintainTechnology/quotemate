-- ═══════════════════════════════════════════════════════════════════
-- Migration 193 — why a quote went to the inspection route.
--
-- `needs_inspection` says THAT a quote is inspection-routed; nothing said
-- WHY, so every inspection quote got the same customer copy:
--   "Every site is different - we can't price this safely without seeing
--    the work in person."
-- That sentence is true for a three-phase switchboard job. It is a lie when
-- the real cause was our own grounding validator rejecting a line the model
-- priced (live 2026-09-01, quote 7zNJCjsaxBOL_N3cATDNvQ: a fully priced EV
-- charger quote became a $99 site visit because an optional upsell carried a
-- price no catalogue row backs).
--
-- Values:
--   'site_conditions' — a genuine on-site rule fired (three-phase, mains,
--                       underground, switchboard risk, tradie's
--                       usuallyInspection job type). Site-conditions copy.
--   'model_declared'  — the structurer/estimator itself asked for a visit.
--                       Site-conditions copy (the model saw a real reason).
--   'grounding_failed'— internal validation problem. NEVER show
--                       site-conditions copy; this should be unreachable
--                       from the customer path since R3.2 holds such drafts
--                       for tradie review, and the column is the belt.
-- NULL = legacy rows written before this migration; treated as
-- 'site_conditions' by the readers so existing quotes render unchanged.
--
-- Idempotent: add-if-missing, and the CHECK is only created with the column.
-- ═══════════════════════════════════════════════════════════════════

alter table public.quotes
  add column if not exists inspection_cause text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'quotes_inspection_cause_check'
  ) then
    alter table public.quotes
      add constraint quotes_inspection_cause_check
      check (
        inspection_cause is null
        or inspection_cause in ('site_conditions', 'model_declared', 'grounding_failed')
      );
  end if;
end $$;

comment on column public.quotes.inspection_cause is
  'Why this quote is inspection-routed. Gates the customer-facing "Every site is different" copy: only site_conditions/model_declared/NULL may use it. See migration 193.';

notify pgrst, 'reload schema';
