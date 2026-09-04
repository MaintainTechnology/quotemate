-- ═══════════════════════════════════════════════════════════════════
-- Migration 196 — bring the SMS receptionist's EV charger questions up to
-- the dashboard form's five (spec specs/ev-charger-location-photo.md R5).
--
-- The tradie form (lib/quote/job-fields.ts:189-231) asks five things:
--   vehicle · charger_supply · room · switchboard_distance · phase
-- The SMS receptionist asked three (migration 033), so an SMS lead reached a
-- quote with less known about it than a portal lead. These are the same five,
-- in the same order, phrased for a text conversation.
--
-- WHY THE DATABASE: shared_assemblies.clarifying_questions is the ONLY source
-- of EV questions — for both the model prompt (customServicesDirective) and
-- the deterministic gate (missingServiceQuestion). No TypeScript file carries
-- an EV question set.
--
-- FIVE IS THE CEILING. dialog.ts MAX_MUSTASK_PER_SERVICE = 6 truncates the
-- PROMPT render at six while missingServiceQuestion iterates ALL of them, so a
-- seventh question would be enforced by the gate but never shown to the model —
-- it would keep trying to finish and burn the clarify cap. The photo is the
-- sixth required step and is gated in code, NOT added here, for this reason.
--
-- Each question carries a >=4-character topic noun (vehicle, charger, garage,
-- switchboard, phase) because serviceKeywords drops shorter words and a
-- question with no scoreable keyword can never be marked answered.
--
-- Idempotent and name-keyed, following migration 121. Only updates the row
-- when it still holds the migration-033 three, so a tenant or operator who has
-- since hand-edited the script keeps their version.
-- ═══════════════════════════════════════════════════════════════════

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
   and jsonb_array_length(coalesce(clarifying_questions, '[]'::jsonb)) = 3;

notify pgrst, 'reload schema';
