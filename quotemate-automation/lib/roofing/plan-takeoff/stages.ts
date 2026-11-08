// The six stages of a takeoff run (Service Spec §7).
//
// Each stage's output lands where the run's data lives: intake sets
// plan_uploads.is_raster, classify run.sheet_index, extract a plan_extractions
// row, check run.checks, and persist links the reading and sets the status.

import { createHash, randomUUID } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { generateText } from 'ai'
import { areaSchedule, runChecks, type ScheduleLine } from './checks'
import { CLASSIFY_MODEL, classifyFile, MIN_PAGE_TEXT, pageText, type Sheet } from './classify'
import { inflatesPastLimit } from './pdf-guard'
import { readPlans, RUN_TOKEN_BUDGET } from './read'
import { elevationSheets, planSheets, refineReading } from './refine'
import { regionsPlanPath, type TakeoffStage } from './runs'
import type { RoofPlanTakeoff } from './schema'

export const MAX_RUN_PAGES = 200

/** A stage failure with a reason the operator can read. A permanent one, such
 *  as a file that isn't a PDF, fails the run at once: retrying can't help. */
export class StageError extends Error {
  constructor(readonly note: string, readonly permanent = false) {
    super(note)
  }
}

type StageUsage = { input_tokens: number; output_tokens: number; model_calls: number; seconds: number }
/** roof_takeoff_runs.usage: the start times, and each stage's model use. */
export type RunUsage = { starts?: string[]; stages?: Partial<Record<TakeoffStage, StageUsage>> }

export type StageRun = { id: string; tenant_id: string; usage: RunUsage | null; checks: { status?: string } | null }
export type StageContext = { db: SupabaseClient; run: StageRun; bucket: string }
type Spent = { inputTokens: number; outputTokens: number; calls: number; seconds: number }

/** Stops a run that has spent its model budget. */
function assertBudget({ run }: StageContext) {
  const used = Object.values(run.usage?.stages ?? {}).reduce((sum, s) => sum + (s?.input_tokens ?? 0) + (s?.output_tokens ?? 0), 0)
  if (used >= RUN_TOKEN_BUDGET) {
    throw new StageError(`The run has used its model budget of ${RUN_TOKEN_BUDGET.toLocaleString('en-AU')} tokens. Start a new run to try again.`, true)
  }
}

/** The run's usage with a stage's model use added. */
function withUsage(run: StageRun, stage: TakeoffStage, spent: Spent): RunUsage {
  const before = run.usage?.stages?.[stage]
  return {
    ...run.usage,
    stages: {
      ...run.usage?.stages,
      [stage]: {
        input_tokens: (before?.input_tokens ?? 0) + spent.inputTokens,
        output_tokens: (before?.output_tokens ?? 0) + spent.outputTokens,
        model_calls: (before?.model_calls ?? 0) + spent.calls,
        seconds: Math.round(((before?.seconds ?? 0) + spent.seconds) * 10) / 10,
      },
    },
  }
}

type Upload = { id: string; filename: string; size_bytes: number; pdf_path: string; doc_type: string | null }

/** The run's files, plan sets first, then by name. */
async function uploadsOf({ db, run }: StageContext): Promise<Upload[]> {
  const { data, error } = await db.from('plan_uploads')
    .select('id, filename, size_bytes, pdf_path, doc_type')
    .eq('takeoff_run_id', run.id).eq('tenant_id', run.tenant_id)
  if (error) throw new Error(`takeoff upload rows lookup failed: ${error.message}`)
  const planSetFirst = (u: Upload) => (u.doc_type === 'plan_set' ? 0 : 1)
  return (data as Upload[]).sort((a, b) => planSetFirst(a) - planSetFirst(b) || a.filename.localeCompare(b.filename))
}

/** A run file's bytes. A file gone from storage fails the run: retrying
 *  can't bring it back. */
async function download({ db, bucket }: StageContext, upload: Upload): Promise<Uint8Array> {
  const { data, error } = await db.storage.from(bucket).download(upload.pdf_path)
  if (error || !data) {
    if (error && /not found/i.test(error.message)) throw new StageError(`${upload.filename} is missing from storage.`, true)
    throw new Error(`takeoff download failed: ${error?.message ?? 'no data'}`)
  }
  return new Uint8Array(await data.arrayBuffer())
}

