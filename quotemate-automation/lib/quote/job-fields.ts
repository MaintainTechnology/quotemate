// ════════════════════════════════════════════════════════════════════
// Per-job-type form field registry for the tradie-facing job quoter
// (/dashboard/job/[trade]).
//
// The SMS receptionist already knows which facts it must nail down before it
// can price a job — REQUIRED_BY_JOB in lib/sms/quote-readiness.ts. A tradie
// typing the job in the portal needs exactly the same facts, so this file is
// the FORM projection of that list: same field codes, same questions, plus
// the type/options a <select> needs.
//
// WHY A CONST, NOT A TABLE. trade_spec_defs has 0 rows live and is never
// SELECTed; job_type_bounds is price sanity bands; tenant_service_offerings
// is a 3-column checkbox join. None of them models "job type → input fields".
// The option vocabularies here are already coupled to code that changes with
// them (the estimator prompts, categoryForJobType), and nothing asks for
// per-tenant field editing. A table would mean a migration + runner + loader
// + cache + client fetch to replace a typed literal. Add trade_form_fields
// the day a tradie needs to edit their own fields — not before.
//
// PURE — zero imports. quote-readiness.ts can't be imported into a client
// bundle (its module chain pulls lib/estimate/catalogue + spec-guard), so the
// content is lifted here rather than re-exported.
//
// Option strings are HUMAN-READABLE, not canonical enums, and that is
// deliberate: the answers are rendered into a prose transcript which
// structureIntake() re-derives the structured intake from. There is no
// downstream consumer of a canonical value, so a canonicalisation layer
// would be dead weight.
// ════════════════════════════════════════════════════════════════════

export type JobField = {
  /** Stable code — mirrors the fact codes in REQUIRED_BY_JOB and, where one
   *  exists, the matching SlotsSchema key. Used as the form input name. */
  code: string
  /** Question shown above the input, lifted from REQUIRED_BY_JOB so the
   *  portal asks exactly what the SMS receptionist asks. */
  label: string
  type: 'number' | 'select' | 'text'
  /** Choices for `type: 'select'`. Written into the transcript verbatim. */
  options?: readonly string[]
}

export type JobFormSpec = {
  fields: readonly JobField[]
  /** tenant_material_catalogue.category to offer a product picker from.
   *  Mirrors JOB_TYPE_CATEGORY in lib/sms/product-options.ts, which is
   *  server-only — duplicated here to keep this module client-safe. */
  catalogueCategory?: string
  /** No shared_assemblies row backs this job type (verified against prod
   *  2026-07-28), so the grounding validator will downgrade it to the $99
   *  inspection route unless the tenant has a custom assembly for it.
   *  Drives a heads-up in the form — NOT a hard block, because a tenant
   *  custom assembly can and does make these quotable. */
  usuallyInspection?: boolean
}

/** Fallback field set for job types with no entry in REQUIRED_BY_JOB. The
 *  form's free-text notes box carries the rest of the detail. */
const GENERIC: readonly JobField[] = [
  { code: 'room', label: 'Which room or area is the work in?', type: 'text' },
]

