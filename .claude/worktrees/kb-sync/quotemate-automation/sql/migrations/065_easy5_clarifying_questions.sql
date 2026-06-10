-- Migration 065 · Lift easy-5 mustAsk into row-level clarifying_questions
--
-- Context: shared_assemblies has 43 rows total. After mig 032 (plumbing
-- 14 rows) and mig 033 (electrical 13 rows), 27 rows have row-level
-- clarifying_questions. The remaining 16 rows are the "easy-5" services
-- whose MUST-ASK questions were sourced via lib/sms/assumptions.ts
-- (ASSUMPTION_RULES + rulesAsText) and injected into the system prompt
-- as a per-job-type block.
--
-- This migration:
--   1. Populates clarifying_questions on those 16 rows, adapted from
--      each row's corresponding ASSUMPTION_RULES.mustAsk array. Where a
--      job_type maps to multiple rows (ceiling_fans → 3 variants,
--      hot_water → 3 variants, blocked_drain → 2 variants), each row
--      gets a variant-aware set (e.g., the customer-supplied fan row
--      skips the "do you supply or we supply?" question — the answer
--      is already encoded in the row name).
--   2. Paired code change (same commit): rulesAsText in
--      lib/sms/assumptions.ts is trimmed to drop the MUST ASK block.
--      safeDefaults + inspectionTriggers stay in code (different shape,
--      genuinely job-type-level policy not per-row).
--
-- After this migration the SMS dialog's MUST ASK questions ALL come
-- from shared_assemblies.clarifying_questions — single source of truth.
-- safeDefaults + inspectionTriggers continue to flow through the
-- system prompt's ALL_RULES_TEXT block, which still derives from
-- ASSUMPTION_RULES (just without the duplicated questions section).
--
-- Idempotent: WHERE clauses target by (trade, name) and condition on
-- clarifying_questions IS NULL so a re-run is a no-op on already-
-- populated rows.

-- ── electrical · downlights (1 row) ─────────────────────────────────
update shared_assemblies set clarifying_questions = '[
  "How many downlights, and in which room?",
  "Ceiling type - flat plaster, raked, cathedral, or sheet metal?",
  "Replacing existing downlights, or new install (no fittings there now)?",
  "Any colour or feature preference - warm white, cool white, tri-colour, dimmable, or smart Wi-Fi?"
]'::jsonb
  where trade = 'electrical' and name = 'Install LED downlight'
    and clarifying_questions is null;

-- ── electrical · power_points (1 row) ───────────────────────────────
update shared_assemblies set clarifying_questions = '[
  "How many GPOs, and in which room?",
  "Replacing existing GPOs, adding near existing power, or a brand-new run from the switchboard?",
  "If it''s a bathroom, ensuite, laundry or kitchen - is the GPO at least 600mm from any basin, sink, shower or bath?"
]'::jsonb
  where trade = 'electrical' and name = 'Replace double GPO'
    and clarifying_questions is null;

-- ── electrical · ceiling_fans (3 variants) ──────────────────────────
update shared_assemblies set clarifying_questions = '[
  "How many fans, and in which room?",
  "Existing wiring at that spot (ceiling rose), or first time installing a fan there?",
  "Ceiling height - standard or raked/high?"
]'::jsonb
  where trade = 'electrical' and name = 'Install customer-supplied ceiling fan'
    and clarifying_questions is null;

update shared_assemblies set clarifying_questions = '[
  "How many fans, and in which room?",
  "Existing wiring at that spot (ceiling rose), or first time installing a fan there?",
  "Ceiling height - standard or raked/high?"
]'::jsonb
  where trade = 'electrical' and name = 'Supply + install AC ceiling fan'
    and clarifying_questions is null;

update shared_assemblies set clarifying_questions = '[
  "How many fans, and in which room?",
  "Existing wiring at that spot, or first time installing a fan there?",
  "Existing wall switch at the fan location, or do we need to run a new control line?"
]'::jsonb
  where trade = 'electrical' and name = 'Install premium DC fan with wall control'
    and clarifying_questions is null;

-- ── electrical · outdoor_lighting (1 row) ───────────────────────────
update shared_assemblies set clarifying_questions = '[
  "How many fittings, and where - eaves, deck, garden path, or wall?",
  "Existing outdoor power circuit nearby, or no power outside currently?",
  "Sensor (movement-activated) or always-on?"
]'::jsonb
  where trade = 'electrical' and name = 'Install outdoor IP-rated LED light'
    and clarifying_questions is null;