async function updateRun({ db, run }: StageContext, patch: Record<string, unknown>) {
  const { error } = await db.from('roof_takeoff_runs')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', run.id).eq('tenant_id', run.tenant_id)
  if (error) throw new Error(`takeoff run update failed: ${error.message}`)
}

export type IntakeFile = { plan_upload_id: string; filename: string; bytes: number; sha256: string; pages: number; text_pages: number }

/** Checks every file is the PDF it was declared as and the run is within 200
 *  pages, and records which files have no text layer. The hashes and page
 *  counts it returns stay in the job's checkpoint, the run's record of them. */
async function intake(ctx: StageContext): Promise<{ pages: number; files: IntakeFile[] }> {
  const uploads = await uploadsOf(ctx)
  if (!uploads.length) throw new StageError('The run has no files.', true)
  const { extractText, getDocumentProxy } = await import('unpdf')
  const files: IntakeFile[] = []
  let pages = 0
  for (const upload of uploads) {
    const bytes = await download(ctx, upload)
    if (bytes.length !== upload.size_bytes) throw new StageError(`${upload.filename} isn't the size it was declared at.`, true)
    if (new TextDecoder().decode(bytes.subarray(0, 5)) !== '%PDF-') throw new StageError(`${upload.filename} is not a PDF file.`, true)
    // Before the PDF reader opens it: a flate bomb exhausts memory in text
    // extraction, and every later stage reads the same file (TKO-28).
    if (inflatesPastLimit(bytes)) {
      throw new StageError(`${upload.filename} unpacks to far more than any plan set, so it wasn't read. Save it again as a standard PDF.`, true)
    }
    // Hash first: the PDF reader may take over the buffer.
    const sha256 = createHash('sha256').update(bytes).digest('hex')

    const pdf = await getDocumentProxy(bytes).catch(() => {
      throw new StageError(`${upload.filename} can't be opened as a PDF.`, true)
    })
    try {
      // Count before reading text, so an oversized set stops early.
      pages += pdf.numPages
      if (pages > MAX_RUN_PAGES) throw new StageError(`The plans have more than ${MAX_RUN_PAGES} pages, the most a run takes.`, true)
      const { text } = await extractText(pdf, { mergePages: false })
      const textPages = text.filter((page) => page.trim().length >= MIN_PAGE_TEXT).length
      files.push({ plan_upload_id: upload.id, filename: upload.filename, bytes: bytes.length, sha256, pages: pdf.numPages, text_pages: textPages })
    } finally {
      await pdf.destroy()
    }
  }
  for (const file of files) {
    const { error } = await ctx.db.from('plan_uploads')
      .update({ is_raster: file.text_pages === 0 })
      .eq('id', file.plan_upload_id).eq('tenant_id', ctx.run.tenant_id)
    if (error) throw new Error(`takeoff is_raster update failed: ${error.message}`)
  }
  return { pages, files }
}

/** Sorts the run's sheets (TKO-10): each page's number, title, revision,
 *  status and kind, and whether the reader needs it. */
async function classify(ctx: StageContext) {
  assertBudget(ctx)
  const started = Date.now()
  const sheets: Sheet[] = []
  const spent = { inputTokens: 0, outputTokens: 0, calls: 0 }
  for (const upload of await uploadsOf(ctx)) {
    const file = await classifyFile(upload.filename, await download(ctx, upload))
    sheets.push(...file.sheets)
    spent.inputTokens += file.usage.inputTokens
    spent.outputTokens += file.usage.outputTokens
    spent.calls += file.modelPages
  }
  const usage = spent.calls ? { usage: withUsage(ctx.run, 'classify', { ...spent, seconds: (Date.now() - started) / 1000 }) } : {}
  await updateRun(ctx, { sheet_index: sheets, ...usage })
  // The model's use goes into the stage's trace (TKO-27).
  const model = spent.calls ? { model: CLASSIFY_MODEL, input_tokens: spent.inputTokens, output_tokens: spent.outputTokens } : {}
  return { sheets: sheets.length, used: sheets.filter((s) => s.used).length, model_pages: spent.calls, ...model }
}

/** Reads the chosen sheets into a takeoff (TKO-11). Each reading is a row;
 *  persist links the latest one to the run. */
