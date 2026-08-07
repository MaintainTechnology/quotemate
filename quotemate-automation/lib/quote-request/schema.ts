// ════════════════════════════════════════════════════════════════════
// Generic self-serve quote-request form — request validation + the
// plain-text summary the estimate paths read.
//
// spec: specs/generic-quote-request-form.md §2/§3.
//
// Lives in lib/ (not the route) for the same reason
// lib/painting/request-schema.ts does: the parser is unit-testable
// without spinning up a Next handler, and the route stays a thin HTTP
// boundary that picks the branch by `trade_lead_requests.trade`.
//
// Reuse, not re-declaration:
//   • address  → MeasureAddressSchema (identical to PaintAddressSchema)
//   • roofing  → MeasureInputsSchema + storeys
//   • painting → PaintInputsSchema VERBATIM, so the painting branch feeds
//                runAndSavePaintingQuote the exact payload its own form does
// ════════════════════════════════════════════════════════════════════

import { z } from 'zod'
import { MeasureAddressSchema, MeasureInputsSchema } from '@/lib/roofing/request-schema'
import { PaintInputsSchema } from '@/lib/painting/request-schema'
import {
  CEILING_TYPES,
  CEILING_TYPE_OPTIONS,
  COLORBOND_PROFILE_OPTIONS,
  CONTACT_TIMES,
  CONTACT_TIME_OPTIONS,
  ELECTRICAL_JOBS,
  ELECTRICAL_JOB_OPTIONS,
  HOT_WATER_ENERGY,
  HOT_WATER_ENERGY_OPTIONS,
  HOT_WATER_LOCATIONS,
  HOT_WATER_LOCATION_OPTIONS,
  PAINT_CEILING_OPTIONS,
  PAINT_COAT_OPTIONS,
  PAINT_CONDITION_OPTIONS,
  PAINT_SCOPE_OPTIONS,
  PLUMBING_JOBS,
  PLUMBING_JOB_OPTIONS,
  ROOF_INTENTS,
  ROOF_INTENT_OPTIONS,
  ROOF_MATERIAL_OPTIONS,
  ROOF_PITCH_OPTIONS,
  STOREY_OPTIONS,
  YES_NO_UNSURE,
  YES_NO_UNSURE_OPTIONS,
  labelOf,
  type QuoteRequestTrade,
} from './fields'

const StoreysSchema = z.union([z.literal(1), z.literal(2), z.literal(3)])

/** Every trade asks for these (spec §2, shared fields). Photos are NOT
 *  here: they upload separately to /api/quote-request/[token]/photos and
 *  land on the conversation, which is where the intake pipeline reads
 *  them from. */
const SharedSchema = z.object({
  address: MeasureAddressSchema,
  first_name: z.string().trim().max(80).optional().nullable(),
  contact_time: z.enum(CONTACT_TIMES),
  notes: z.string().max(1000).optional().nullable(),
})

/** Roofing: the measure inputs the deterministic pricer already takes,
 *  plus the customer's storey count (recorded on the thread — the pricer
 *  reads storeys from the measured metrics, never from a declaration). */
export const RoofingFormInputsSchema = MeasureInputsSchema.extend({
  intent: z.enum(ROOF_INTENTS),
  storeys: StoreysSchema,
})

export const ElectricalFormInputsSchema = z.object({
  job_type: z.enum(ELECTRICAL_JOBS),
  quantity: z.number().int().min(1).max(200).optional().nullable(),
  ceiling_type: z.enum(CEILING_TYPES),
  storeys: StoreysSchema,
  /** Is there an existing switch within 5 m (drives cabling scope)? */
  switch_within_5m: z.enum(YES_NO_UNSURE),
})

export const PlumbingFormInputsSchema = z
  .object({
    job_type: z.enum(PLUMBING_JOBS),
    hot_water_energy: z.enum(HOT_WATER_ENERGY).optional().nullable(),
    hot_water_capacity_l: z.number().int().min(10).max(1000).optional().nullable(),
    hot_water_location: z.enum(HOT_WATER_LOCATIONS).optional().nullable(),
  })
  .superRefine((v, ctx) => {
    // The energy source selects the hot-water assembly family and therefore
    // which catalogue row grounds the quote (lib/intake/schema.ts, WP5/R26).
    // 'unsure' is a legitimate answer — it routes to inspection rather than
    // letting anything guess. Absent is not: ask.
    if (v.job_type === 'hot_water' && !v.hot_water_energy) {
      ctx.addIssue({
        code: 'custom',
        path: ['hot_water_energy'],
        message: 'Tell us if the hot water system is gas or electric',
      })
    }
  })

export const QuoteRequestSchemas = {
  roofing: SharedSchema.extend({ inputs: RoofingFormInputsSchema }),
  painting: SharedSchema.extend({ inputs: PaintInputsSchema }),
  electrical: SharedSchema.extend({ inputs: ElectricalFormInputsSchema }),
  plumbing: SharedSchema.extend({ inputs: PlumbingFormInputsSchema }),
} as const

type WithTrade<T extends QuoteRequestTrade> = z.infer<(typeof QuoteRequestSchemas)[T]> & { trade: T }
/** Discriminated on `trade`, so a `switch` narrows `inputs` per branch. */
export type QuoteRequestData = { [T in QuoteRequestTrade]: WithTrade<T> }[QuoteRequestTrade]

export type ParsedQuoteRequest =
  | { ok: true; data: QuoteRequestData }
  | { ok: false; issues: readonly unknown[] }

