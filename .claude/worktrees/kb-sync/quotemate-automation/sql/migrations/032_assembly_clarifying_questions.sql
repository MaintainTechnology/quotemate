-- ════════════════════════════════════════════════════════════════════
-- Migration 032 — per-assembly mandated clarifying questions
--
-- Why: only the 11 hardcoded easy-5 job types had a MUST-ASK question
-- script (ALL_RULES_TEXT in lib/sms/dialog.ts). Every toggled-on
-- catalogue extra quoted off name + suburb + a vague scope line, so the
-- AI gathered too little to draft an accurate, groundable quote — which
-- also pushed otherwise-quotable jobs toward the $199 inspection.
--
-- Design (data-driven, same single-source principle as migration 029's
-- category column): the questions live ON the assembly row, right next
-- to its `unit` / `default_unit_price_ex_gst` / `default_labour_hours`,
-- so they CANNOT drift from the pricing they are meant to pin. The
-- dialog renders + mandates them dynamically (no system-prompt bloat,
-- works for tenant custom rows too). NULL = no script → unchanged
-- behaviour (universal name+suburb+scope only), so this is safe to apply
-- before OR after the code deploy.
--
-- Each question below is authored FROM the row's pricing shape:
--   • unit=each              → "how many?" pins qty × unit_price
--   • customer-vs-tradie     → flips 0%-markup vs marked-up material line
--   • labour driver          → new line/run, access, indoor/outdoor
--   • variant selection      → picks the correctly-priced row
--   • genuine inspection cue → escalate ONLY when warranted
--
-- Pilot scope: the 14 PLUMBING services that had no script. The 9
-- plumbing services already covered by easy-5 (blocked_drain / hot_water
-- / tap_* / toilet_*) are intentionally left alone. Electrical is a
-- fast-follow. Idempotent: add-column-if-not-exists + (trade,name) keyed
-- backfill.
-- ════════════════════════════════════════════════════════════════════

alter table shared_assemblies
  add column if not exists clarifying_questions jsonb;
alter table tenant_custom_assemblies
  add column if not exists clarifying_questions jsonb;

comment on column shared_assemblies.clarifying_questions is
  'JSON array of MUST-ASK questions the SMS dialog requires before it can finish a quote for this service. NULL → universal (name+suburb+scope) only. Authored from the row pricing shape. Added migration 032.';
comment on column tenant_custom_assemblies.clarifying_questions is
  'Per-row MUST-ASK questions (see shared_assemblies.clarifying_questions). Added migration 032.';

-- ── 14 plumbing scripts (names verified against prod 2026-05-19) ──────

update shared_assemblies set clarifying_questions = '[
  "Is this for a pre-purchase property inspection, or an existing drainage problem?",
  "Do you need a written report afterwards?",
  "Roughly how many metres of line need inspecting - one fixture run, or the whole property?"
]'::jsonb where trade = 'plumbing' and name = 'CCTV drain inspection';

update shared_assemblies set clarifying_questions = '[
  "Roughly how much old material or equipment needs removing and disposing of?"
]'::jsonb where trade = 'plumbing' and name = 'Disposal and site cleanup';

update shared_assemblies set clarifying_questions = '[
  "Is there an existing gas point or bayonet near the appliance, or does a new gas line need running?",
  "Is the gas supply natural gas or LPG?",
  "Is the appliance already on-site, or supplied by us?"
]'::jsonb where trade = 'plumbing' and name = 'Gas appliance connection';

update shared_assemblies set clarifying_questions = '[
  "Are you noticing very high pressure at taps or showers, or banging pipes (water hammer)?",
  "Is this replacing an existing valve, or a first install at the water meter?",
  "Is it a single home, or does the line feed multiple units?"
]'::jsonb where trade = 'plumbing' and name = 'Pressure reduction valve install';

update shared_assemblies set clarifying_questions = '[
  "Is the dishwasher supplied by you, or by us?",
  "Is there existing dishwasher plumbing under the sink (water and waste), or does it need to be run in?",
  "Is it freestanding, or an integrated/built-in unit?"
]'::jsonb where trade = 'plumbing' and name = 'Install dishwasher';

update shared_assemblies set clarifying_questions = '[
  "Roughly how far is the new tap location from the nearest existing water line?",
  "What surface will it mount on - timber, brick, or rendered wall?",
  "Just one garden tap, or more than one?"
]'::jsonb where trade = 'plumbing' and name = 'Install external garden tap';

update shared_assemblies set clarifying_questions = '[
  "Is the disposal unit supplied by you, or by us?",
  "Is this replacing an existing unit, or a first install?",
  "Is there a power point already under the sink for it?"
]'::jsonb where trade = 'plumbing' and name = 'Install garbage disposal';

update shared_assemblies set clarifying_questions = '[
  "What size is the tank, and is it supplied and already sitting on a prepared base?",
  "Connecting the downpipe and overflow only, or also a pump or connection into the house plumbing?",
  "One tank, or more than one?"
]'::jsonb where trade = 'plumbing' and name = 'Install rainwater tank';

update shared_assemblies set clarifying_questions = '[
  "Is this replacing existing hot and cold washing machine taps, or a first install?",
  "Are the taps easy to access, or tucked behind the machine in a tight spot?",
  "Just the taps, or do the supply hoses need replacing too?"
]'::jsonb where trade = 'plumbing' and name = 'Install washing machine taps';

update shared_assemblies set clarifying_questions = '[
  "Is the filter unit supplied by you, or by us?",
  "Where should it go - at the water meter or mains entry, or under a sink?",
  "Is there an isolation valve on the mains already, or does one need adding?"
]'::jsonb where trade = 'plumbing' and name = 'Install whole-house water filter';

update shared_assemblies set clarifying_questions = '[
  "What signs are you seeing - a wet patch, a high water bill, or the sound of running water?",
  "Where do you think it is - inside, in a wall or ceiling, under the slab, or in the yard?",
  "Is water actively flowing or causing damage right now?"
]'::jsonb where trade = 'plumbing' and name = 'Leak detection';

update shared_assemblies set clarifying_questions = '[
  "Is the new shower head supplied by you, or by us?",
  "Just the head on the existing arm, or is the arm or rail being replaced too?"
]'::jsonb where trade = 'plumbing' and name = 'Replace shower head';

update shared_assemblies set clarifying_questions = '[
  "Is the replacement seat supplied by you, or by us?",
  "Standard seat, or a soft-close or special-shape seat?"
]'::jsonb where trade = 'plumbing' and name = 'Replace toilet seat';

update shared_assemblies set clarifying_questions = '[
  "Is this a recurring problem, or the first time it has blocked?",
  "Is it a surface stormwater pit or downpipe, or a buried stormwater drain?",
  "Are there large trees near the line?"
]'::jsonb where trade = 'plumbing' and name = 'Stormwater drain unblock';
