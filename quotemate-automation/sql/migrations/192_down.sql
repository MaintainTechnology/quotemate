-- ═══════════════════════════════════════════════════════════════════
-- Migration 192 DOWN — remove only the untouched provisional EV row.
--
-- Every seeded value and the unique sentinel note must still match. If Jon or
-- an operator has adjusted/replaced the bound, rollback intentionally leaves
-- that authoritative row in place.
-- ══════════════════════════════════════════════════════════════════

delete from public.job_type_bounds
where trade = 'electrical'
  and job_type = 'ev_charger'
  and max_labour_hours = 10.0
  and min_total_ex_gst = 400.0
  and max_total_ex_gst = 6000.0
  and per_unit_labour_hours is null
  and notes = 'PROVISIONAL_EV_CHARGER_BOUNDS_V1_2026-09-01 — confirm 10h / $400-$6,000 ex-GST with Jon before relying on this gate.';

notify pgrst, 'reload schema';