async function extract(ctx: StageContext) {
  assertBudget(ctx)
  const { data: job, error } = await ctx.db.from('roof_takeoff_runs')
    .select('sheet_index, scope_note, job_name, job_ref, site_address')
    .eq('id', ctx.run.id).eq('tenant_id', ctx.run.tenant_id)
    .maybeSingle()
  if (error || !job) throw new Error(`takeoff run read failed: ${error?.message ?? 'no run'}`)
  const sheets = (job.sheet_index ?? []) as Sheet[]
  const chosen = sheets.filter((s) => s.used)
  if (!chosen.length) {
    throw new StageError('No roof plan, site plan with roofs, elevation, section or roof framing was found in the plans, so there is nothing to read.', true)
  }

  // Only the files with chosen sheets; plan sets first, as the sheets are.
  const uploads = (await uploadsOf(ctx)).filter((u) => chosen.some((s) => s.file === u.filename))
  const files = new Map<string, Uint8Array>()
  for (const upload of uploads) files.set(upload.filename, await download(ctx, upload))
  // The area schedule C3 checks by, so the reader can look again for a roof
  // it left out (TKO-15).
  const schedule = await scheduleOf(ctx)
  const started = Date.now()
  const read = await readPlans({
    sheets,
    files,
    scopeNote: job.scope_note,
    job: { name: job.job_name, ref: job.job_ref, address: job.site_address },
    schedule,
  })
  const seconds = (Date.now() - started) / 1000
  await updateRun(ctx, { usage: withUsage(ctx.run, 'extract', { ...read.usage, seconds }) })
  if (!read.ok) throw new StageError(read.note, true)

  const id = randomUUID()
  const { error: insertError } = await ctx.db.from('plan_extractions').insert({
    id,
    plan_upload_id: uploads[0].id,
    tenant_id: ctx.run.tenant_id,
    takeoff_run_id: ctx.run.id,
    trade: 'roofing', // the column defaults to 'electrical'
    items: read.takeoff,
    sheets_used: chosen.map(({ file, page, number, revision }) => ({ file, page, number, revision })),
    model: read.model,
    runtime_seconds: Math.round(seconds * 100) / 100,
  })
  if (insertError) throw new Error(`takeoff extraction insert failed: ${insertError.message}`)
  return {
    extraction_id: id,
    structures: read.takeoff.structures.length,
    model: read.model,
    input_tokens: read.usage.inputTokens,
    output_tokens: read.usage.outputTokens,
  }
}

type Reading = { id: string; model: string | null; items: RoofPlanTakeoff; created_at: string }

/** The run's latest reading. */
async function latestReading({ db, run }: StageContext): Promise<Reading> {
  const { data, error } = await db.from('plan_extractions')
    .select('id, model, items, created_at')
    .eq('takeoff_run_id', run.id).eq('tenant_id', run.tenant_id)
  if (error) throw new Error(`takeoff extraction lookup failed: ${error.message}`)
  const [latest] = (data as Reading[]).sort((a, b) => b.created_at.localeCompare(a.created_at))
  if (!latest) throw new Error('takeoff found no reading for the run')
  return latest
}

/** Checks the reading's scale against the drawings (TKO-12), scales the roofs
 *  they don't dimension from their drawn outlines (TKO-29), pitches the planes
 *  they give no pitch from an elevation's roof lines and measures a hip roof
 *  from its drawn hips and ridges (TKO-30), and works out
 *  each skillion's edges (TKO-15), through refineReading, which the eval runs too.
 *  Roofs still unmeasured beside a hip roof are kept as numbered areas, with
 *  their numbered plan and the reader's suggestion, for the operator to
 *  answer on the run page (TKO-30, DEC-048). */
