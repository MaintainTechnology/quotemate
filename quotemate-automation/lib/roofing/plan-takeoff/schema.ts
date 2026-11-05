// RoofPlanTakeoff v1 (Service Spec §6): the one schema for every write to
// plan_extractions.items (the model's reading) and corrected_items (the
// operator's edits). Lengths in millimetres, areas in m², pitch in degrees.
// A size or pitch the drawings don't give is null, never 0 (DEC-017).

import { z } from 'zod'
import { SHEET_KINDS } from './classify'

const confidence = z.enum(['high', 'medium', 'low'])
const point = z.tuple([z.number(), z.number()])

// Bounds (TKO-28, DEC-024): generous beside any reading so far (Grange's has 4
// roofs, 49 sheets and no text over 282 characters), so what a hostile body
// can store, and the strings the pricer matches, stay bounded.
const text = (max = 2000) => z.string().max(max)
const id = z.string().min(1).max(60)
const fileName = z.string().min(1).max(255)

export const EvidenceSchema = z.object({
  file: fileName,
  page: z.number().int().positive(),
  text: text().nullable(),
  bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]).nullable(),
})

export const PITCH_SOURCES = ['note', 'section', 'elevation', 'engineering', 'aerial'] as const
export const EDGE_TYPES = ['ridge', 'hip', 'valley', 'barge', 'eave', 'high_side', 'apron', 'box_gutter', 'parapet'] as const

export const PlaneSchema = z.object({
  id,
  plan_dims_mm: point.nullable(),
  polygon_mm: z.array(point).max(1000).nullable(),
  plan_area_m2: z.number().nonnegative().nullable(),
  pitch_deg: z.number().min(0).max(90).nullable(),
  pitch_source: z.enum(PITCH_SOURCES).nullable(),
  fall: text(200).nullable(),
  profile: text(200).nullable(),
  finish_tag: text(200).nullable(),
  sloped_area_m2: z.number().nonnegative().nullable(),
  confidence,
  evidence: z.array(EvidenceSchema).max(50),
})

export const EdgeSchema = z.object({
  type: z.enum(EDGE_TYPES),
  length_m: z.number().nonnegative().nullable(),
  source: z.enum(['measured', 'derived']),
  confidence,
})

/** The aerial building a hybrid roof was measured from (TKO-21): Geoscape's
 *  id, footprint and outline, and the drawn plan area it replaced, which C10
 *  sets against it. */
export const AerialSchema = z.object({
  building_id: z.string().max(100).nullable(),
  footprint_m2: z.number().nonnegative(),
  drawn_plan_m2: z.number().nonnegative().nullable(),
  polygon: z.object({
    type: z.literal('Polygon'),
    coordinates: z.array(z.array(z.array(z.number()).min(2).max(3)).max(1000)).max(10),
  }).nullable(),
})

export const StructureSchema = z.object({
  id,
  label: z.string().min(1).max(200),
  role: z.enum(['primary', 'secondary']),
  source: z.enum(['plans', 'aerial', 'hybrid']),
  planes: z.array(PlaneSchema).max(100),
  edges: z.array(EdgeSchema).max(400),
  exclusions: z.array(z.object({ label: text(200), reason: text(), area_m2: z.number().nonnegative().nullable() })).max(50),
  aerial: AerialSchema.optional(),
})

export const SheetSchema = z.object({
  file: z.string().max(255),
  page: z.number().int().positive(),
  number: text(300).nullable(),
  title: text(300).nullable(),
  revision: text(300).nullable(),
  status_text: text(300).nullable(),
  kind: z.enum(SHEET_KINDS),
  used: z.boolean(),
})

export const RoofPlanTakeoffSchema = z.object({
  version: z.literal(1),
  scale: z.object({
    stated: text(200).nullable(),
    sheet_size: text(40).nullable(),
    pdf_page: point,
    calibration: z.object({
      method: z.enum(['dimension_string', 'title_block', 'none']),
      reference_mm: z.number().nullable(),
      factor: z.number().nullable(),
      delta_pct: z.number().nullable(),
    }),
  }),
  sheets: z.array(SheetSchema).max(400),
  structures: z.array(StructureSchema).max(50),
  scope: z.object({ includes: z.array(text()).max(100), excludes: z.array(text()).max(100), questions: z.array(text()).max(100) }),
})

export type RoofPlanTakeoff = z.infer<typeof RoofPlanTakeoffSchema>
export type Evidence = z.infer<typeof EvidenceSchema>

/** A body too big to be a reading, found without parsing it: zod parses every
 *  element before it counts any, so a hostile body of empty roofs makes
 *  millions of issues (seconds of a blocked event loop). The walk stops at the
 *  first limit it passes; Grange's reading has 700 values. */
export function takeoffTooLarge(value: unknown, limits = { values: 20_000, characters: 200_000 }): boolean {
  let values = 0
  let characters = 0
  const stack: unknown[] = [value]
  while (stack.length) {
    const next = stack.pop()
    if (typeof next === 'string') {
      characters += next.length
      if (characters > limits.characters) return true
      continue
    }
    if (!next || typeof next !== 'object') continue
    const children = Array.isArray(next) ? next : Object.values(next)
    values += children.length
    if (values > limits.values) return true
    stack.push(...children)
  }
  return false
}
