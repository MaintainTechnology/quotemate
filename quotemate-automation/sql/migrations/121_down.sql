-- ════════════════════════════════════════════════════════════════════════
-- Migration 121 — DOWN (rollback of the clarifying_questions backfill).
--
-- Reverses: 121_clarifying_questions_backfill.sql, which populated
-- shared_assemblies.clarifying_questions (from empty → an authored array) for
-- a fixed set of electrical + plumbing rows (the 2 confirmed prod gaps plus
-- the dev-superset rows). This down migration sets clarifying_questions back
-- to NULL for exactly those rows.
--
-- SURGICAL MATCH — never nulls an owner-edited value:
--   Each UPDATE is keyed by the SAME (trade, name) the forward statement used
--   AND guarded by  clarifying_questions = <the exact authored array> (built
--   here with the identical jsonb_build_array(...) and compared as jsonb).
--   If a row's questions were edited by an owner after the backfill, the
--   guard fails to match and the row is LEFT ALONE — we only un-do values
--   this migration itself wrote.
--
-- IRREVERSIBILITY CAVEAT:
--   The forward migration only wrote into rows whose clarifying_questions was
--   empty (null / '[]' / 'null'), so NULL is the correct pre-121 state to
--   restore. NB: the forward emptiness guard treated null, '[]', and the
--   jsonb 'null' literal as equivalent; this down normalises every reverted
--   row to SQL NULL. For a true row-for-row restore of the original empty
--   form, use the runner's pre-apply snapshot
--       shared_assemblies_backup_mig121
--   (created by scripts/run-migration-121.mjs on the forward path).
--
-- Idempotent: re-running affects 0 rows once the targets are NULL again.
-- Apply with: node --env-file=.env.local scripts/run-migration-121.mjs --rollback
-- ════════════════════════════════════════════════════════════════════════

-- ── ELECTRICAL · gpo (the 2 confirmed prod gaps) ────────────────────────

-- Install 20A dedicated GPO
update public.shared_assemblies
   set clarifying_questions = null
 where trade = 'electrical'
   and name = 'Install 20A dedicated GPO'
   and clarifying_questions = jsonb_build_array(
         'What appliance is the dedicated 20A point for, and which room is it going in?',
         'How many dedicated points do you need?',
         'Roughly how far is the location from the switchboard?',
         'If it is a bathroom, ensuite, laundry or kitchen - is the point at least 600mm from any basin, sink, shower or bath?'
       );

-- Install 32A three-phase outlet
update public.shared_assemblies
   set clarifying_questions = null
 where trade = 'electrical'
   and name = 'Install 32A three-phase outlet'
   and clarifying_questions = jsonb_build_array(
         'What three-phase appliance or equipment is the outlet for (EV charger, workshop machine, commercial oven)?',
         'Is the property already on three-phase supply, or single-phase only / not sure?',
         'Which room or area is the outlet going in, and how far is it from the switchboard?'
       );

-- ── DEV-SUPERSET rows (no-op on prod — already populated) ────────────────

-- electrical · downlight (Install LED downlight, Replace LED downlight)
update public.shared_assemblies
   set clarifying_questions = null
 where trade = 'electrical'
   and name in ('Install LED downlight', 'Replace LED downlight')
   and clarifying_questions = jsonb_build_array(
         'How many downlights, and in which room?',
         'Ceiling type - flat plaster, raked, cathedral, or sheet metal?',
         'Replacing existing downlights, or new install (no fittings there now)?',
         'Any colour or feature preference - warm white, cool white, tri-colour, dimmable, or smart Wi-Fi?'
       );

-- electrical · fan
update public.shared_assemblies
   set clarifying_questions = null
 where trade = 'electrical'
   and name in ('Install customer-supplied ceiling fan',
                'Install premium DC fan with wall control',
                'Supply + install AC ceiling fan')
   and clarifying_questions = jsonb_build_array(
         'How many fans, and in which room?',
         'Do you already have the fan, or do you want us to supply it?',
         'Is there an existing ceiling rose / light point at the spot, or completely new wiring?'
       );

