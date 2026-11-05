-- Migration 222 DOWN — restore the migration-196 EV charger questions.
--
-- Guarded on the exact migration-222 question set so a later operator edit is
-- never overwritten during rollback. This reverses only the question change;
-- migration 222 does not rewrite historical intake JSON.

begin;

update public.shared_assemblies
   set clarifying_questions = jsonb_build_array(
         'Which electric vehicle is the charger for - Tesla, BYD, or another make?',
         'Do you already have the charger unit, or should we supply it?',
         'Whereabouts is the charger going - garage, carport, or an external wall?',
         'Roughly how far is the charger spot from the switchboard?',
         'Is the property single phase or three phase, and any idea of spare switchboard capacity?'
       )
 where trade = 'electrical'
   and name = 'Install EV charger'
   and clarifying_questions = jsonb_build_array(
         'Do you need the charger supplied only, installation only for a charger you already have, or both supply and installation?',
         'Which electric vehicle is the charger for - Tesla, BYD, or another make?',
         'Whereabouts is the charger going - garage, carport, or an external wall?',
         'Roughly how far is the charger spot from the switchboard?',
         'Is the property single phase or three phase, and any idea of spare switchboard capacity?'
       );

notify pgrst, 'reload schema';

commit;