export const JOB_FIELDS: Record<string, JobFormSpec> = {
  // ── Electrical ──────────────────────────────────────────────────
  downlights: {
    catalogueCategory: 'downlight',
    fields: [
      { code: 'count', label: 'How many downlights are we doing?', type: 'number' },
      { code: 'room', label: 'Which room or area are the downlights for?', type: 'text' },
      {
        code: 'ceiling_type',
        label: 'What ceiling type is it?',
        type: 'select',
        options: ['flat plaster', 'raked', 'cathedral', 'sheet metal', 'not sure'],
      },
      {
        code: 'replace_or_new',
        label: 'Replacing existing downlights, or new installs where there are no fittings now?',
        type: 'select',
        options: ['replacing existing', 'new install'],
      },
      {
        code: 'colour',
        label: 'Any colour or feature preference?',
        type: 'select',
        options: ['warm white', 'cool white', 'tri-colour', 'dimmable', 'smart', 'standard'],
      },
    ],
  },
  power_points: {
    catalogueCategory: 'gpo',
    fields: [
      { code: 'count', label: 'How many GPOs or power points?', type: 'number' },
      { code: 'room', label: 'Which room or area are the power points for?', type: 'text' },
      {
        code: 'replace_or_new',
        label: 'Replacing existing GPOs, adding near existing power, or a new run from the switchboard?',
        type: 'select',
        options: ['replacing existing', 'adding near existing power', 'new run from the switchboard (on-site inspection)'],
      },
      // ── The two RECIPE SLOTS ────────────────────────────────────
      // These are not ordinary questions: "Replace double GPO" is the only
      // assembly in production carrying a price_recipe, and these are its two
      // questions verbatim (`distance_to_existing_power`, `circuit_required`).
      // The route stamps them onto intake.scope so applyPriceBands can read
      // them. Leave them out and the recipe silently applies its
      // default_when_unanswered — 2 metres and 10A, the cheapest band of each.
      {
        code: 'distance_to_existing_power',
        label:
          'For a new or extended run: how far from the nearest existing power point, in metres? (leave blank for a straight swap)',
        type: 'number',
      },
      {
        // Option strings MUST stay the literal recipe band values —
        // applySelectBand (lib/estimate/price-bands.ts:230) compares exact
        // lowercased strings, so "20 amp" or "single phase" would match
        // nothing and silently price as 10A. 20A and three-phase each swap the
        // whole base assembly via use_assembly_id.
        code: 'circuit_required',
        label: 'Circuit required? 20A is a dedicated circuit, three-phase is a 32A outlet',
        type: 'select',
        options: ['10A', '20A', 'three-phase'],
      },
    ],
  },
  ceiling_fans: {
    catalogueCategory: 'fan',
    fields: [
      { code: 'count', label: 'How many fans are we doing?', type: 'number' },
      { code: 'room', label: 'Which room or rooms are the fans for?', type: 'text' },
      {
        code: 'supplied_by',
        label: 'Does the customer already have the fan, or are we supplying it?',
        type: 'select',
        options: ['customer supplies', 'we supply'],
      },
    ],
  },
  smoke_alarms: {
    catalogueCategory: 'smoke_alarm',
    fields: [
      // Classifier first — a like-for-like swap and a full-property
      // compliance hardwire are materially different scopes (R25).
      {
        code: 'smoke_class',
        label: 'Is this a like-for-like swap, or a full-property compliance hardwire?',
        type: 'select',
        options: ['like-for-like swap of existing alarms', 'full-property compliance hardwire (all bedrooms + hallways)'],
      },
      {
        code: 'count',
        label: 'How many alarms (or how many bedrooms, for a full compliance install)?',
        type: 'number',
      },
    ],
  },
  outdoor_lighting: {
    catalogueCategory: 'outdoor_light',
    fields: [
      { code: 'count', label: 'How many outdoor light fittings?', type: 'number' },
      { code: 'room', label: 'Where are the outdoor lights going?', type: 'text' },
      {
        code: 'sensor',
        label: 'On a sensor, or always-on / switched?',
        type: 'select',
        options: ['on a sensor', 'always-on', 'switched'],
      },
    ],
  },
  switchboard: { fields: GENERIC, usuallyInspection: true },
  oven_cooktop: {
    catalogueCategory: 'oven_cooktop',
    fields: [
      {
        code: 'appliance',
        label: 'Which appliance?',
        type: 'select',
        options: ['oven', 'cooktop', 'induction cooktop', 'oven and cooktop'],
      },
      {
        code: 'replace_or_new',
        label: 'Is there existing wiring in place, or does a new circuit need running?',
        type: 'select',
        options: ['existing wiring', 'new circuit needed (on-site inspection)', 'not sure'],
      },
    ],
  },
  ev_charger: {
    catalogueCategory: 'ev_charger',
    fields: [
      { code: 'room', label: 'Where is the charger going?', type: 'text' },
      {
        // NOT `circuit_required`. That code is a RECIPE SLOT
        // (lib/quote/recipe-slots.ts), and the job-quote route filters recipe
        // slot codes out of the prose transcript for every job type — so naming
        // it that way silently dropped this answer, and 'three phase' matches no
        // recipe band anyway (the band value is the hyphenated 'three-phase').
        // Three-phase work is meant to force an inspection
        // (lib/intake/structure.ts:397); with the answer lost it never did.
        code: 'phase',
        label: 'Single phase or three phase?',
        type: 'select',
        options: ['single phase', 'three phase (on-site inspection)', 'not sure'],
      },
    ],
  },
  fault_finding: {
    catalogueCategory: 'fault_find',
    fields: [
      { code: 'room', label: 'Which room or circuit is affected?', type: 'text' },
      {
        code: 'fault_symptom',
        label: "What's happening?",
        type: 'select',
        options: ['breaker tripping', 'no power to an area', 'lights flickering', 'burning smell', 'something else'],
      },
    ],
  },
  renovation: { fields: GENERIC, usuallyInspection: true },

  // ── Plumbing ────────────────────────────────────────────────────
  blocked_drain: {
    catalogueCategory: 'drain',
    fields: [
      {
        code: 'room',
        label: 'Which drain is blocked?',
        type: 'select',
        options: ['kitchen sink', 'bathroom basin', 'shower', 'toilet', 'laundry', 'external / stormwater'],
      },
      {
        code: 'blockage_severity',
        label: 'Is it slow draining, or completely blocked?',
        type: 'select',
        options: ['slow draining', 'completely blocked'],
      },
    ],
  },
  hot_water: {
    catalogueCategory: 'hot_water',
    fields: [
      {
        // 'solar' and 'not sure' both route to the $99 inspection, and that is
        // deliberate upstream behaviour, not a gap here: normaliseSystemType
        // (lib/intake/structure.ts:45) maps only electric/gas/heat_pump, and the
        // E8 backstop (structure.ts:153) refuses to guess a fuel it cannot map
        // rather than ground the quote on the wrong HWS assembly. The labels say
        // so out loud so a tradie is never surprised by an inspection they did
        // not ask for. Do NOT map 'solar' to electric to make it price — a solar
        // HWS is not an electric storage unit and the assembly would be wrong.
        code: 'energy_source',
        label: 'What type of hot water system is it?',
        type: 'select',
        options: [
          'electric',
          'gas',
          'heat pump',
          'solar (on-site inspection)',
          'not sure (on-site inspection)',
        ],
      },
      {
        code: 'litres',
        label: 'Roughly what size is the unit?',
        type: 'select',
        options: ['125L', '160L', '250L', '315L', '400L', 'not sure'],
      },
      {
        code: 'room',
        label: 'Where is the unit located?',
        type: 'select',
        options: ['laundry', 'outside wall', 'garage', 'roof', 'somewhere else'],
      },
    ],
  },
  tap_repair: {
    catalogueCategory: 'tap',
    fields: [
      {
        code: 'room',
        label: 'Which tap is it?',
        type: 'select',
        options: ['kitchen', 'basin', 'laundry', 'outdoor', 'shower'],
      },
      {
        code: 'tap_symptom',
        label: "What's happening?",
        type: 'select',
        options: ['dripping', 'leaking from the body', 'stuck / won’t turn'],
      },
    ],
  },
  tap_replace: {
    catalogueCategory: 'tap',
    fields: [
      {
        code: 'room',
        label: 'Which tap are we replacing?',
        type: 'select',
        options: ['kitchen mixer', 'basin', 'laundry', 'outdoor', 'shower'],
      },
      {
        code: 'supplied_by',
        label: 'Is the customer supplying the tap, or are we?',
        type: 'select',
        options: ['customer supplies', 'we supply'],
      },
    ],
  },
  toilet_repair: {
    catalogueCategory: 'toilet',
    fields: [
      {
        code: 'room',
        label: 'Which toilet is it?',
        type: 'select',
        options: ['main', 'ensuite', 'second bathroom'],
      },
      {
        code: 'toilet_symptom',
        label: "What's happening?",
        type: 'select',
        options: ['constantly running', 'leaking', 'won’t flush'],
      },
    ],
  },
  toilet_replace: {
    catalogueCategory: 'toilet',
    fields: [
      {
        code: 'room',
        label: 'Which toilet are we replacing?',
        type: 'select',
        options: ['main', 'ensuite', 'second bathroom'],
      },
      {
        code: 'toilet_style',
        label: 'Any style preference?',
        type: 'select',
        options: ['standard close-coupled', 'wall-faced', 'back-to-wall', 'in-wall cistern', 'not sure'],
      },
      {
        code: 'supplied_by',
        label: 'Is the customer supplying the suite, or are we?',
        type: 'select',
        options: ['customer supplies', 'we supply'],
      },
    ],
  },
  gas_fitting: {
    catalogueCategory: 'gas',
    fields: [
      { code: 'room', label: 'Where is the appliance going?', type: 'text' },
      {
        code: 'appliance',
        label: 'Which appliance is being connected?',
        type: 'select',
        options: ['cooktop', 'oven', 'hot water unit', 'heater', 'BBQ point', 'something else'],
      },
    ],
  },
  burst_pipe: { fields: GENERIC, usuallyInspection: true },
  bathroom_renovation: { fields: GENERIC, usuallyInspection: true },
  cctv_inspection: {
    catalogueCategory: 'cctv',
    fields: [
      {
        code: 'room',
        label: 'Which line needs the camera run through it?',
        type: 'select',
        options: ['sewer', 'stormwater', 'kitchen waste', 'not sure'],
      },
    ],
  },
  prv_install: {
    catalogueCategory: 'prv',
    fields: [
      { code: 'room', label: 'Where is the water main / meter located?', type: 'text' },
    ],
  },

  // ── Fallback ────────────────────────────────────────────────────
  other: { fields: GENERIC, usuallyInspection: true },
}

/** Field spec for a job type. Unknown job types fall back to the generic set
 *  rather than rendering nothing. */
export function fieldsForJobType(jobType: string | null | undefined): JobFormSpec {
  return JOB_FIELDS[(jobType ?? '').trim()] ?? { fields: GENERIC, usuallyInspection: true }
}