async function calibrate(ctx: StageContext) {
  const started = Date.now()
  const reading = await latestReading(ctx)
  const { data: run, error } = await ctx.db.from('roof_takeoff_runs')
    .select('sheet_index, scope_note')
    .eq('id', ctx.run.id).eq('tenant_id', ctx.run.tenant_id)
    .maybeSingle()
  if (error || !run) throw new Error(`takeoff run read failed: ${error?.message ?? 'no run'}`)
  const sheets = (run.sheet_index ?? []) as Sheet[]
  const wanted = [...planSheets(sheets), ...elevationSheets(sheets)]
  const files = new Map<string, Uint8Array>()
  for (const upload of (await uploadsOf(ctx)).filter((u) => wanted.some((s) => s.file === u.filename))) {
    files.set(upload.filename, await download(ctx, upload))
  }
  const refined = await refineReading(reading.items, { sheets, files, scopeNote: (run.scope_note as string | null) ?? null, suggest: generateText })
  if (refined.changed) {
    const { error: updateError } = await ctx.db.from('plan_extractions')
      .update({ items: refined.takeoff })
      .eq('id', reading.id).eq('tenant_id', ctx.run.tenant_id)
    if (updateError) throw new Error(`takeoff calibration save failed: ${updateError.message}`)
  }
  // The numbered plan before the areas, so a run that shows them can open it.
  // A restart writes it again.
  if (refined.regions) {
    const { error: planError } = await ctx.db.storage.from(ctx.bucket)
      .upload(regionsPlanPath(ctx.run.tenant_id, ctx.run.id), refined.regions.plan, { contentType: 'application/pdf', upsert: true })
    if (planError) throw new Error(`takeoff numbered plan upload failed: ${planError.message}`)
  }
  // Null clears the areas a run had before a restart read it again.
  // ponytail: the suggestion's one small call isn't held to RUN_TOKEN_BUDGET; extract's reading is.
  await updateRun(ctx, {
    regions: refined.regions?.stored ?? null,
    ...(refined.usage ? { usage: withUsage(ctx.run, 'calibrate', { ...refined.usage, seconds: (Date.now() - started) / 1000 }) } : {}),
  })
  const { method, factor, delta_pct } = refined.takeoff.scale.calibration
  return {
    method, factor, delta_pct, sheets: refined.sheets, measured: refined.measured, pitched: refined.pitched, hipped: refined.hipped, derived: refined.derived,
    regions: refined.regions?.stored.areas.length ?? 0,
  }
}

/** The first area schedule in the run's plan sets, such as Grange's on its
 *  title sheet; C3 reconciles against it. */
async function scheduleOf(ctx: StageContext): Promise<ScheduleLine[]> {
  const { getDocumentProxy } = await import('unpdf')
  for (const upload of (await uploadsOf(ctx)).filter((u) => u.doc_type === 'plan_set')) {
    const pdf = await getDocumentProxy(await download(ctx, upload))
    try {
      for (let n = 1; n <= pdf.numPages; n++) {
        const lines = areaSchedule(await pageText(pdf, n), upload.filename, n)
        if (lines.length) return lines
      }
    } finally {
      await pdf.destroy()
    }
  }
  return []
}

/** Runs checks C1 to C9 on the latest reading (TKO-13). Persist sets the
 *  run's status from them. */
async function check(ctx: StageContext) {
  const reading = await latestReading(ctx)
  const { data: run, error } = await ctx.db.from('roof_takeoff_runs')
    .select('scope_note')
    .eq('id', ctx.run.id).eq('tenant_id', ctx.run.tenant_id)
    .maybeSingle()
  if (error || !run) throw new Error(`takeoff run read failed: ${error?.message ?? 'no run'}`)
  const checks = runChecks(reading.items, { scopeNote: run.scope_note ?? null, schedule: await scheduleOf(ctx) })
  await updateRun(ctx, { checks })
  return { status: checks.status, failed: checks.results.filter((r) => r.result === 'fail').map((r) => r.id) }
}

/** Links the run's latest reading and sets the status its checks call for.
 *  Returns null when the run has moved on, and nothing changes. */
async function persist(ctx: StageContext): Promise<{ status: string } | null> {
  const latest = await latestReading(ctx)
  const status = ctx.run.checks?.status === 'ready' ? 'ready' : 'needs_review'
  const now = new Date().toISOString()
  const { data, error } = await ctx.db.from('roof_takeoff_runs')
    .update({ status, latest_extraction_id: latest.id, model: latest.model, completed_at: now, updated_at: now })
    .eq('id', ctx.run.id).eq('tenant_id', ctx.run.tenant_id).eq('stage', 'persist').eq('status', 'extracting')
    .select('id')
  if (error) throw new Error(`takeoff persist failed: ${error.message}`)
  return data?.length ? { status } : null
}

export const STAGE_RUNNERS: Record<TakeoffStage, (ctx: StageContext) => Promise<unknown>> = {
  intake, classify, extract, calibrate, check, persist,
}
