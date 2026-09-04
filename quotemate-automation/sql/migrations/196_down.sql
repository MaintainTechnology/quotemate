-- ═══════════════════════════════════════════════════════════════════
-- Migration 196 DOWN — restore the migration-033 three EV questions.
--
-- Guarded on the five this migration wrote, so an operator who has since
-- edited the script keeps their version rather than having it silently
-- replaced by the 2026-era three.
--
-- Rolling back narrows what the SMS receptionist asks; it does not touch the
-- photo gate, which lives in code (spec R6), so an EV conversation would still
-- require a photo while asking only three questions.
-- ═══════════════════════════════════════════════════════════════════

update public.shared_assemblies
   set clarifying_questions = jsonb_build_array(
         'Is the charger on-site, and which model is it?',
         'Roughly how far is the parking spot from the switchboard?',
         'Single or three-phase supply, and any idea of spare switchboard capacity?'
       )
 where trade = 'electrical'
   and name = 'Install EV charger'
   and jsonb_array_length(coalesce(clarifying_questions, '[]'::jsonb)) = 5;

notify pgrst, 'reload schema';
