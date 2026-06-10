// Use the EXACT same imports/code path as production to test slot extraction.
// If this works, the fix is sound and Vercel is just stale.

import { generateObject } from 'ai'
import { anthropic } from '@ai-sdk/anthropic'
import { z } from 'zod'

const SlotsSchema = z.object({
  first_name: z.string().nullable().optional(),
  count: z.number().nullable().optional(),
  job_type: z.enum(['downlights', 'power_points', 'ceiling_fans', 'smoke_alarms', 'outdoor_lighting', 'unknown', 'out_of_scope']).nullable().optional(),
})
const SlotExtractionSchema = z.object({
  updates: SlotsSchema,
  reasoning: z.string().max(300).default(''),
})

try {
  const { object } = await generateObject({
    model: anthropic('claude-haiku-4-5-20251001'),
    schema: SlotExtractionSchema,
    system: 'Extract slot values.',
    prompt: 'Customer says: "6 downlights"',
  })
  console.log('SUCCESS — AI SDK + Anthropic accepted the schema')
  console.log(JSON.stringify(object, null, 2))
} catch (err) {
  console.error('FAILURE — AI SDK rejected the schema')
  console.error(err.message)
  if (err.cause) console.error('Cause:', err.cause.message)
  process.exit(1)
}
