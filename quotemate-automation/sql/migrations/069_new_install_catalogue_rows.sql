-- Migration 069 · Add "new install" catalogue rows
--
-- Context: Jon's downlight example exposed that the existing single
-- "Install LED downlight" row (0.40 hr) only covers REPLACE — the
-- exclusions text literally says "Excludes new wiring runs". A new
-- install requires running cables, cutting holes, terminating — 3-4×
-- the labour. Same gap on smoke alarms (one row only, no whole-house
-- compliance variant). Same logic applies to outdoor lights and
-- ceiling fans where the labour profile changes substantially when
-- new wiring is needed.
--
-- This migration adds FOUR new shared_assemblies rows, each with
-- structured row_assumptions (mig 067) + per-row inspection triggers
-- so the AI knows when the row applies and when to escalate to a
-- site visit instead.
--
-- New rows:
--   1. Install LED downlight (new install, single-storey, existing switch)
--      1.75 hr per fitting · electrical · downlight
--      Inspection triggers: raked ceiling, multi-storey, no roof access
--   2. Hardwire 240V smoke alarm (first-install whole-house compliance)
--      1.0 hr per alarm + 0.5 base · electrical · smoke_alarm
--      Inspection triggers: pre-1970 house, asbestos ceiling, no existing alarms anywhere
--   3. Install outdoor light (new circuit needed)
--      1.25 hr per fitting · electrical · outdoor_light
--      Inspection triggers: underground cabling, no power outside, three-phase
--   4. Install ceiling fan (new wiring, no existing rose)
--      2.25 hr per fan · electrical · fan
--      Inspection triggers: raked ceiling, multi-storey, no roof access, pre-1970 house
--
-- All four carry:
--   • clarifying_questions: per-row MUST-ASK script (matching mig 065 pattern)
--   • properties: structured tags for the lookup tool to filter by
--   • row_assumptions: structured rules (switch_within_metres, etc.)
--   • inspection_triggers: per-row text[] for the SMS dialog to escalate
--   • default_exclusions: human-readable summary of what's NOT included
--
-- Idempotent: uses ON CONFLICT (trade, name) DO NOTHING via a NOT EXISTS
-- guard so re-runs are no-ops.

insert into shared_assemblies (
  trade, name, description, default_unit, default_unit_price_ex_gst,
  default_labour_hours, default_exclusions, category, properties,
  clarifying_questions, row_assumptions, inspection_triggers
)
select
  'electrical',
  'Install LED downlight (new install, single-storey)',
  'New downlight install where no fitting currently exists. Run new cable from existing switch within 5m, cut hole, terminate, fit downlight, test. Single-storey only.',
  'each',
  35.00,
  1.75,
  'Excludes new circuit work, switchboard upgrades, ceiling repair beyond standard 90mm core, raked-ceiling installs, multi-storey installs',
  'downlight',
  '{"weatherproof": false, "new_install": true}'::jsonb,
  '[
    "How many downlights, and in which room?",
    "Is there an existing light switch within 5 metres that we can extend from?",
    "Ceiling type - flat plaster, raked, cathedral, or sheet metal?",
    "Single-storey property, or two-storey?",
    "Any colour or feature preference - warm white, cool white, tri-colour, dimmable, or smart Wi-Fi?"
  ]'::jsonb,
  '{
    "switch_within_metres": 5,
    "max_storeys": 1,
    "roof_access_required": true,
    "ceiling_type_required": "flat_plaster",
    "existing_circuit_required": true,
    "labour_basis": "Locate power, run cable, cut hole, terminate, fit, test - per fitting"
  }'::jsonb,
  ARRAY[
    'raked ceiling',
    'cathedral ceiling',
    'two storey',
    'multi-storey',
    'two-storey',
    'no roof access',
    'no manhole',
    'switch more than 5 metres',
    'no existing switch',
    'asbestos',
    'pre-1970'
  ]
where not exists (
  select 1 from shared_assemblies
   where trade='electrical' and name='Install LED downlight (new install, single-storey)'
);