-- ── electrical · smoke_alarms (1 row) ───────────────────────────────
update shared_assemblies set clarifying_questions = '[
  "How many alarms - or how many bedrooms if it''s a full compliance install?",
  "Replacing existing 240V alarms, or first install (no hardwired alarms there now)?",
  "Single-storey or two-storey property?"
]'::jsonb
  where trade = 'electrical' and name = 'Hardwire 240V smoke alarm'
    and clarifying_questions is null;

-- ── plumbing · blocked_drain (2 variants — same questions, method differs) ──
update shared_assemblies set clarifying_questions = '[
  "Which drain is blocked - kitchen sink, bathroom basin, shower, toilet, or external?",
  "Slow draining, or completely blocked?",
  "First time it''s blocked, or has it happened before?"
]'::jsonb
  where trade = 'plumbing' and name = 'Hand rod blocked drain'
    and clarifying_questions is null;

update shared_assemblies set clarifying_questions = '[
  "Which drain is blocked - kitchen sink, bathroom basin, shower, toilet, or external?",
  "Slow draining, or completely blocked?",
  "First time it''s blocked, or has it happened before?"
]'::jsonb
  where trade = 'plumbing' and name = 'Jet blast blocked drain'
    and clarifying_questions is null;

-- ── plumbing · hot_water (3 variants — drop the "system type" question
--    since the row name encodes it) ──
update shared_assemblies set clarifying_questions = '[
  "What capacity - 80L, 125L, 160L, 250L, 315L, or not sure?",
  "Where will it go - laundry, outside back wall, garage, or somewhere else?",
  "Is there existing electric power at that location, or do we need a new circuit?"
]'::jsonb
  where trade = 'plumbing' and name = 'Install electric HWS'
    and clarifying_questions is null;

-- NOTE: gas HWS is per project memory supposed to always escalate to
-- inspection (AS/NZS 5601). This migration only lifts questions; the
-- routing-to-inspection fix (set always_inspection=true OR add gas-
-- specific inspection trigger) is a separate workstream.
update shared_assemblies set clarifying_questions = '[
  "What capacity - 135L, 170L, 250L, 330L, or not sure?",
  "Continuous-flow (instantaneous) or storage tank?",
  "Where will it go, and is there a gas connection point already there?"
]'::jsonb
  where trade = 'plumbing' and name = 'Install gas HWS'
    and clarifying_questions is null;

update shared_assemblies set clarifying_questions = '[
  "What capacity - 270L, 300L, 400L, or not sure?",
  "Where will the outdoor unit go - is there 1m airflow clearance?",
  "Is there existing electric power at that location, or do we need a new circuit?"
]'::jsonb
  where trade = 'plumbing' and name = 'Install heat pump HWS'
    and clarifying_questions is null;

-- ── plumbing · tap_replace (1 row) ──────────────────────────────────
update shared_assemblies set clarifying_questions = '[
  "Which tap - kitchen mixer, bathroom basin, laundry, or outdoor?",
  "Are you supplying the tap, or do you want the plumber to supply?",
  "Is there a working isolation valve under the sink or behind the wall?"
]'::jsonb
  where trade = 'plumbing' and name = 'Tap replacement'
    and clarifying_questions is null;

-- ── plumbing · tap_repair (1 row) ───────────────────────────────────
update shared_assemblies set clarifying_questions = '[
  "Which tap - kitchen, bathroom basin, laundry, or outdoor?",
  "Is it dripping from the spout, leaking from the body, or stiff/stuck?",
  "Is there a working isolation valve under the sink?"
]'::jsonb
  where trade = 'plumbing' and name = 'Tap washer replacement'
    and clarifying_questions is null;

-- ── plumbing · toilet_repair (1 row) ────────────────────────────────
update shared_assemblies set clarifying_questions = '[
  "Which toilet - main bathroom, ensuite, or second bathroom?",
  "Symptom - constantly running, leaking at base, or won''t flush?",
  "Is the cistern close-coupled (sitting on the bowl), wall-faced, or in-wall?"
]'::jsonb
  where trade = 'plumbing' and name = 'Toilet cistern repair'
    and clarifying_questions is null;

-- ── plumbing · toilet_replace (1 row) ───────────────────────────────
update shared_assemblies set clarifying_questions = '[
  "Which bathroom - main, ensuite, or second bathroom?",
  "Style preference - standard close-coupled, wall-faced, or in-wall cistern?",
  "Are you supplying the suite, or do you want the plumber to supply?"
]'::jsonb
  where trade = 'plumbing' and name = 'Toilet suite install'
    and clarifying_questions is null;
