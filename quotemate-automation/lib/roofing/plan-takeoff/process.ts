// One stage of a takeoff run, as the durable worker runs it (P2, TKO-09).
// The queue runs a run's jobs in order (one serial key per run) and retries a
// failing job with backoff. This module decides what a job may do:
//  - it acts only while the run is at the job's stage and start, so a stale or
//    duplicate job does nothing;
//  - it checkpoints the stage's output, so a retry never repeats finished work;
//  - it stops a failing stage after three attempts, failing the run with a
//    reason, and fails it at once when retrying can't help;
//  - it writes one trace per attempt, and a failed run also writes a log line
//    (TKO-27).

import type { SupabaseClient } from '@supabase/supabase-js'
import { recordTrace, type TraceStatus } from '@/lib/log/trace'
import { assertSmsWorkOwnership, smsWorkCheckpoint } from '@/lib/sms/durable-work'
import { enqueueStage, TAKEOFF_STAGES, type TakeoffStage } from './runs'
import { STAGE_RUNNERS, StageError } from './stages'

export const MAX_STAGE_ATTEMPTS = 3

const STAGE_NAMES: Record<TakeoffStage, string> = {
  intake: 'file check',
  classify: 'sheet sorting',
  extract: 'plan reading',
  calibrate: 'scale check',
  check: 'takeoff checks',
  persist: 'saving step',
}

export type ProcessOutcome =
  | { done: 'skipped'; reason: string }
  | { done: 'advanced'; next: TakeoffStage }
  | { done: 'finished'; status: string }
  | { done: 'failed'; note: string }

type Run = {
  id: string
  tenant_id: string
  status: string
  stage: TakeoffStage | null
  usage: { starts?: string[] } | null
  checks: { status?: string } | null
}

/** Runs one stage. `attempt` is the queue's count for this job (1 outside the
 *  queue); `restart` comes from the job's work key, when there is a job. */
export async function processStage(db: SupabaseClient, input: {
  runId: string
  stage: TakeoffStage
  attempt: number
  restart?: number
  bucket?: string
}): Promise<ProcessOutcome> {
  const bucket = input.bucket ?? process.env.TAKEOFF_STORAGE_BUCKET ?? 'plan-pdfs'
  const found = await db.from('roof_takeoff_runs')
    .select('id, tenant_id, status, stage, usage, checks')
    .eq('id', input.runId)
    .maybeSingle()
  if (found.error) throw new Error(`takeoff run lookup failed: ${found.error.message}`)
  const run = found.data as Run | null
  if (!run) return { done: 'skipped', reason: 'the run no longer exists' }
  if (run.stage !== input.stage || (run.status !== 'queued' && run.status !== 'extracting')) {
    return { done: 'skipped', reason: `the run is ${run.status} at ${run.stage ?? 'no stage'}` }
  }
  const restart = (run.usage?.starts?.length ?? 1) - 1
  if (input.restart !== undefined && input.restart !== restart) {
    return { done: 'skipped', reason: 'a later start replaced this job' }
  }
  const { stage, attempt } = input
  // An attempt the queue cut off at its deadline never reached the catch below.
  if (attempt > MAX_STAGE_ATTEMPTS) {
    return fail(db, run, { stage, attempt, note: `The ${STAGE_NAMES[stage]} ran out of time three times. Start the run again to retry it.` })
  }

  // queued becomes extracting once the worker takes the run's first stage.
  if (run.status === 'queued') await move(db, run, stage, 'queued', { status: 'extracting' })

  const started = Date.now()
  let output: unknown
  try {
    output = await smsWorkCheckpoint('output', () => STAGE_RUNNERS[stage]({ db, run, bucket }))
  } catch (error) {
    const permanent = error instanceof StageError && error.permanent
    const cause = String(error).slice(0, 300)
    if (!permanent && attempt < MAX_STAGE_ATTEMPTS) {
      await trace(db, run, { stage, attempt, status: 'warn', started, message: cause })
      throw error
    }
    const note = error instanceof StageError
      ? error.note
      : `The ${STAGE_NAMES[stage]} failed three times. Start the run again to retry it.`
    return fail(db, run, { stage, attempt, note, started, cause })
  }
  await trace(db, run, { stage, attempt, status: 'ok', started, outputs: output, decisions: modelUse(output) })

  const next = TAKEOFF_STAGES[TAKEOFF_STAGES.indexOf(stage) + 1]
  if (!next) {
    const saved = output as { status: string } | null
    return saved ? { done: 'finished', status: saved.status } : { done: 'skipped', reason: 'the run moved on while saving' }
  }
  await assertSmsWorkOwnership()
  if (!(await move(db, run, stage, 'extracting', { stage: next }))) {
    return { done: 'skipped', reason: 'the run moved on during the stage' }
  }
  await enqueueStage(run, next, restart, db)
  return { done: 'advanced', next }
}