insert into shared_assemblies (
  trade, name, description, default_unit, default_unit_price_ex_gst,
  default_labour_hours, default_exclusions, category, properties,
  clarifying_questions, row_assumptions, inspection_triggers
)
select
  'electrical',
  'Hardwire 240V smoke alarm (whole-house compliance install)',
  'First-install compliance set for a property with no existing 240V hardwired alarms. Includes mounting, terminating, interconnect wiring run between bedrooms + hallway, and final compliance test. Per-alarm pricing.',
  'each',
  40.00,
  1.00,
  'Excludes new switchboard circuit, ceiling repair, asbestos remediation. Quoted as per-alarm; allow 0.5 hr base setup on top.',
  'smoke_alarm',
  '{"hardwired": true, "interconnect": true, "new_install": true, "compliance_install": true}'::jsonb,
  '[
    "How many bedrooms in the property - this determines the alarm count for compliance?",
    "Single-storey or two-storey property?",
    "Any existing 240V alarms, or is this a first install with no hardwired alarms anywhere?",
    "Ceiling type - flat plaster throughout, or any raked / cathedral sections?",
    "Is the property pre-1970, or modern construction?"
  ]'::jsonb,
  '{
    "max_storeys": 2,
    "roof_access_required": true,
    "ceiling_type_required": "flat_plaster",
    "labour_basis": "Per alarm install + interconnect wiring run, plus 0.5 hr base setup",
    "compliance_basis": "AS 3786 + state-specific tenancy law (NSW Fire & Rescue / Qld Fire Safety)"
  }'::jsonb,
  ARRAY[
    'pre-1970',
    'asbestos',
    'asbestos ceiling',
    'ceramic fuse',
    'old switchboard',
    'no roof access',
    'no manhole',
    'rental compliance certificate required',
    'raked ceiling',
    'cathedral ceiling'
  ]
where not exists (
  select 1 from shared_assemblies
   where trade='electrical' and name='Hardwire 240V smoke alarm (whole-house compliance install)'
);

insert into shared_assemblies (
  trade, name, description, default_unit, default_unit_price_ex_gst,
  default_labour_hours, default_exclusions, category, properties,
  clarifying_questions, row_assumptions, inspection_triggers
)
select
  'electrical',
  'Install outdoor light (new circuit from indoor power)',
  'New outdoor light install where no outdoor power currently exists. Run cable from nearest indoor circuit through wall, terminate weatherproof fitting, test. Single-fitting on a standard exterior wall.',
  'each',
  55.00,
  1.25,
  'Excludes underground conduit runs, new switchboard circuits, three-phase work, paving / concrete penetrations',
  'outdoor_light',
  '{"weatherproof": true, "outdoor": true, "new_install": true}'::jsonb,
  '[
    "How many fittings, and where - eaves, deck, garden path, or wall-mounted?",
    "Is there indoor power within 3 metres of the planned fitting location?",
    "Wall material - brick, weatherboard, plaster, or fibre cement?",
    "Sensor (movement-activated) or always-on?",
    "Any underground cabling needed, or all on the exterior wall?"
  ]'::jsonb,
  '{
    "indoor_power_within_metres": 3,
    "wall_type_required": ["brick", "weatherboard", "plaster", "fibre cement"],
    "labour_basis": "Run cable through wall, terminate weatherproof fitting, test - per fitting",
    "weatherproofing": "Required - IP44 minimum"
  }'::jsonb,
  ARRAY[
    'underground cabling',
    'bury cable',
    'underground conduit',
    'garden lights along path',
    'string lights across yard',
    'three-phase',
    'pre-1970',
    'no power outside currently',
    'concrete to cut',
    'pavers to lift'
  ]
where not exists (
  select 1 from shared_assemblies
   where trade='electrical' and name='Install outdoor light (new circuit from indoor power)'
);

insert into shared_assemblies (
  trade, name, description, default_unit, default_unit_price_ex_gst,
  default_labour_hours, default_exclusions, category, properties,
  clarifying_questions, row_assumptions, inspection_triggers
)
select
  'electrical',
  'Install ceiling fan (new wiring, no existing rose)',
  'New ceiling fan install where no existing ceiling rose or light point is present. Run new cable from existing switch or light circuit, terminate, mount fan + wall control, test. Single-storey, flat ceiling.',
  'each',
  85.00,
  2.25,
  'Excludes ceiling reinforcement for heavy fans, new switchboard circuits, raked-ceiling installs, multi-storey installs, supply of fan',
  'fan',
  '{"new_install": true, "fan_supplied_by_customer": true}'::jsonb,
  '[
    "How many fans, and in which room?",
    "Is there an existing light point or ceiling rose nearby that we can extend from, or completely new wiring needed?",
    "Existing wall switch we can reuse, or does a new wall control need to be installed?",
    "Single-storey or two-storey property?",
    "Standard AC fan or premium DC with remote / wall control?"
  ]'::jsonb,
  '{
    "max_storeys": 1,
    "roof_access_required": true,
    "ceiling_type_required": "flat",
    "fan_supplied_by_customer": true,
    "labour_basis": "Run new cable, mount fan + control, terminate, test - per fan",
    "weight_limit_kg": 12
  }'::jsonb,
  ARRAY[
    'raked ceiling',
    'cathedral ceiling',
    'high ceiling',
    'multi-storey',
    'two storey',
    'two-storey',
    'no roof access',
    'no manhole',
    'pre-1970',
    'heavy fan',
    'industrial fan'
  ]
where not exists (
  select 1 from shared_assemblies
   where trade='electrical' and name='Install ceiling fan (new wiring, no existing rose)'
);
