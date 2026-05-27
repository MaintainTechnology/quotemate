-- ════════════════════════════════════════════════════════════════════
-- Migration 072 — relax three overly-broad inspection_triggers on
--                  shared_assemblies (Layer 3 of the inspection-router).
--
-- Incident (2026-05-27, intake 0b0c7785-...): James, Chandler office,
-- 1 customer-supplied premium DC ceiling fan, 3.2m flat plaster ceiling,
-- new install. Should have auto-quoted as a routine "new wiring" fan job.
-- Routed to a $99 inspection instead because:
--   • The intake structurer classified 3.2m as ceiling_type='high' and
--     wrote "high ceiling 3.2m - access equipment required" into risks[]
--   • The fan-new-wiring assembly's inspection_triggers array contained
--     the literal substring 'high ceiling'
--   • Layer 3's .toLowerCase().includes() match fired → forced inspection
--
-- The companion triggers (raked, cathedral, multi-storey, two-storey,
-- no roof access, no manhole, pre-1970, heavy fan, industrial fan) all
-- continue to catch genuinely-difficult fan installs. 'high ceiling' as
-- a bare substring is over-broad: a 3.2m office ceiling is routine
-- A-frame-ladder work for any sparky. Reserve "needs scaffold/scissor
-- lift" cases for the more specific triggers above.
--
-- Two adjacent downlight triggers reviewed at the same time:
--   • 'switch more than 5 metres' — 5m of cable is a routine run; forces
--     inspection on jobs that are well within "auto-quote" scope.
--   • 'no existing switch' — the assembly is literally named
--     "Install LED downlight (new install, single-storey)". By design
--     it handles the no-existing-switch case. The trigger contradicts
--     the row's own scope.
-- Both removed.
--
-- Operations (idempotent — array_remove is a no-op when the element
-- doesn't exist, so re-running matches the post-state of the first run):
--   1. shared_assemblies '9964b317-...' (Install ceiling fan, new wiring)
--      → remove 'high ceiling' from inspection_triggers
--   2. shared_assemblies '8b5f7b97-...' (Install LED downlight, new install)
--      → remove 'switch more than 5 metres' AND 'no existing switch'
--
-- Not touched (verified by scripts/diagnose-james-fan-inspection.mjs):
--   • Smoke alarm "whole-house compliance" row — triggers all warranted
--   • Outdoor light "new circuit" row — triggers all warranted
--   • Layer 1 universal triggers in lib/sms/assumptions.ts — all warranted
--   • Layer 2 per-job_type triggers in lib/sms/assumptions.ts — all warranted
--
-- Apply with:
--   node --env-file=.env.local scripts/run-migration-072.mjs
-- ════════════════════════════════════════════════════════════════════

begin;

-- 1. Fan row — drop 'high ceiling'.
update shared_assemblies
   set inspection_triggers = array_remove(inspection_triggers, 'high ceiling')
 where id = '9964b317-9a5e-4938-b94c-5a63f6f8fe0c'
   and name = 'Install ceiling fan (new wiring, no existing rose)'
   and trade = 'electrical';

-- 2. Downlight new-install row — drop both over-broad triggers.
update shared_assemblies
   set inspection_triggers = array_remove(
         array_remove(inspection_triggers, 'switch more than 5 metres'),
         'no existing switch'
       )
 where id = '8b5f7b97-367a-431f-8838-0aca658cf21e'
   and name = 'Install LED downlight (new install, single-storey)'
   and trade = 'electrical';

-- Keep PostgREST's schema cache fresh (data-only change, but mirrors the
-- house pattern of every migration that touches catalogue rows).
notify pgrst, 'reload schema';

commit;
