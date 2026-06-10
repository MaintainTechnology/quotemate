-- ════════════════════════════════════════════════════════════════════
-- Migration 033 — electrical clarifying questions (the mig-032 follow-up)
--
-- Migration 032 shipped the per-assembly clarifying_questions column +
-- the 14 PLUMBING scripts. This backfills the 13 ELECTRICAL services
-- that still had no MUST-ASK script (every electrical row that does not
-- map to an easy-5 job type: the migration-021 extras + the 3 core
-- non-easy-5 rows — fault-finding, cooktop/oven on existing wiring).
--
-- Same data-driven design + same authoring rule as 032: every question
-- is derived FROM the row's pricing shape so it stays in sync with what
-- is actually priced —
--   • unit=each   → "how many?"            pins qty × unit_price
--   • unit=metre  → "how many metres?"     pins the per-metre line
--   • supply      → customer-vs-tradie     flips 0%-markup vs marked-up
--   • labour      → new circuit / run / access drives the hours
--   • inspection  → new circuit, no switchboard capacity, recessed
--                   routing → escalate ONLY when genuinely warranted
--
-- The clarifying_questions columns already exist (migration 032); the
-- add-column-if-not-exists guards below just make 033 standalone-safe
-- and idempotent. NULL stays "universal name+suburb+scope only", so
-- this is deploy-order-safe like 032.
-- ════════════════════════════════════════════════════════════════════

alter table shared_assemblies
  add column if not exists clarifying_questions jsonb;
alter table tenant_custom_assemblies
  add column if not exists clarifying_questions jsonb;

-- ── 13 electrical scripts (names verified against prod 2026-05-19) ────

update shared_assemblies set clarifying_questions = '[
  "What is happening - something not working, the safety switch tripping, or any burning smell or sparking?",
  "Is it affecting one area or circuit, or the whole property?",
  "Is the safety switch tripping and not staying reset?"
]'::jsonb where trade = 'electrical' and name = 'Diagnostic call-out (fault finding)';

update shared_assemblies set clarifying_questions = '[
  "Is the cooktop already on-site, or supplied by us?",
  "Going onto the existing cooktop point in the same spot, or being relocated?",
  "Is it electric or induction?"
]'::jsonb where trade = 'electrical' and name = 'Install cooktop (existing wiring)';

update shared_assemblies set clarifying_questions = '[
  "Is the oven already on-site, or supplied by us?",
  "Is there an existing oven circuit at that location?",
  "Standard under-bench oven, or a larger wall or double oven?"
]'::jsonb where trade = 'electrical' and name = 'Install oven (existing wiring)';

update shared_assemblies set clarifying_questions = '[
  "Is the induction cooktop on-site, or supplied by us?",
  "Is there an existing dedicated circuit of the right rating, or does a new one need running?",
  "What is the cooktop width or amp rating (for example 60cm or 90cm)?"
]'::jsonb where trade = 'electrical' and name = 'Hardwire induction cooktop';

update shared_assemblies set clarifying_questions = '[
  "Is the oven on-site, or supplied by us?",
  "Is there an existing dedicated oven circuit, or does a new one need running?",
  "Single under-bench oven, or a larger wall or double oven?"
]'::jsonb where trade = 'electrical' and name = 'Hardwire oven';

update shared_assemblies set clarifying_questions = '[
  "How many split-system head units need a power point?",
  "Roughly how far is each unit from the switchboard?",
  "Is there spare capacity on the switchboard, or not sure?"
]'::jsonb where trade = 'electrical' and name = 'Install aircon power point';

update shared_assemblies set clarifying_questions = '[
  "Is this replacing an existing fan, or a brand-new install?",
  "Is the fan supplied by you, or by us?",
  "Is there roof or ceiling access above the bathroom for ducting?"
]'::jsonb where trade = 'electrical' and name = 'Install bathroom exhaust fan';

update shared_assemblies set clarifying_questions = '[
  "Is the charger on-site, and which model is it?",
  "Roughly how far is the parking spot from the switchboard?",
  "Single or three-phase supply, and any idea of spare switchboard capacity?"
]'::jsonb where trade = 'electrical' and name = 'Install EV charger';

update shared_assemblies set clarifying_questions = '[
  "Roughly how many metres of strip in total?",
  "Is the strip and driver supplied by you, or by us?",
  "Surface-mounted in a channel, or recessed into the plaster?"
]'::jsonb where trade = 'electrical' and name = 'Install LED strip lighting';

update shared_assemblies set clarifying_questions = '[
  "How many flood lights?",
  "Is each light supplied by you, or by us?",
  "Going onto an existing outdoor circuit or switch, or does new wiring need running?"
]'::jsonb where trade = 'electrical' and name = 'Install motion sensor flood light';

update shared_assemblies set clarifying_questions = '[
  "How many outdoor power points?",
  "Is there a nearby existing circuit to pick up, or does a new circuit or conduit run need installing?",
  "What surface will it mount on - timber, brick, or rendered?"
]'::jsonb where trade = 'electrical' and name = 'Install outdoor IP-rated GPO';

update shared_assemblies set clarifying_questions = '[
  "How many cameras?",
  "Is there an existing NVR or PoE point to run the cable back to?",
  "Are the camera spots reachable on a standard ladder, or do any need pole or roof access?"
]'::jsonb where trade = 'electrical' and name = 'Install security camera (single)';

update shared_assemblies set clarifying_questions = '[
  "Is the doorbell or intercom unit supplied by you, or by us?",
  "Replacing existing wiring, or does new cable need running to the door?",
  "A single entry point, or multiple doors or stations?"
]'::jsonb where trade = 'electrical' and name = 'Install wired doorbell or intercom';
