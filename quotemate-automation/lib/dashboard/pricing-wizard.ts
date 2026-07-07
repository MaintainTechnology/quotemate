// Pricing Wizard — pure state + payload builder.
//
// The dashboard's /dashboard/pricing-wizard page is a 3-step guided form
// that lets a new tradie fill in their cookbook + rate card WITHOUT
// uploading a CSV or filling out the detailed Services tab. It collects
// the same 3 pieces of data the dashboard already accepts:
//
//   Step 1 — rate card (hourly_rate, call_out_minimum, default_markup_pct,
//            after_hours_multiplier)         → /api/tenant/me PATCH { pricing }
//   Step 2 — which services you offer (toggle map keyed by assembly_id)
//                                            → /api/tenant/me PATCH { services }
//   Step 3 — preferred brand per category (free-text or null)
//                                            → /api/tenant/me PATCH { material_preferences }
//
// The page accumulates these client-side and PATCHes the lot in ONE call
// at the end so a partial wizard (cancel mid-flow) doesn't leave a half-
// configured cookbook.
//
// This module is pure — no React, no fetch, no DB — so we can unit-test
// the validation + payload-shaping without spinning up a browser or a
// server. The page imports the schema + the payload builder.

import { z } from 'zod'

// ─────────────────────────────────────────────────────────────────────
// Step 1 — rate card
// ─────────────────────────────────────────────────────────────────────

export const RateCardSchema = z.object({
  hourly_rate: z.number().positive().max(10_000),
  call_out_minimum: z.number().nonnegative().max(100_000),
  default_markup_pct: z.number().min(0).max(100),
  after_hours_multiplier: z.number().min(1).max(3),
})
export type RateCard = z.infer<typeof RateCardSchema>

// ─────────────────────────────────────────────────────────────────────
// Step 2 — which services do you offer?
// ─────────────────────────────────────────────────────────────────────

/** Map of assembly_id (uuid) → toggle. The dashboard's /api/tenant/me
 *  PATCH accepts the same shape directly on the `services` key. */
export const ServiceTogglesSchema = z.record(
  z.string().uuid(),
  z.boolean(),
)
export type ServiceToggles = z.infer<typeof ServiceTogglesSchema>

// ─────────────────────────────────────────────────────────────────────
// Step 3 — preferred brand per category
// ─────────────────────────────────────────────────────────────────────

/** Map of category slug (e.g. "downlight", "hot_water") → preferred brand.
 *  An empty string OR null clears the preference (matches the dashboard
 *  PATCH semantics on `material_preferences`). */
export const BrandPreferencesSchema = z.record(
  z.string().min(1).max(40),
  z.union([z.string().trim().min(1).max(80), z.null(), z.literal('')]),
)
export type BrandPreferences = z.infer<typeof BrandPreferencesSchema>

// ─────────────────────────────────────────────────────────────────────
// Full wizard payload (sent to /api/tenant/me PATCH at the end)
// ─────────────────────────────────────────────────────────────────────

export const WizardAnswersSchema = z.object({
  rateCard: RateCardSchema.optional(),
  services: ServiceTogglesSchema.optional(),
  brands: BrandPreferencesSchema.optional(),
})
export type WizardAnswers = z.infer<typeof WizardAnswersSchema>

/** Build the /api/tenant/me PATCH body from the wizard's accumulated
 *  answers. The dashboard PATCH route accepts these top-level keys:
 *    - pricing               → applies to every pricing_book row
 *    - services              → assembly_id → enabled map
 *    - material_preferences  → category → brand-or-null map
 *
 *  Returns null when the wizard collected no usable answers (the caller
 *  can short-circuit and avoid a no-op PATCH call). */
export function buildPatchPayload(
  answers: WizardAnswers,
): Record<string, unknown> | null {
  const body: Record<string, unknown> = {}
  if (answers.rateCard) {
    body.pricing = {
      hourly_rate: answers.rateCard.hourly_rate,
      call_out_minimum: answers.rateCard.call_out_minimum,
      default_markup_pct: answers.rateCard.default_markup_pct,
      after_hours_multiplier: answers.rateCard.after_hours_multiplier,
    }
  }
  if (answers.services && Object.keys(answers.services).length > 0) {
    body.services = answers.services
  }
  if (answers.brands && Object.keys(answers.brands).length > 0) {
    // Strip empty strings → null so the dashboard's PATCH route deletes
    // the existing row instead of upserting a blank brand.
    const cleaned: Record<string, string | null> = {}
    for (const [k, v] of Object.entries(answers.brands)) {
      if (v == null || v === '') cleaned[k] = null
      else cleaned[k] = String(v).trim()
    }
    body.material_preferences = cleaned
  }
  if (Object.keys(body).length === 0) return null
  return body
}

// ─────────────────────────────────────────────────────────────────────
// Helpers used by the page
// ─────────────────────────────────────────────────────────────────────

/** Categories the wizard asks about in Step 3 — derived from the trade(s)
 *  the tradie offers. Mirrors the categories actually present in
 *  shared_assemblies / shared_materials today; keeps the wizard's brand
 *  question list tight rather than dumping every category on every tradie. */
const ELECTRICAL_CATEGORIES = [
  'downlight',
  'gpo',
  'smoke_alarm',
  'fan',
  'outdoor_light',
  'rcbo',
  'oven_cooktop',
  'ev_charger',
  'switchboard',
  'strip_light',
  'security_camera',
  'doorbell_intercom',
] as const