type Attempt = { stage: TakeoffStage; attempt: number }

/** One pipeline_traces row per stage attempt (TKO-27): how it ended and how
 *  long it took, with the run, the attempt and any model use behind it.
 *  recordTrace never throws, so a trace can't fail a stage. */
function trace(db: SupabaseClient, run: Run, at: Attempt & {
  status: TraceStatus
  started: number
  message?: string
  outputs?: unknown
  decisions?: Record<string, unknown>
}) {
  return recordTrace(db, {
    step: 'plan_takeoff',
    substep: at.stage,
    status: at.status,
    message: at.message,
    outputs: at.outputs,
    decisions: { run_id: run.id, attempt: at.attempt, ...at.decisions },
    duration_ms: Date.now() - at.started,
    tenant_id: run.tenant_id,
  })
}

/** The model and tokens a stage's output reports, when it called the model. */
function modelUse(output: unknown): Record<string, unknown> {
  const { model, input_tokens, output_tokens } = (output ?? {}) as { model?: string; input_tokens?: number; output_tokens?: number }
  return model ? { model, input_tokens, output_tokens } : {}
}

/** Compare-and-set: changes the run only while it is still at `stage` with
 *  status `from`. Returns whether it did. */
async function move(db: SupabaseClient, run: Run, stage: TakeoffStage, from: string, patch: Record<string, unknown>) {
  const { data, error } = await db.from('roof_takeoff_runs')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', run.id).eq('tenant_id', run.tenant_id).eq('stage', stage).eq('status', from)
    .select('id')
  if (error) throw new Error(`takeoff run update failed: ${error.message}`)
  return Boolean(data?.length)
}

/** Fails the run at this stage, so a restart resumes there. Returns 'failed'
 *  rather than throwing, so the queue stops retrying. A failed run is P2's one
 *  alert (DEC-015): an err trace, a structured log line, and the top of the
 *  operator's runs. */
async function fail(db: SupabaseClient, run: Run, at: Attempt & { note: string; started?: number; cause?: string }): Promise<ProcessOutcome> {
  await assertSmsWorkOwnership()
  const { data, error } = await db.from('roof_takeoff_runs')
    .update({ status: 'failed', status_note: at.note, updated_at: new Date().toISOString() })
    .eq('id', run.id).eq('tenant_id', run.tenant_id).eq('stage', at.stage).in('status', ['queued', 'extracting'])
    .select('id')
  if (error) throw new Error(`takeoff run update failed: ${error.message}`)
  if (!data?.length) return { done: 'skipped', reason: 'the run moved on' }
  console.error(JSON.stringify({
    level: 'error', event: 'takeoff_run_failed', run_id: run.id, tenant_id: run.tenant_id,
    stage: at.stage, attempt: at.attempt, note: at.note, cause: at.cause,
  }))
  await trace(db, run, {
    ...at, status: 'err', started: at.started ?? Date.now(), message: at.note, decisions: at.cause ? { error: at.cause } : {},
  })
  return { done: 'failed', note: at.note }
}
