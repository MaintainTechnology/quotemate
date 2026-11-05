// Takeoff runs for qm-roofing-takeoff (P2): storage paths, queue keys and the
// run's state changes (TKO-08), and its reads, corrections and deletes
// (TKO-14). The service's routes and its stage handler both use them, so a
// path or a work key is built in exactly one place.
//
// Callers pass the service-role client, which bypasses RLS, so every query
// here also filters on tenant_id.

import { randomUUID } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { enqueueSmsWork, internalWorkPayload } from '@/lib/sms/durable-work'
import { runChecks, type Checks } from './checks'
import type { Sheet } from './classify'
import { RoofPlanTakeoffSchema, takeoffTooLarge, type RoofPlanTakeoff } from './schema'

// ponytail: one queue key for every environment. Staging shares production's
// database, so give staging its own key before a production service runs.
export const TAKEOFF_SERVICE = 'roofing-takeoff'
export const TAKEOFF_STAGES = ['intake', 'classify', 'extract', 'calibrate', 'check', 'persist'] as const
export type TakeoffStage = (typeof TAKEOFF_STAGES)[number]
export const TAKEOFF_DOC_TYPES = ['plan_set', 'engineering', 'other'] as const
export type TakeoffDocType = (typeof TAKEOFF_DOC_TYPES)[number]

/** Supabase's signed upload URLs last two hours; the lifetime is fixed. */
export const UPLOAD_URL_SECONDS = 7200
const HOUR_MS = 3_600_000

// Backend Schema §5: the server builds every path; no part comes from the caller.
export const runFolder = (tenantId: string, runId: string) => `roofing/${tenantId}/${runId}`
export const runFilePath = (tenantId: string, runId: string, uploadId: string) =>
  `${runFolder(tenantId, runId)}/${uploadId}.pdf`

// Backend Schema §4: work keys are unique, so each restart gets its own number.
export const stageWorkKey = (runId: string, stage: TakeoffStage, restart: number, part?: string) =>
  ['takeoff', runId, stage, ...(part ? [part] : []), restart].join(':')
/** The restart number a stage work key ends with. */
export const restartOf = (workKey: string) => Number(workKey.split(':').at(-1))

/** Queues one stage of a run for the takeoff worker. */
export function enqueueStage(run: { id: string; tenant_id: string }, stage: TakeoffStage, restart: number, db?: SupabaseClient) {
  return enqueueSmsWork({
    key: stageWorkKey(run.id, stage, restart),
    kind: 'plan',
    serialKey: `takeoff:${run.id}`,
    turnId: run.id,
    tenantId: run.tenant_id,
    serviceKey: TAKEOFF_SERVICE,
    payload: internalWorkPayload('/api/takeoff/internal/process', { run_id: run.id, stage }),
  }, db)
}

export type RunBuilder = { business?: string; contact?: string; email?: string; phone?: string }

/** Where a run came from (migration 223); the column's default is `dashboard`. */
export type TakeoffSource = 'dashboard' | 'tag_email' | 'sms' | 'api'

export type NewRun = {
  tenantId: string
  /** TAG intake's, derived from the message so a redelivery names the same
   *  run (DEC-029); a fresh one otherwise. */
  runId?: string
  source?: TakeoffSource
  site_address: string
  job_name?: string | null
  job_ref?: string | null
  scope_note?: string | null
  builder?: RunBuilder | null
  files: Array<{ filename: string; size_bytes: number; doc_type: TakeoffDocType }>
}

export type CreatedRun = {
  run_id: string
  status: 'draft'
  uploads: Array<{ plan_upload_id: string; path: string; signed_url: string; expires_in: number }>
}

const failure = (what: string, error: { message: string }) => new Error(`takeoff ${what} failed: ${error.message}`)

/** Creates a draft run with one plan_uploads row and one signed upload URL per
 *  file, in the request's order. A failure part-way deletes the run again. */
