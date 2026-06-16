// Request contract for the estimator chatbot (POST /api/filestore/chat).
// Kept in lib/ (not the route file) so it can be unit-tested — Next 16 rejects
// arbitrary named exports from a route.ts.

import { z } from 'zod'

export const ESTIMATOR_KINDS = ['paint', 'electrical'] as const

export const chatRequestSchema = z.object({
  /** Which estimator the session belongs to — selects the store namespace. */
  estimator: z.enum(ESTIMATOR_KINDS),
  /** The estimator session id: paint_runs.id (paint) or plan_extractions.id (electrical). */
  sessionId: z.string().trim().min(1).max(200),
  /** The customer/tradie's question. */
  query: z.string().trim().min(1).max(2000),
})

export type ChatRequest = z.infer<typeof chatRequestSchema>

export type ParseResult =
  | { ok: true; value: ChatRequest }
  | { ok: false; error: string }

/** Validate + normalise an unknown JSON body into a ChatRequest. */
export function parseChatRequest(input: unknown): ParseResult {
  const r = chatRequestSchema.safeParse(input)
  if (!r.success) {
    const error =
      r.error.issues
        .map((i) => `${i.path.join('.') || 'body'}: ${i.message}`)
        .join('; ') || 'invalid request'
    return { ok: false, error }
  }
  return { ok: true, value: r.data }
}
