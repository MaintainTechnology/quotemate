-- QuoteMate — migration 121 — clarifying_questions backfill (R23, 2026-06-18)
-- ════════════════════════════════════════════════════════════════════════
-- WHY
--   shared_assemblies.clarifying_questions is the per-row MUST-ASK script the
--   SMS dialog injects (lib/sms/dialog.ts → customServicesDirective →
--   fmtWithQuestions, migration 032). When the array is empty the dialog
--   falls back to the universal name+suburb+scope fields only, so any
--   scope-bearing job-type gap silently flows to a safe default — which
--   violates the SAFE-DEFAULT rule (R29: never apply a safe default without
--   first attempting to capture the field via a clarifying question).
--
-- CONFIRMED STATE (prod read-only, SUPABASE_DB_URL, 2026-06-18)
--   electrical + plumbing = 49 rows. EXACTLY 2 had empty (jsonb null)
--   clarifying_questions, both AUTO-QUOTE (default_enabled=true,
--   always_inspection=false, retired_at IS NULL), both category 'gpo':
--     • Install 20A dedicated GPO         (id …a0e5e20)
--     • Install 32A three-phase outlet    (id …a0e5e32)
--   All 23 plumbing rows already carried questions. The earlier
--   "mostly NULL" framing was STALE — the real gap was these 2 rows only.
--
--   The DEV DB (SUPABASE_DEVELOPMENT_DB_URL) is behind prod: 43 rows, no
--   always_inspection column, 16 empty rows (column never backfilled in
--   dev). This migration is therefore keyed by NAME (not prod UUID) and
--   guarded on emptiness, so it is idempotent and correct on BOTH DBs:
--   it populates only rows whose clarifying_questions is null/'[]'/'null'
--   and whose name matches one of the authored sets below; rows that
--   already carry questions are never overwritten.
--
-- SOURCE OF QUESTION TEXT
--   Derived from lib/sms/assumptions.ts mustAsk[] for the matching job_type
--   (power_points → gpo rows; downlights, ceiling_fans, smoke_alarms,
--   outdoor_lighting; blocked_drain, hot_water, tap_*, toilet_*), re-phrased
--   into the customer-facing SMS style already used by sibling rows
--   (e.g. "Replace double GPO", "Install aircon power point"). Plain hyphens
--   only, contractions, one question per array element.
--
-- VERIFICATION TARGET (R23)
--   ZERO auto-quote (default_enabled=true, always_inspection IS NOT TRUE,
--   retired_at IS NULL) electrical/plumbing rows with empty
--   clarifying_questions. See scripts/run-migration-121.mjs assertion.
--
-- SAFETY
--   • No pricing / currency / labour columns touched here (R23 is data-only
--     backfill of the question script). R29 audit findings that warrant a
--     value change are handled separately and flagged to the owner — none
--     were unambiguous enough to auto-correct (see
--     docs/markdown/service-content-audit.md).
--   • Idempotent: the WHERE emptiness guard means a second run affects 0
--     rows. Verified via BEGIN; … ROLLBACK; on the dev DB.
-- ════════════════════════════════════════════════════════════════════════

-- Reusable emptiness predicate, inlined per statement:
--   clarifying_questions IS NULL
--   OR clarifying_questions::text = '[]'
--   OR clarifying_questions::text = 'null'

-- ── ELECTRICAL · gpo (the 2 confirmed prod gaps) ────────────────────────

-- Install 20A dedicated GPO — a new dedicated appliance circuit from the
-- switchboard. From power_points mustAsk: count, room, install kind,
-- wet-area 600mm. Tailored for the dedicated-appliance framing.
update public.shared_assemblies
   set clarifying_questions = jsonb_build_array(
         'What appliance is the dedicated 20A point for, and which room is it going in?',
         'How many dedicated points do you need?',
         'Roughly how far is the location from the switchboard?',
         'If it is a bathroom, ensuite, laundry or kitchen - is the point at least 600mm from any basin, sink, shower or bath?'
       )
 where trade = 'electrical'
   and name = 'Install 20A dedicated GPO'
   and (clarifying_questions is null
        or clarifying_questions::text = '[]'
        or clarifying_questions::text = 'null');

-- Install 32A three-phase outlet — three-phase appliance / EV / workshop.
-- Three-phase also trips a universal inspection trigger in the dialog
-- (assumptions.ts UNIVERSAL_INSPECTION_TRIGGERS), but the ROW is enabled +
-- not always_inspection, so it still needs its MUST-ASK script populated.
update public.shared_assemblies
   set clarifying_questions = jsonb_build_array(
         'What three-phase appliance or equipment is the outlet for (EV charger, workshop machine, commercial oven)?',
         'Is the property already on three-phase supply, or single-phase only / not sure?',
         'Which room or area is the outlet going in, and how far is it from the switchboard?'
       )
 where trade = 'electrical'
   and name = 'Install 32A three-phase outlet'
   and (clarifying_questions is null
        or clarifying_questions::text = '[]'
        or clarifying_questions::text = 'null');

-- ════════════════════════════════════════════════════════════════════════
-- DEV-SUPERSET backfill (no-op on prod — those rows already carry questions)
-- Keyed by name + emptiness guard. These names exist in BOTH DBs; in prod
-- they are already populated so the guard skips them, but populating them
-- here makes the dev DB consistent and lets the BEGIN;…ROLLBACK; check pass
-- the same verification target. Question text mirrors the prod rows /
-- assumptions.ts mustAsk for the matching job_type.
-- ════════════════════════════════════════════════════════════════════════

