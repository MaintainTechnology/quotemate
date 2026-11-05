-- Migration 222 — make the EV charger service mode an explicit customer choice.
--
-- The old second question ("do you already have the charger, or should we
-- supply it?") recorded who supplies the unit, but could not distinguish:
--   * supply only
--   * installation only
--   * supply and installation
--
-- The service-mode question is deliberately first. A capability question such
-- as "can you supply one?" is not itself a mode selection; the receptionist's
-- deterministic code must leave the mode unresolved and ask this question.
--
-- Only the exact migration-196 question set is changed. This keeps the
-- migration idempotent and preserves any operator-authored custom questions.
-- No assembly ID, pricing, recipe, labour, category, or enablement is touched.

begin;

update public.shared_assemblies
   set clarifying_questions = jsonb_build_array(
         'Do you need the charger supplied only, installation only for a charger you already have, or both supply and installation?',
         'Which electric vehicle is the charger for - Tesla, BYD, or another make?',
         'Whereabouts is the charger going - garage, carport, or an external wall?',
         'Roughly how far is the charger spot from the switchboard?',
         'Is the property single phase or three phase, and any idea of spare switchboard capacity?'
       )
 where trade = 'electrical'
   and name = 'Install EV charger'
   and clarifying_questions = jsonb_build_array(
         'Which electric vehicle is the charger for - Tesla, BYD, or another make?',
         'Do you already have the charger unit, or should we supply it?',
         'Whereabouts is the charger going - garage, carport, or an external wall?',
         'Roughly how far is the charger spot from the switchboard?',
         'Is the property single phase or three phase, and any idea of spare switchboard capacity?'
       );

notify pgrst, 'reload schema';

commit;
