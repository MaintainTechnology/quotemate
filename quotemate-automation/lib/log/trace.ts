// Phase 7 — structured pipeline tracer.
//
// Companion to lib/log/pipeline.ts. The existing pipelineLog() helper
// emits scannable lines to stdout for Vercel's log viewer; it stays
// untouched so every existing caller keeps working. This module adds:
//
//   1. A typed shape (PipelineTrace) for structured trace events
//   2. A truncation helper so giant JSON payloads don't blow up the
//      DB or the dashboard renderer
//   3. recordTrace() — fire-and-forget DB insert into pipeline_traces
//      (mig 076). Errors are swallowed silently so logging can never
//      break a quote
//   4. createTracer() — convenience factory that binds tenant_id /
//      intake_id / sms_conversation_id once so callers don't repeat
//      themselves on every event
//
// Read path: the dashboard Pipeline tab (Phase 7b) queries
// pipeline_traces by intake_id (or sms_conversation_id) ordered by
// created_at to render a step-by-step timeline.

import type { SupabaseClient } from '@supabase/supabase-js'

/** High-level stages — keep this list small so the dashboard can render
 *  a fixed-order timeline. Add a new entry only when introducing a new
 *  pipeline stage, not a sub-stage (those go in `substep`). */
export type TraceStep =
  | 'sms_inbound'        // /api/sms/inbound webhook entry + persistence
  | 'extract_slots'      // lib/sms/extract-slots — slot extractor LLM call
  | 'dialog'             // lib/sms/dialog — reply + decision LLM call
  | 'intake_structurer'  // lib/intake/structure — structured intake
  | 'estimate'           // lib/estimate/run — draft + merge + validate
  | 'dispatch'           // outbound SMS / WhatsApp / email
  | 'vapi_inbound'       // /api/vapi/webhook
  | 'quote_view'         // customer hits /q/[token]

export type TraceStatus = 'ok' | 'warn' | 'err'

/** Shape of a single structured trace event. Mirrors the
 *  pipeline_traces table columns 1:1. */
export interface PipelineTrace {
  step: TraceStep
  /** Optional sub-stage within the step — recipe_merge, min_labour_floor,
   *  validate_grounding, twilio_send, etc. */
  substep?: string
  status: TraceStatus
  /** One-line human-readable summary. Kept ≤500 chars so the dashboard
   *  list view stays scannable. */
  message?: string
  /** What arrived at this step. Truncated to ~16KB before insert. */
  inputs?: unknown
  /** What this step produced. Same truncation budget. */
  outputs?: unknown
  /** Key choices the step made — "picked assembly X", "recipe fired", etc.
   *  Limited shape — the dashboard renders these as a key:value list. */
  decisions?: Record<string, unknown>
  /** Step latency. Use 0 when not measured. */
  duration_ms?: number
  /** Optional FK joins. Any combination may be set; null when unknown. */
  tenant_id?: string | null
  intake_id?: string | null
  sms_conversation_id?: string | null
}

/** Hard upper bound on jsonb payload size we'll write to the DB.
 *  16KB per field keeps total row well under PG's TOAST sweet spot
 *  and the dashboard renders 16KB of JSON without flinching. */
const JSON_BUDGET_BYTES = 16 * 1024
const MESSAGE_BUDGET_CHARS = 500

/** Truncate a JSON-serialisable value so its stringified form fits the
 *  byte budget. We preserve the top-level shape (object/array stays as
 *  object/array) and replace overflowed branches with a stub so the
 *  dashboard can still parse the result. */
export function truncateForTrace(value: unknown, budget = JSON_BUDGET_BYTES): unknown {
  if (value === null || value === undefined) return value
  let serialized: string
  try {
    serialized = JSON.stringify(value)
  } catch {
    return { __trace_error: 'value not JSON-serialisable' }
  }
  if (serialized.length <= budget) return value
  // Two-stage approach: try array truncation first (keep first 20 items),
  // then string truncation as a fallback.
  if (Array.isArray(value)) {
    const head = value.slice(0, 20)
    return {
      __truncated: true,
      __reason: `array of ${value.length} items > ${budget} bytes; keeping first 20`,
      head,
    }
  }
  // Object or scalar — return a stub with the head of the stringified value.
  return {
    __truncated: true,
    __reason: `payload ${serialized.length} bytes > ${budget}; head retained`,
    head: serialized.slice(0, budget - 200),
  }
}

function truncateMessage(s: string | undefined): string | undefined {
  if (!s) return s
  return s.length <= MESSAGE_BUDGET_CHARS ? s : s.slice(0, MESSAGE_BUDGET_CHARS - 1) + '…'
}

/** Insert one trace row. Errors are swallowed — logging must never
 *  break the request. Returns a Promise that resolves on completion;
 *  callers should generally fire-and-forget with `void recordTrace(...)`. */
export async function recordTrace(
  supabase: SupabaseClient | null,
  trace: PipelineTrace,
): Promise<void> {
  if (!supabase) return
  try {
    await supabase.from('pipeline_traces').insert({
      step: trace.step,
      substep: trace.substep ?? null,
      status: trace.status,
      message: truncateMessage(trace.message),
      inputs: trace.inputs !== undefined ? truncateForTrace(trace.inputs) : null,
      outputs: trace.outputs !== undefined ? truncateForTrace(trace.outputs) : null,
      decisions: trace.decisions ?? null,
      duration_ms:
        typeof trace.duration_ms === 'number' && Number.isFinite(trace.duration_ms)
          ? Math.max(0, Math.round(trace.duration_ms))
          : null,
      tenant_id: trace.tenant_id ?? null,
      intake_id: trace.intake_id ?? null,
      sms_conversation_id: trace.sms_conversation_id ?? null,
    })
  } catch {
    // Silent — logging is best-effort. The console.log emitted by the
    // sibling pipelineLog still gives us a Vercel-side record even if
    // the DB write fails.
  }
}

/** Convenience factory — binds the foreign-key context once so call
 *  sites don't repeat tenant_id / intake_id / sms_conversation_id on
 *  every recordTrace call.
 *
 * Usage:
 *   const trace = createTracer(supabase, {
 *     tenant_id: tenant.id,
 *     intake_id: intake.id,
 *     sms_conversation_id: conv.id,
 *   })
 *   trace('extract_slots', 'ok', { ... })   // shorthand for recordTrace
 *
 * The returned function spreads the bound context into every recorded
 * trace and never throws. */
export type Tracer = (
  step: TraceStep,
  status: TraceStatus,
  partial?: Omit<PipelineTrace, 'step' | 'status'>,
) => void

export function createTracer(
  supabase: SupabaseClient | null,
  ctx: {
    tenant_id?: string | null
    intake_id?: string | null
    sms_conversation_id?: string | null
  } = {},
): Tracer {
  return (step, status, partial = {}) => {
    void recordTrace(supabase, {
      step,
      status,
      ...partial,
      tenant_id: partial.tenant_id ?? ctx.tenant_id ?? null,
      intake_id: partial.intake_id ?? ctx.intake_id ?? null,
      sms_conversation_id:
        partial.sms_conversation_id ?? ctx.sms_conversation_id ?? null,
    })
  }
}

/** A simple stopwatch utility for measuring step duration without
 *  cluttering call sites. Use:
 *    const sw = stopwatch()
 *    await doWork()
 *    trace('step', 'ok', { duration_ms: sw.elapsed() })
 */
export function stopwatch(): { elapsed: () => number } {
  const start = Date.now()
  return { elapsed: () => Date.now() - start }
}
