// LLM categorisation of a historical quote into the canonical job_type taxonomy
// (spec R6). The model ONLY classifies — it never produces or adjusts a price.
// Schema reuses the intake job_type enum so output is constrained to the exact
// canonical value set. Degrades to {other, low} when the model is unavailable.

import { anthropic } from '@ai-sdk/anthropic'
import { generateObject } from 'ai'
import { z } from 'zod'
import { JobTypeEnum, tradeForJobType, type JobType, type Trade } from './job-types'
import type { Confidence } from './types'

export const CATEGORIZE_MODEL = 'claude-sonnet-4-6'

export const CategorizeSchema = z.object({
  job_type: JobTypeEnum,
  confidence: z.enum(['high', 'medium', 'low']),
  reason: z.string().max(200),
})

export type CategorizeResult = {
  job_type: JobType
  trade: Trade | null
  confidence: Confidence
  reason: string
  via: 'model' | 'fallback'
}

const CATEGORIZE_SYSTEM =
  "You categorise a tradie's historical quote into exactly one canonical job_type " +
  'from the QuoteMax taxonomy (electrical + plumbing trades). Read the quote ' +
  'description and pick the single best-matching job_type. If nothing fits, use ' +
  '"other". Set confidence "high" only when the description clearly names the work, ' +
  '"low" when it is vague or ambiguous. You only classify — never invent prices or facts.'

export async function categorizeQuote(
  input: { description: string | null; tradeHint?: string | null },
  opts?: { model?: string },
): Promise<CategorizeResult> {
  const fallback: CategorizeResult = {
    job_type: 'other',
    trade: null,
    confidence: 'low',
    reason: 'no model available',
    via: 'fallback',
  }
  const desc = (input.description ?? '').trim()
  if (!desc || !process.env.ANTHROPIC_API_KEY) return fallback
  try {
    const { object } = await generateObject({
      model: anthropic(opts?.model ?? CATEGORIZE_MODEL),
      schema: CategorizeSchema,
      temperature: 0,
      maxRetries: 0,
      system: CATEGORIZE_SYSTEM,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `${input.tradeHint ? `Trade hint: ${input.tradeHint}\n` : ''}Quote description:\n${desc}`,
            },
          ],
        },
      ],
    })
    return {
      job_type: object.job_type,
      trade: tradeForJobType(object.job_type),
      confidence: object.confidence,
      reason: object.reason,
      via: 'model',
    }
  } catch {
    return fallback
  }
}
