// ════════════════════════════════════════════════════════════════════
// Generic self-serve quote-request form — the option vocabularies.
//
// spec: specs/generic-quote-request-form.md §2.
//
// PURE DATA, ZERO IMPORTS. Deliberately separate from ./schema.ts so the
// CLIENT form component can import the option lists without pulling zod
// into the browser bundle, while the server-side Zod schemas and the
// transcript summary read the SAME lists. PaintRequestForm re-declares its
// vocabularies by hand and keeps them in sync with the schema manually;
// that drift class is closed here by having one source.
//
// Labels that say "(forces inspection)" are deliberate: the customer is
// told up front why that answer produces a site visit instead of a price.
// ════════════════════════════════════════════════════════════════════

/** The four trades that mint a trade_lead_requests row. Solar and
 *  commercial painting have their own flows (spec non-goals). */
export const QUOTE_REQUEST_TRADES = ['electrical', 'plumbing', 'roofing', 'painting'] as const
export type QuoteRequestTrade = (typeof QUOTE_REQUEST_TRADES)[number]

export function isQuoteRequestTrade(v: unknown): v is QuoteRequestTrade {
  return typeof v === 'string' && (QUOTE_REQUEST_TRADES as readonly string[]).includes(v)
}

/** Customer-facing trade word. Same list the canonical opener uses. */
export const TRADE_WORD: Record<QuoteRequestTrade, string> = {
  electrical: 'electrical',
  plumbing: 'plumbing',
  roofing: 'roofing',
  painting: 'painting',
}

/** One label/value pair. Tuples (not objects) to match the painting form. */
export type Options<T extends string | number> = ReadonlyArray<readonly [T, string]>

export const AU_STATES = ['NSW', 'VIC', 'QLD', 'SA', 'WA', 'TAS', 'ACT', 'NT'] as const
export type AuState = (typeof AU_STATES)[number]

// ─── Shared ─────────────────────────────────────────────────────────

export const CONTACT_TIMES = ['anytime', 'morning', 'afternoon', 'evening'] as const
export type ContactTime = (typeof CONTACT_TIMES)[number]
export const CONTACT_TIME_OPTIONS: Options<ContactTime> = [
  ['anytime', 'Anytime'],
  ['morning', 'Morning'],
  ['afternoon', 'Afternoon'],
  ['evening', 'Evening'],
]

export const STOREY_OPTIONS: Options<1 | 2 | 3> = [
  [1, 'Single storey'],
  [2, 'Double storey'],
  [3, '3 storeys (forces inspection)'],
]

// ─── Roofing ────────────────────────────────────────────────────────

export const ROOF_INTENTS = [
  'full_reroof',
  'patch_repair',
  'leak_trace',
  'gutter_replace',
] as const
export type RoofIntent = (typeof ROOF_INTENTS)[number]
export const ROOF_INTENT_OPTIONS: Options<RoofIntent> = [
  ['full_reroof', 'Full re-roof'],
  ['patch_repair', 'Repair'],
  ['leak_trace', 'Leak trace'],
  ['gutter_replace', 'Gutters'],
]

/** What the customer picks first. `colorbond` then asks for the profile;
 *  every other value IS the wire `material` value. */
export const ROOF_MATERIAL_FAMILIES = [
  'colorbond',
  'concrete_tile',
  'terracotta_tile',
  'cement_sheet',
  'unknown',
] as const
export type RoofMaterialFamily = (typeof ROOF_MATERIAL_FAMILIES)[number]
export const ROOF_MATERIAL_FAMILY_OPTIONS: Options<RoofMaterialFamily> = [
  ['colorbond', 'Colorbond / metal'],
  ['concrete_tile', 'Concrete tile'],
  ['terracotta_tile', 'Terracotta tile'],
  ['cement_sheet', 'Cement sheet (forces inspection)'],
  ['unknown', 'Not sure'],
]

export const COLORBOND_PROFILES = [
  'colorbond_corrugated',
  'colorbond_trimdek',
  'colorbond_spandek',
  'colorbond_kliplok',
] as const
export type ColorbondProfile = (typeof COLORBOND_PROFILES)[number]
export const COLORBOND_PROFILE_OPTIONS: Options<ColorbondProfile> = [
  ['colorbond_corrugated', 'Corrugated'],
  ['colorbond_trimdek', 'Trimdek'],
  ['colorbond_spandek', 'Spandek'],
  ['colorbond_kliplok', 'Kliplok'],
]

/** The wire value: every Colorbond profile plus the non-metal families. */
export const ROOF_MATERIAL_OPTIONS: Options<string> = [
  ...COLORBOND_PROFILE_OPTIONS.map(([v, l]) => [v, `Colorbond ${l.toLowerCase()}`] as const),
  ['concrete_tile', 'Concrete tile'],
  ['terracotta_tile', 'Terracotta tile'],
  ['cement_sheet', 'Cement sheet'],
  ['unknown', 'Not sure'],
]