/** Validate a submitted form against the schema for THAT lead's trade. */
export function parseQuoteRequest(trade: QuoteRequestTrade, body: unknown): ParsedQuoteRequest {
  const parsed = QuoteRequestSchemas[trade].safeParse(body)
  if (!parsed.success) return { ok: false, issues: parsed.error.issues }
  return { ok: true, data: { ...parsed.data, trade } as QuoteRequestData }
}

/**
 * The submission as one plain-text block. Written onto the SMS thread as
 * an inbound message so (a) the tradie sees exactly what was submitted and
 * (b) the electrical/plumbing hand-off works at all — /api/intake/structure
 * structures the conversation TRANSCRIPT, so anything not on the thread is
 * invisible to it.
 *
 * No em dashes: the canonical form-offer opener is the one place that keeps
 * one (it standardises on shipped painting copy).
 */
export function summariseSubmission(data: QuoteRequestData): string {
  const lines = [
    `Quote request form (${data.trade})`,
    `Address: ${data.address.address}, ${data.address.state} ${data.address.postcode}`,
  ]
  if (data.first_name) lines.push(`Name: ${data.first_name}`)
  lines.push(`Best time to contact: ${labelOf(CONTACT_TIME_OPTIONS, data.contact_time)}`)

  switch (data.trade) {
    case 'roofing': {
      const i = data.inputs
      lines.push(
        `Work needed: ${labelOf(ROOF_INTENT_OPTIONS, i.intent)}`,
        `Current roof material: ${labelOf(ROOF_MATERIAL_OPTIONS, i.material)}`,
        `Roof pitch: ${labelOf(ROOF_PITCH_OPTIONS, i.pitch)}`,
        `Storeys: ${labelOf(STOREY_OPTIONS, i.storeys)}`,
      )
      if (i.building_year_built) lines.push(`Year built: ${i.building_year_built}`)
      break
    }
    case 'painting': {
      const i = data.inputs
      lines.push(
        `Surfaces: ${i.scopes.map((s) => labelOf(PAINT_SCOPE_OPTIONS, s)).join(', ')}`,
        `Coats: ${labelOf(PAINT_COAT_OPTIONS, i.coats)}`,
        `Surface condition: ${labelOf(PAINT_CONDITION_OPTIONS, i.condition)}`,
        `Ceiling height: ${labelOf(PAINT_CEILING_OPTIONS, i.ceiling_height)}`,
        `Storeys: ${labelOf(STOREY_OPTIONS, (i.storeys ?? 1) as 1 | 2 | 3)}`,
        `Colour change: ${i.colour_change ? 'yes' : 'no'}`,
      )
      if (i.manual_floor_area_m2) lines.push(`Floor area supplied: ${i.manual_floor_area_m2} m2`)
      break
    }
    case 'electrical': {
      const i = data.inputs
      lines.push(
        `Job type: ${labelOf(ELECTRICAL_JOB_OPTIONS, i.job_type)}`,
        `How many: ${i.quantity ?? 'not supplied'}`,
        `Ceiling type: ${labelOf(CEILING_TYPE_OPTIONS, i.ceiling_type)}`,
        `Storeys: ${labelOf(STOREY_OPTIONS, i.storeys)}`,
        `Existing switch within 5 m: ${labelOf(YES_NO_UNSURE_OPTIONS, i.switch_within_5m)}`,
      )
      break
    }
    case 'plumbing': {
      const i = data.inputs
      lines.push(`Job type: ${labelOf(PLUMBING_JOB_OPTIONS, i.job_type)}`)
      if (i.job_type === 'hot_water') {
        lines.push(
          `Hot water system: ${labelOf(HOT_WATER_ENERGY_OPTIONS, i.hot_water_energy)}`,
          `Capacity: ${i.hot_water_capacity_l ? `${i.hot_water_capacity_l} L` : 'not supplied'}`,
          `Location: ${labelOf(HOT_WATER_LOCATION_OPTIONS, i.hot_water_location)}`,
        )
      }
      break
    }
  }

  if (data.notes) lines.push(`Notes: ${data.notes}`)
  return lines.join('\n')
}

/**
 * The IntakeSchema job_type this submission maps onto, or null when there
 * is no honest mapping. Written to sms_conversations.conversation_state so
 * /api/intake/structure derives the right TRADE HINT
 * (deriveTradeFromJobType) instead of defaulting to electrical.
 *
 * ⚠ Plumbing "something else" returns null deliberately: IntakeSchema has
 * no generic plumbing job_type, and 'other' derives to ELECTRICAL. Writing
 * it would ground Opus in the wrong trade's vocabulary; leaving the slot
 * alone preserves whatever the SMS thread already classified.
 */
export function intakeJobTypeHint(data: QuoteRequestData): string | null {
  if (data.trade === 'electrical') return data.inputs.job_type
  if (data.trade !== 'plumbing') return null
  switch (data.inputs.job_type) {
    case 'hot_water':
      return 'hot_water'
    case 'blocked_drain':
      return 'blocked_drain'
    case 'tap':
      return 'tap_repair'
    case 'toilet':
      return 'toilet_repair'
    default:
      return null
  }
}

/** The single roofing material value from the family + profile the form
 *  asks for. Exported for the client form (and its test). */
export function roofMaterialValue(family: string, profile: string): string {
  if (family !== 'colorbond') return family
  return (COLORBOND_PROFILE_OPTIONS as ReadonlyArray<readonly [string, string]>).some(
    ([v]) => v === profile,
  )
    ? profile
    : 'colorbond_corrugated'
}