export async function createRun(db: SupabaseClient, bucket: string, input: NewRun): Promise<CreatedRun> {
  const runId = input.runId ?? randomUUID()
  const files = input.files.map((file) => {
    const id = randomUUID()
    return { ...file, id, path: runFilePath(input.tenantId, runId, id) }
  })

  const inserted = await db.from('roof_takeoff_runs').insert({
    id: runId,
    tenant_id: input.tenantId,
    source: input.source ?? 'dashboard',
    site_address: input.site_address,
    job_name: input.job_name ?? null,
    job_ref: input.job_ref ?? null,
    scope_note: input.scope_note ?? null,
    builder: input.builder ?? null,
  })
  if (inserted.error) throw failure('run insert', inserted.error)

  try {
    const rows = await db.from('plan_uploads').insert(files.map((file) => ({
      id: file.id,
      tenant_id: input.tenantId,
      takeoff_run_id: runId,
      trade: 'roofing', // the column defaults to 'electrical'
      filename: file.filename,
      size_bytes: file.size_bytes,
      doc_type: file.doc_type,
      pdf_path: file.path,
    })))
    if (rows.error) throw failure('upload rows', rows.error)

    const uploads = await Promise.all(files.map(async (file) => {
      // No upsert: once a file is uploaded it can't be swapped under a running takeoff.
      const signed = await db.storage.from(bucket).createSignedUploadUrl(file.path, { upsert: false })
      if (signed.error) throw failure('signed upload URL', signed.error)
      return { plan_upload_id: file.id, path: file.path, signed_url: signed.data.signedUrl, expires_in: UPLOAD_URL_SECONDS }
    }))
    return { run_id: runId, status: 'draft', uploads }
  } catch (error) {
    // The upload rows go with the run (on delete cascade); signing stores no object.
    const undo = await db.from('roof_takeoff_runs').delete().eq('id', runId).eq('tenant_id', input.tenantId)
    if (undo.error) console.error('[takeoff] could not remove a half-made run', { runId, error: undo.error.message })
    throw error
  }
}

type RunRow = {
  id: string
  tenant_id: string
  status: string
  stage: TakeoffStage | null
  status_note: string | null
  usage: { starts?: string[] } | null
}

export type MissingFile = { plan_upload_id: string; filename: string; problem: 'missing' | 'wrong_size' }

export type StartOutcome =
  | { ok: true; run_id: string; status: 'queued'; stage: TakeoffStage }
  | { ok: false; error: 'not_found' }
  | { ok: false; error: 'conflict_status'; status?: string }
  | { ok: false; error: 'files_missing'; files: MissingFile[] }
  | { ok: false; error: 'rate_limited'; retry_at: string }

/** Starts a draft run, or restarts a failed run from the stage that failed.
 *  Each start is stamped into `usage.starts`: the stamps count against the
 *  hourly limit and number the restarts, so every start gets fresh work keys. */
export async function startRun(db: SupabaseClient, bucket: string, input: {
  tenantId: string
  runId: string
  runsPerHour: number
  now?: Date
}): Promise<StartOutcome> {
  const now = input.now ?? new Date()
  const found = await db.from('roof_takeoff_runs')
    .select('id, tenant_id, status, stage, status_note, usage')
    .eq('id', input.runId).eq('tenant_id', input.tenantId)
    .maybeSingle()
  if (found.error) throw failure('run lookup', found.error)
  const run = found.data as RunRow | null
  if (!run) return { ok: false, error: 'not_found' }
  if (run.status !== 'draft' && run.status !== 'failed') return { ok: false, error: 'conflict_status', status: run.status }

  const files = await filesNotUploaded(db, bucket, run)
  if (files.length) return { ok: false, error: 'files_missing', files }

  // ponytail: two starts racing at the limit can both pass. A soft limit is
  // enough to cap model spend; count under a lock if it must be exact.
  const limit = await startAllowed(db, run.tenant_id, input.runsPerHour, now)
  if (!limit.ok) return { ok: false, error: 'rate_limited', retry_at: limit.retry_at }

  const starts = run.usage?.starts ?? []
  const stage: TakeoffStage = run.status === 'failed' && run.stage ? run.stage : 'intake'
  const queued = await db.from('roof_takeoff_runs')
    .update({
      status: 'queued',
      stage,
      status_note: null,
      usage: { ...run.usage, starts: [...starts, now.toISOString()] },
      updated_at: now.toISOString(),
    })
    .eq('id', run.id).eq('tenant_id', run.tenant_id).eq('status', run.status)
    .select('id')
  if (queued.error) throw failure('run start', queued.error)
  if (!queued.data?.length) return { ok: false, error: 'conflict_status' } // another start won

  try {
    await enqueueStage(run, stage, starts.length, db)
  } catch (error) {
    // Put the run back so the caller can try again. The stamp stays, so the
    // retry gets a new work key even if this enqueue did reach the queue.
    const undo = await db.from('roof_takeoff_runs')
      .update({ status: run.status, stage: run.stage, status_note: run.status_note, updated_at: now.toISOString() })
      .eq('id', run.id).eq('tenant_id', run.tenant_id).eq('status', 'queued')
    // ponytail: if the undo fails too, the run stays queued with no job and has
    // to be deleted. Add a sweeper for queued runs without jobs if it happens.
    if (undo.error) console.error('[takeoff] run left queued without a job', { runId: run.id, error: undo.error.message })
    throw error
  }
  return { ok: true, run_id: run.id, status: 'queued', stage }
}

