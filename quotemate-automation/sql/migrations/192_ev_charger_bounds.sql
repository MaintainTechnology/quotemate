-- ═══════════════════════════════════════════════════════════════════
-- Migration 192 — provisional EV charger sanity bounds.
--
-- This is a deliberately broad gross-error guard, not a pricing source.
-- Product prices remain tenant-owned and are never seeded here. Jon must
-- confirm or replace these values before they are treated as final.
--
-- Idempotency and authority: an existing electrical/ev_charger row wins.
-- ON CONFLICT DO NOTHING prevents this provisional migration from replacing
-- a bound already supplied or adjusted by the tradie.
-- ═══════════════════════════════════════════════════════════════════

insert into public.job_type_bounds (
  trade,
  job_type,
  max_labour_hours,
  min_total_ex_gst,
  max_total_ex_gst,
  per_unit_labour_hours,
  notes
)
values (
  'electrical',
  'ev_charger',
  10.0,
  400.0,
  6000.0,
  null,
  'PROVISIONAL_EV_CHARGER_BOUNDS_V1_2026-09-01 — confirm 10h / $400-$6,000 ex-GST with Jon before relying on this gate.'
)
on conflict (trade, job_type) do nothing;

notify pgrst, 'reload schema';