-- electrical · downlight (job_type downlights)
update public.shared_assemblies
   set clarifying_questions = jsonb_build_array(
         'How many downlights, and in which room?',
         'Ceiling type - flat plaster, raked, cathedral, or sheet metal?',
         'Replacing existing downlights, or new install (no fittings there now)?',
         'Any colour or feature preference - warm white, cool white, tri-colour, dimmable, or smart Wi-Fi?'
       )
 where trade = 'electrical'
   and name in ('Install LED downlight', 'Replace LED downlight')
   and (clarifying_questions is null
        or clarifying_questions::text = '[]'
        or clarifying_questions::text = 'null');

-- electrical · fan (job_type ceiling_fans)
update public.shared_assemblies
   set clarifying_questions = jsonb_build_array(
         'How many fans, and in which room?',
         'Do you already have the fan, or do you want us to supply it?',
         'Is there an existing ceiling rose / light point at the spot, or completely new wiring?'
       )
 where trade = 'electrical'
   and name in ('Install customer-supplied ceiling fan',
                'Install premium DC fan with wall control',
                'Supply + install AC ceiling fan')
   and (clarifying_questions is null
        or clarifying_questions::text = '[]'
        or clarifying_questions::text = 'null');

-- electrical · smoke_alarm (job_type smoke_alarms)
update public.shared_assemblies
   set clarifying_questions = jsonb_build_array(
         'How many alarms (or how many bedrooms if doing a full compliance install)?',
         'Replacing existing alarms, or first installation?'
       )
 where trade = 'electrical'
   and name = 'Hardwire 240V smoke alarm'
   and (clarifying_questions is null
        or clarifying_questions::text = '[]'
        or clarifying_questions::text = 'null');

-- electrical · outdoor_light (job_type outdoor_lighting)
update public.shared_assemblies
   set clarifying_questions = jsonb_build_array(
         'How many fittings, and where (eaves, deck, garden path)?',
         'Do you want a sensor / motion-activated, or always-on?',
         'Is there an existing outdoor circuit nearby, or does new power need running out there?'
       )
 where trade = 'electrical'
   and name = 'Install outdoor IP-rated LED light'
   and (clarifying_questions is null
        or clarifying_questions::text = '[]'
        or clarifying_questions::text = 'null');

-- electrical · gpo (job_type power_points) — Replace double GPO, dev only
update public.shared_assemblies
   set clarifying_questions = jsonb_build_array(
         'How many GPOs, and in which room?',
         'Replacing existing GPOs, adding near existing power, or a brand-new run from the switchboard?',
         'If it is a bathroom, ensuite, laundry or kitchen - is the GPO at least 600mm from any basin, sink, shower or bath?'
       )
 where trade = 'electrical'
   and name = 'Replace double GPO'
   and (clarifying_questions is null
        or clarifying_questions::text = '[]'
        or clarifying_questions::text = 'null');

-- plumbing · drain (job_type blocked_drain)
update public.shared_assemblies
   set clarifying_questions = jsonb_build_array(
         'Which drain is blocked (kitchen sink, bathroom basin, shower, toilet, or external)?',
         'Is it slow draining or completely blocked?'
       )
 where trade = 'plumbing'
   and name in ('Hand rod blocked drain', 'Jet blast blocked drain')
   and (clarifying_questions is null
        or clarifying_questions::text = '[]'
        or clarifying_questions::text = 'null');

-- plumbing · hot_water (job_type hot_water)
update public.shared_assemblies
   set clarifying_questions = jsonb_build_array(
         'Current system type - electric storage, gas storage, continuous-flow gas, or heat pump?',
         'Roughly what size / capacity (e.g. 250L, 315L, or not sure)?',
         'Where is it located (laundry, outside back wall, roof, garage)?'
       )
 where trade = 'plumbing'
   and name in ('Install electric HWS', 'Install gas HWS', 'Install heat pump HWS')
   and (clarifying_questions is null
        or clarifying_questions::text = '[]'
        or clarifying_questions::text = 'null');

-- plumbing · tap (job_types tap_repair / tap_replace)
update public.shared_assemblies
   set clarifying_questions = jsonb_build_array(
         'Which tap (kitchen, basin, laundry, outdoor)?',
         'Are you supplying the tapware, or do you want the plumber to supply?'
       )
 where trade = 'plumbing'
   and name = 'Tap replacement'
   and (clarifying_questions is null
        or clarifying_questions::text = '[]'
        or clarifying_questions::text = 'null');

update public.shared_assemblies
   set clarifying_questions = jsonb_build_array(
         'Which tap (kitchen, basin, laundry, outdoor)?',
         'Is it dripping, leaking from the body, or stuck?'
       )
 where trade = 'plumbing'
   and name = 'Tap washer replacement'
   and (clarifying_questions is null
        or clarifying_questions::text = '[]'
        or clarifying_questions::text = 'null');

-- plumbing · toilet (job_types toilet_repair / toilet_replace)
update public.shared_assemblies
   set clarifying_questions = jsonb_build_array(
         'Which toilet (main, ensuite, second bathroom)?',
         'Symptom - constantly running, leaking at the base, or will not flush?'
       )
 where trade = 'plumbing'
   and name = 'Toilet cistern repair'
   and (clarifying_questions is null
        or clarifying_questions::text = '[]'
        or clarifying_questions::text = 'null');

update public.shared_assemblies
   set clarifying_questions = jsonb_build_array(
         'Which toilet (main, ensuite)?',
         'Style preference - standard close-coupled, wall-faced, or in-wall cistern?',
         'Are you supplying the suite, or do you want the plumber to supply?'
       )
 where trade = 'plumbing'
   and name = 'Toilet suite install'
   and (clarifying_questions is null
        or clarifying_questions::text = '[]'
        or clarifying_questions::text = 'null');

notify pgrst, 'reload schema';