/** The run's files that aren't in storage at their declared size. */
async function filesNotUploaded(db: SupabaseClient, bucket: string, run: RunRow): Promise<MissingFile[]> {
  const uploads = await db.from('plan_uploads')
    .select('id, filename, size_bytes')
    .eq('takeoff_run_id', run.id).eq('tenant_id', run.tenant_id)
  if (uploads.error) throw failure('upload rows lookup', uploads.error)
  const listed = await db.storage.from(bucket).list(runFolder(run.tenant_id, run.id), { limit: 100 })
  if (listed.error) throw failure('storage list', listed.error)

  const sizes = new Map(listed.data.map((object) => [object.name, object.metadata?.size]))
  return (uploads.data as Array<{ id: string; filename: string; size_bytes: number }>).flatMap((upload) => {
    const size = sizes.get(`${upload.id}.pdf`)
    if (size === upload.size_bytes) return []
    return [{ plan_upload_id: upload.id, filename: upload.filename, problem: size === undefined ? 'missing' : 'wrong_size' } as const]
  })
}

/** Whether the tenant can start another run within the hourly limit, or else
 *  when a slot frees up. TAG intake asks before it stores anything. */
export async function startAllowed(
  db: SupabaseClient,
  tenantId: string,
  runsPerHour: number,
  now = new Date(),
): Promise<{ ok: true } | { ok: false; retry_at: string }> {
  const recent = await startsSince(db, tenantId, now.getTime() - HOUR_MS)
  if (recent.length < runsPerHour) return { ok: true }
  // The count drops below the limit when this start turns an hour old.
  return { ok: false, retry_at: new Date(recent[recent.length - runsPerHour] + HOUR_MS).toISOString() }
}

/** The tenant's start times since `since`, oldest first. A start stamps
 *  updated_at, so every run started since then was also updated since then. */
async function startsSince(db: SupabaseClient, tenantId: string, since: number): Promise<number[]> {
  const runs = await db.from('roof_takeoff_runs')
    .select('usage')
    .eq('tenant_id', tenantId).gte('updated_at', new Date(since).toISOString())
  if (runs.error) throw failure('start count', runs.error)
  return (runs.data as Array<Pick<RunRow, 'usage'>>)
    .flatMap((row) => row.usage?.starts ?? [])
    .map((at) => Date.parse(at))
    .filter((at) => at >= since)
    .sort((a, b) => a - b)
}

// ── Reads, corrections and deletes (TKO-14) ─────────────────────────────────

/** Whose runs a read sees: the caller's tenant, or the operator surface's
 *  allowlist, or 'all' while no allowlist is set. */
export type TenantScope = string[] | 'all'

const SUMMARY_COLUMNS = 'id, tenant_id, status, stage, status_note, site_address, job_name, job_ref, created_at, updated_at, completed_at'

type SummaryRow = {
  id: string
  tenant_id: string
  status: string
  stage: TakeoffStage | null
  status_note: string | null
  site_address: string
  job_name: string | null
  job_ref: string | null
  created_at: string
  updated_at: string
  completed_at: string | null
}
export type RunSummary = Omit<SummaryRow, 'id'> & { run_id: string }

const summaryOf = (row: SummaryRow): RunSummary => ({
  run_id: row.id,
  tenant_id: row.tenant_id,
  status: row.status,
  stage: row.stage,
  status_note: row.status_note,
  site_address: row.site_address,
  job_name: row.job_name,
  job_ref: row.job_ref,
  created_at: row.created_at,
  updated_at: row.updated_at,
  completed_at: row.completed_at,
})

/** Runs in scope, newest first: at most `limit` of them, created before
 *  `before` when it is given. `next` is the `before` of the next page, or null
 *  on the last one. */
