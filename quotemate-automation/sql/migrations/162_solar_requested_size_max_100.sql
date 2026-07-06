-- QuoteMate · migration 162 — realign solar requested-size ceiling to 100 kW
-- (fix 2026-07-06).
--
-- Migration 116 defined solar_estimates.requested_system_kw with a
-- CHECK (... <= 100), and the app's Zod schema + form accept up to 100 kW.
-- The LIVE production DB, however, had drifted to a CHECK (... <= 30):
-- any preferred size in (30, 100] passed client + Zod validation, ran the
-- engine, then FAILED the solar_estimates INSERT with a check violation.
-- The route returned `estimate_insert_failed` → the customer saw the
-- misleading "We could not save your estimate just now." Only <=30 kW
-- selections (e.g. the 6/10/14 kW chips) saved.
--
-- This migration re-asserts the intended ceiling so a fresh migration chain
-- AND the drifted production DB both converge on the single source of truth
-- (lib/solar/limits.ts → MAX_REQUESTED_SYSTEM_KW = 100). Idempotent /
-- re-entrant: drop the old constraint (whatever bound it carried) and add
-- the 100 kW bound.

alter table public.solar_estimates
  add column if not exists requested_system_kw numeric;

alter table public.solar_estimates
  drop constraint if exists solar_estimates_requested_system_kw_check;

-- Belt-and-suspenders: clamp any pre-existing row above the new ceiling so
-- the constraint validates cleanly (none expected — the old cap was lower).
update public.solar_estimates
   set requested_system_kw = 100
 where requested_system_kw is not null
   and requested_system_kw > 100;

alter table public.solar_estimates
  add constraint solar_estimates_requested_system_kw_check
    check (requested_system_kw is null
           or (requested_system_kw > 0 and requested_system_kw <= 100));

-- Refresh PostgREST's schema cache so supabase-js reads the new bound
-- immediately (mirrors migrations 100/101/116/117).
notify pgrst, 'reload schema';