export const ROOF_PITCHES = ['shallow', 'standard', 'steep', 'very_steep', 'unknown'] as const
export type RoofPitch = (typeof ROOF_PITCHES)[number]
export const ROOF_PITCH_OPTIONS: Options<RoofPitch> = [
  ['shallow', 'Shallow (under 20 degrees)'],
  ['standard', 'Standard (20 to 25 degrees)'],
  ['steep', 'Steep (26 to 35 degrees)'],
  ['very_steep', 'Very steep (over 35 degrees, forces inspection)'],
  ['unknown', 'Not sure (forces inspection)'],
]

// ─── Painting ───────────────────────────────────────────────────────
// Values must stay identical to lib/painting/request-schema.ts —
// PaintInputsSchema is reused verbatim as the painting branch.

export const PAINT_SCOPE_OPTIONS: Options<'walls' | 'ceilings' | 'trim' | 'exterior'> = [
  ['walls', 'Interior walls'],
  ['ceilings', 'Ceilings'],
  ['trim', 'Trim (skirting / architraves)'],
  ['exterior', 'Exterior'],
]
export const PAINT_COAT_OPTIONS: Options<1 | 2 | 3> = [
  [1, '1 coat, refresh'],
  [2, '2 coats, standard'],
  [3, '3 coats, premium'],
]
export const PAINT_CONDITION_OPTIONS: Options<'sound' | 'minor' | 'bare' | 'poor'> = [
  ['sound', 'Sound, previously painted'],
  ['minor', 'Minor patching'],
  ['bare', 'Bare / new, needs priming'],
  ['poor', 'Poor, flaking / damage (forces inspection)'],
]
export const PAINT_CEILING_OPTIONS: Options<'standard' | 'high' | 'extra_high' | 'raked'> = [
  ['standard', 'Standard (about 2.4 m)'],
  ['high', 'High (about 2.7 m, Queenslander / period)'],
  ['extra_high', 'Very high (3 m+, forces inspection)'],
  ['raked', 'Raked / cathedral (forces inspection)'],
]

// ─── Electrical ─────────────────────────────────────────────────────

export const ELECTRICAL_JOBS = ['downlights', 'power_points', 'ceiling_fans', 'other'] as const
export type ElectricalJob = (typeof ELECTRICAL_JOBS)[number]
export const ELECTRICAL_JOB_OPTIONS: Options<ElectricalJob> = [
  ['downlights', 'Downlights'],
  ['power_points', 'Power points'],
  ['ceiling_fans', 'Ceiling fans'],
  ['other', 'Something else'],
]

/** Matches IntakeSchema.access.ceiling_type so the structurer reads it
 *  back in its own vocabulary. */
export const CEILING_TYPES = ['flat', 'raked', 'high', 'unknown'] as const
export type CeilingType = (typeof CEILING_TYPES)[number]
export const CEILING_TYPE_OPTIONS: Options<CeilingType> = [
  ['flat', 'Flat plasterboard'],
  ['raked', 'Raked / cathedral'],
  ['high', 'High (3 m+)'],
  ['unknown', 'Not sure'],
]

export const YES_NO_UNSURE = ['yes', 'no', 'unsure'] as const
export type YesNoUnsure = (typeof YES_NO_UNSURE)[number]
export const YES_NO_UNSURE_OPTIONS: Options<YesNoUnsure> = [
  ['yes', 'Yes'],
  ['no', 'No'],
  ['unsure', 'Not sure'],
]

// ─── Plumbing ───────────────────────────────────────────────────────

export const PLUMBING_JOBS = ['hot_water', 'blocked_drain', 'tap', 'toilet', 'other'] as const
export type PlumbingJob = (typeof PLUMBING_JOBS)[number]
export const PLUMBING_JOB_OPTIONS: Options<PlumbingJob> = [
  ['hot_water', 'Hot water'],
  ['blocked_drain', 'Blocked drain'],
  ['tap', 'Tap'],
  ['toilet', 'Toilet'],
  ['other', 'Something else'],
]

export const HOT_WATER_ENERGY = ['gas', 'electric', 'unsure'] as const
export type HotWaterEnergy = (typeof HOT_WATER_ENERGY)[number]
export const HOT_WATER_ENERGY_OPTIONS: Options<HotWaterEnergy> = [
  ['gas', 'Gas'],
  ['electric', 'Electric'],
  ['unsure', 'Not sure (forces inspection)'],
]

export const HOT_WATER_LOCATIONS = ['indoor', 'outdoor', 'unsure'] as const
export type HotWaterLocation = (typeof HOT_WATER_LOCATIONS)[number]
export const HOT_WATER_LOCATION_OPTIONS: Options<HotWaterLocation> = [
  ['indoor', 'Indoors'],
  ['outdoor', 'Outdoors'],
  ['unsure', 'Not sure'],
]

/** Human label for a stored value, falling back to the raw value so a
 *  vocabulary gap degrades to something readable instead of blank. */
export function labelOf<T extends string | number>(options: Options<T>, value: T | null | undefined): string {
  if (value === null || value === undefined) return 'not supplied'
  return options.find(([v]) => v === value)?.[1] ?? String(value)
}