export async function listRuns(db: SupabaseClient, input: { tenants: TenantScope; limit: number; before?: string }) {
  let query = db.from('roof_takeoff_runs').select(SUMMARY_COLUMNS)
  if (input.tenants !== 'all') query = query.in('tenant_id', input.tenants)
  // ponytail: created_at alone is the cursor, so two runs created in the same
  // microsecond could straddle a page. Add the id to the cursor if that matters.
  if (input.before) query = query.lt('created_at', input.before)
  const { data, error } = await query.order('created_at', { ascending: false }).limit(input.limit + 1)
  if (error) throw failure('run list', error)
  const rows = data as SummaryRow[]
  const page = rows.slice(0, input.limit)
  return { runs: page.map(summaryOf), next: rows.length > input.limit ? page[page.length - 1].created_at : null }
}

export type RunDetail = RunSummary & {
  scope_note: string | null
  sheet_index: Sheet[] | null
  checks: Checks | null
  /** The operator's corrected takeoff when there is one, else the reading's. */
  takeoff: RoofPlanTakeoff | null
  corrected: boolean
}

type DetailRow = SummaryRow & {
  scope_note: string | null
  sheet_index: Sheet[] | null
  checks: Checks | null
  latest_extraction_id: string | null
}

/** One run in scope, or null. Its takeoff is the reading persist linked, so a
 *  run still in progress has none yet. */
export async function getRun(db: SupabaseClient, input: { tenants: TenantScope; runId: string }): Promise<RunDetail | null> {
  let query = db.from('roof_takeoff_runs')
    .select(`${SUMMARY_COLUMNS}, scope_note, sheet_index, checks, latest_extraction_id`)
    .eq('id', input.runId)
  if (input.tenants !== 'all') query = query.in('tenant_id', input.tenants)
  const found = await query.maybeSingle()
  if (found.error) throw failure('run lookup', found.error)
  const row = found.data as DetailRow | null
  if (!row) return null

  let reading: { items: RoofPlanTakeoff; corrected_items: RoofPlanTakeoff | null } | null = null
  if (row.latest_extraction_id) {
    const got = await db.from('plan_extractions')
      .select('items, corrected_items')
      .eq('id', row.latest_extraction_id).eq('tenant_id', row.tenant_id)
      .maybeSingle()
    if (got.error) throw failure('reading lookup', got.error)
    reading = got.data
  }
  return {
    ...summaryOf(row),
    scope_note: row.scope_note,
    sheet_index: row.sheet_index,
    checks: row.checks,
    takeoff: reading?.corrected_items ?? reading?.items ?? null,
    corrected: Boolean(reading?.corrected_items),
  }
}

/** A run with a reading and no stage running: its takeoff can be corrected. */
const CORRECTABLE: string[] = ['ready', 'needs_review']

export type CorrectOutcome =
  | { ok: true; run_id: string; status: Checks['status']; checks: Checks }
  | { ok: false; error: 'not_found' }
  | { ok: false; error: 'conflict_status'; status?: string }
  | { ok: false; error: 'invalid_takeoff'; issues: Array<{ path: string; message: string }> }

type CorrectRow = {
  id: string
  tenant_id: string
  status: string
  scope_note: string | null
  checks: Partial<Checks> | null
  latest_extraction_id: string | null
}

/** Saves a whole corrected takeoff on the run's reading, then re-runs checks
 *  C1 to C9 on it, which set the run's status again. The reading's own
 *  takeoff stays as the model left it. */
export async function correctTakeoff(db: SupabaseClient, input: {
  tenantId: string
  runId: string
  takeoff: unknown
  now?: Date
}): Promise<CorrectOutcome> {
  // The run first, so only a body for the tenant's own correctable run is
  // parsed, and only once it is small enough to be a reading (TKO-28).
  const found = await db.from('roof_takeoff_runs')
    .select('id, tenant_id, status, scope_note, checks, latest_extraction_id')
    .eq('id', input.runId).eq('tenant_id', input.tenantId)
    .maybeSingle()
  if (found.error) throw failure('run lookup', found.error)
  const run = found.data as CorrectRow | null
  if (!run) return { ok: false, error: 'not_found' }
  if (!CORRECTABLE.includes(run.status) || !run.latest_extraction_id) return { ok: false, error: 'conflict_status', status: run.status }
  if (takeoffTooLarge(input.takeoff)) {
    return { ok: false, error: 'invalid_takeoff', issues: [{ path: '', message: 'The takeoff is larger than any reading of a plan set' }] }
  }
  const parsed = RoofPlanTakeoffSchema.safeParse(input.takeoff)
  if (!parsed.success) {
    const issues = parsed.error.issues.slice(0, 20).map((issue) => ({ path: issue.path.map(String).join('.'), message: issue.message }))
    return { ok: false, error: 'invalid_takeoff', issues }
  }

  // A correction doesn't change the drawings, so C3 reuses the schedule the
  // check stage found on them.
  const now = input.now ?? new Date()
  const checks = runChecks(parsed.data, { scopeNote: run.scope_note, schedule: run.checks?.schedule ?? [] }, now)
  // The takeoff first: if the run update then fails, a retry redoes both.
  const saved = await db.from('plan_extractions')
    .update({ corrected_items: parsed.data })
    .eq('id', run.latest_extraction_id).eq('tenant_id', run.tenant_id)
  if (saved.error) throw failure('correction save', saved.error)
  const updated = await db.from('roof_takeoff_runs')
    .update({ checks, status: checks.status, updated_at: now.toISOString() })
    .eq('id', run.id).eq('tenant_id', run.tenant_id).in('status', CORRECTABLE)
    .select('id')
  if (updated.error) throw failure('run update', updated.error)
  if (!updated.data?.length) return { ok: false, error: 'conflict_status' } // the run moved on
  return { ok: true, run_id: run.id, status: checks.status, checks }
}