const PLUMBING_CATEGORIES = [
  'hot_water',
  'tap',
  'toilet',
  'drain',
  'shower',
  'cctv',
  'prv',
  'gas',
  'dishwasher',
  'rainwater_tank',
  'water_filter',
  'leak_detection',
] as const

export type WizardCategory = {
  slug: string
  /** A short human label the wizard shows next to the brand input. */
  label: string
}

/** Map a category slug to a human label. Falls back to the slug when no
 *  label is registered — adding a new category in code without updating
 *  this map degrades gracefully. */
const CATEGORY_LABELS: Record<string, string> = {
  // Electrical
  downlight:         'Downlights',
  gpo:               'Power points (GPOs)',
  smoke_alarm:       'Smoke alarms',
  fan:               'Ceiling fans',
  outdoor_light:     'Outdoor lighting',
  rcbo:              'Safety switches (RCBOs)',
  oven_cooktop:      'Ovens / cooktops',
  ev_charger:        'EV chargers',
  switchboard:       'Switchboards',
  strip_light:       'LED strip lighting',
  security_camera:   'Security cameras',
  doorbell_intercom: 'Doorbells / intercoms',
  // Plumbing
  hot_water:         'Hot water systems',
  tap:               'Taps / mixers',
  toilet:            'Toilets',
  drain:             'Drains',
  shower:            'Showers / heads',
  cctv:              'Drain CCTV',
  prv:               'PRVs',
  gas:               'Gas fitting',
  dishwasher:        'Dishwashers',
  rainwater_tank:    'Rainwater tanks',
  water_filter:      'Water filters',
  leak_detection:    'Leak detection',
  // ── Live catalogue slugs (shared_materials.category) ──────────────
  // The wizard's Step 3 is driven off the ACTUAL catalogue categories the
  // estimator grounds against (see buildPreferencesBlock in
  // lib/estimate/run.ts), so these MUST carry a friendly label too or a
  // real category renders as its raw slug. Electrical catalogue:
  ceiling_fan:       'Ceiling fans',
  safety_switch:     'Safety switches (RCBOs)',
  sundries:          'Sundries / consumables',
  // Plumbing catalogue:
  hws_electric:      'Electric hot water',
  hws_gas:           'Gas hot water',
  hws_heat_pump:     'Heat-pump hot water',
  tapware_basin:     'Basin / bath tapware',
  tapware_kitchen:   'Kitchen tapware',
  tapware_laundry:   'Laundry tapware',
  tapware_outdoor:   'Outdoor / garden taps',
  toilet_repair:     'Toilet repairs (cistern)',
}

/** Human label for a catalogue category slug. Uses the curated
 *  CATEGORY_LABELS map when present, else a title-cased humanisation of the
 *  slug so a brand-new catalogue category never renders as a raw
 *  `snake_case` token in the wizard. */
export function labelForCategory(slug: string): string {
  const mapped = CATEGORY_LABELS[slug]
  if (mapped) return mapped
  const s = slug.replace(/[_-]+/g, ' ').trim()
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : slug
}

export function categoriesForTrades(trades: ReadonlyArray<string>): WizardCategory[] {
  const out: WizardCategory[] = []
  const seen = new Set<string>()
  const tradeSet = new Set(trades.map((t) => t.toLowerCase()))
  const push = (slug: string) => {
    if (seen.has(slug)) return
    seen.add(slug)
    out.push({ slug, label: CATEGORY_LABELS[slug] ?? slug })
  }
  if (tradeSet.has('electrical')) ELECTRICAL_CATEGORIES.forEach(push)
  if (tradeSet.has('plumbing')) PLUMBING_CATEGORIES.forEach(push)
  return out
}

// ─────────────────────────────────────────────────────────────────────
// Step 3 — common brand quick-fill
// ─────────────────────────────────────────────────────────────────────

/** Common-brand quick-fill suggestions per trade. Used by the wizard's
 *  Step 3 "Fill all" pill row so a tradie can stamp e.g. "Clipsal" onto
 *  every electrical category in one click instead of typing it into
 *  each field. The list stays short on purpose — these are the brands
 *  Australian sparkies/plumbers reach for first; anything bespoke they
 *  still type by hand. */
const COMMON_BRANDS_ELECTRICAL = ['Clipsal', 'HPM', 'Legrand', 'PDL'] as const
const COMMON_BRANDS_PLUMBING = ['Rheem', 'Rinnai', 'Caroma', 'Dux'] as const

export function commonBrandsForTrades(trades: ReadonlyArray<string>): string[] {
  const tradeSet = new Set(trades.map((t) => t.toLowerCase()))
  const out: string[] = []
  const seen = new Set<string>()
  const push = (b: string) => {
    if (seen.has(b)) return
    seen.add(b)
    out.push(b)
  }
  if (tradeSet.has('electrical')) COMMON_BRANDS_ELECTRICAL.forEach(push)
  if (tradeSet.has('plumbing')) COMMON_BRANDS_PLUMBING.forEach(push)
  return out
}

/** Step labels — kept in the pure module so the page + tests stay in sync. */
export const STEP_LABELS = [
  'Your rate card',
  'Which jobs you do',
  'Preferred brands',
] as const

export type StepIndex = 0 | 1 | 2

export function nextStep(s: StepIndex): StepIndex | null {
  if (s === 0) return 1
  if (s === 1) return 2
  return null
}

export function prevStep(s: StepIndex): StepIndex | null {
  if (s === 2) return 1
  if (s === 1) return 0
  return null
}