-- electrical · smoke_alarm
update public.shared_assemblies
   set clarifying_questions = null
 where trade = 'electrical'
   and name = 'Hardwire 240V smoke alarm'
   and clarifying_questions = jsonb_build_array(
         'How many alarms (or how many bedrooms if doing a full compliance install)?',
         'Replacing existing alarms, or first installation?'
       );

-- electrical · outdoor_light
update public.shared_assemblies
   set clarifying_questions = null
 where trade = 'electrical'
   and name = 'Install outdoor IP-rated LED light'
   and clarifying_questions = jsonb_build_array(
         'How many fittings, and where (eaves, deck, garden path)?',
         'Do you want a sensor / motion-activated, or always-on?',
         'Is there an existing outdoor circuit nearby, or does new power need running out there?'
       );

-- electrical · gpo (Replace double GPO, dev only)
update public.shared_assemblies
   set clarifying_questions = null
 where trade = 'electrical'
   and name = 'Replace double GPO'
   and clarifying_questions = jsonb_build_array(
         'How many GPOs, and in which room?',
         'Replacing existing GPOs, adding near existing power, or a brand-new run from the switchboard?',
         'If it is a bathroom, ensuite, laundry or kitchen - is the GPO at least 600mm from any basin, sink, shower or bath?'
       );

-- plumbing · drain
update public.shared_assemblies
   set clarifying_questions = null
 where trade = 'plumbing'
   and name in ('Hand rod blocked drain', 'Jet blast blocked drain')
   and clarifying_questions = jsonb_build_array(
         'Which drain is blocked (kitchen sink, bathroom basin, shower, toilet, or external)?',
         'Is it slow draining or completely blocked?'
       );

-- plumbing · hot_water
update public.shared_assemblies
   set clarifying_questions = null
 where trade = 'plumbing'
   and name in ('Install electric HWS', 'Install gas HWS', 'Install heat pump HWS')
   and clarifying_questions = jsonb_build_array(
         'Current system type - electric storage, gas storage, continuous-flow gas, or heat pump?',
         'Roughly what size / capacity (e.g. 250L, 315L, or not sure)?',
         'Where is it located (laundry, outside back wall, roof, garage)?'
       );

-- plumbing · tap (Tap replacement)
update public.shared_assemblies
   set clarifying_questions = null
 where trade = 'plumbing'
   and name = 'Tap replacement'
   and clarifying_questions = jsonb_build_array(
         'Which tap (kitchen, basin, laundry, outdoor)?',
         'Are you supplying the tapware, or do you want the plumber to supply?'
       );

-- plumbing · tap (Tap washer replacement)
update public.shared_assemblies
   set clarifying_questions = null
 where trade = 'plumbing'
   and name = 'Tap washer replacement'
   and clarifying_questions = jsonb_build_array(
         'Which tap (kitchen, basin, laundry, outdoor)?',
         'Is it dripping, leaking from the body, or stuck?'
       );

-- plumbing · toilet (Toilet cistern repair)
update public.shared_assemblies
   set clarifying_questions = null
 where trade = 'plumbing'
   and name = 'Toilet cistern repair'
   and clarifying_questions = jsonb_build_array(
         'Which toilet (main, ensuite, second bathroom)?',
         'Symptom - constantly running, leaking at the base, or will not flush?'
       );

-- plumbing · toilet (Toilet suite install)
update public.shared_assemblies
   set clarifying_questions = null
 where trade = 'plumbing'
   and name = 'Toilet suite install'
   and clarifying_questions = jsonb_build_array(
         'Which toilet (main, ensuite)?',
         'Style preference - standard close-coupled, wall-faced, or in-wall cistern?',
         'Are you supplying the suite, or do you want the plumber to supply?'
       );

notify pgrst, 'reload schema';