/** Deletes a run's files, then the run; its upload and reading rows cascade.
 *  Any status will do: a stage still running finds the run gone and stops.
 *  Given `updatedBefore`, as the sweep gives it, a run with activity since
 *  then is left alone. */
export async function deleteRun(db: SupabaseClient, bucket: string, input: { tenantId: string; runId: string; updatedBefore?: string }) {
  let lookup = db.from('roof_takeoff_runs')
    .select('id')
    .eq('id', input.runId).eq('tenant_id', input.tenantId)
  if (input.updatedBefore) lookup = lookup.lt('updated_at', input.updatedBefore)
  const found = await lookup.maybeSingle()
  if (found.error) throw failure('run lookup', found.error)
  if (!found.data) return { ok: false as const, error: 'not_found' as const }

  // ponytail: one folder level, which is every file P2 writes. P3's exports/
  // folder needs listing too when it lands.
  const folder = runFolder(input.tenantId, input.runId)
  const listed = await db.storage.from(bucket).list(folder, { limit: 1000 })
  if (listed.error) throw failure('storage list', listed.error)
  const paths = listed.data.map((object) => `${folder}/${object.name}`)
  if (paths.length) {
    const removed = await db.storage.from(bucket).remove(paths)
    if (removed.error) throw failure('storage delete', removed.error)
  }
  // Files first: if this delete fails, the run is still there to delete again.
  const deleted = await db.from('roof_takeoff_runs').delete().eq('id', input.runId).eq('tenant_id', input.tenantId)
  if (deleted.error) throw failure('run delete', deleted.error)
  return { ok: true as const, files: paths.length }
}

// ── Retention (D-06, DEC-029) ───────────────────────────────────────────────

/** A run's plan PDFs are kept this long after its last activity. */
export const RETENTION_MONTHS = 12

/** Deletes each run whose last activity (`updated_at`) is more than 12 months
 *  old, oldest first and at most `limit` a sweep, through deleteRun. A run
 *  that fails to delete is skipped, so it can't hold up the others. */
export async function sweepExpiredRuns(db: SupabaseClient, bucket: string, input: { now?: Date; limit?: number } = {}) {
  const cutoff = new Date(input.now ?? new Date())
  cutoff.setUTCMonth(cutoff.getUTCMonth() - RETENTION_MONTHS)
  // ponytail: no index on updated_at; the runs table is small. Add one if it grows.
  const found = await db.from('roof_takeoff_runs')
    .select('id, tenant_id')
    .lt('updated_at', cutoff.toISOString())
    .order('updated_at', { ascending: true })
    .limit(input.limit ?? 50)
  if (found.error) throw failure('expired run lookup', found.error)

  let runs = 0
  let files = 0
  const failed: string[] = []
  for (const run of found.data as Array<{ id: string; tenant_id: string }>) {
    try {
      // The cutoff again, so a run restarted since it was chosen stays.
      const deleted = await deleteRun(db, bucket, { tenantId: run.tenant_id, runId: run.id, updatedBefore: cutoff.toISOString() })
      // not_found: another sweep took it first, or it has had activity since.
      if (deleted.ok) { runs++; files += deleted.files }
    } catch (error) {
      failed.push(run.id)
      console.warn(JSON.stringify({ level: 'warn', event: 'takeoff_retention_failed', run_id: run.id, cause: String(error).slice(0, 200) }))
    }
  }
  return { runs, files, failed }
}
