// Dump the JSON Schema that Zod produces from SlotExtractionSchema.
// We want to see exactly what gets sent to Anthropic so we can spot
// the offending exclusiveMinimum / maximum.
//
// Usage:
//   node --env-file=.env.local --experimental-strip-types scripts/dump-slot-schema.mjs

import { z } from 'zod'
import { zodToJsonSchema } from 'zod-to-json-schema'

const SlotsSchema = z.object({
  first_name: z.string().nullable().optional(),
  suburb: z.string().nullable().optional(),
  address: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  job_type: z.enum([
    'downlights', 'power_points', 'ceiling_fans', 'smoke_alarms', 'outdoor_lighting',
    'unknown', 'out_of_scope',
  ]).nullable().optional(),
  count: z.number().int().min(1).nullable().optional(),
  room: z.string().nullable().optional(),
  ceiling_type: z.enum([
    'flat_plaster', 'raked', 'cathedral', 'sheet_metal', 'unknown',
  ]).nullable().optional(),
  replace_or_new: z.enum(['replace', 'new']).nullable().optional(),
  colour: z.string().nullable().optional(),
  verified: z.boolean().nullable().optional(),
})

const SlotExtractionSchema = z.object({
  updates: SlotsSchema,
  reasoning: z.string().max(300).default(''),
})

const jsonSchema = zodToJsonSchema(SlotExtractionSchema, 'SlotExtractionSchema')
console.log(JSON.stringify(jsonSchema, null, 2))
