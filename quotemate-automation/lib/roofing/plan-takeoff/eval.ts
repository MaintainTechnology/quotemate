// The eval (TKO-15, DEC-040): each fixture's plans go through the pipeline as a
// run's do (classified, read, refined and checked), and the reading is scored
// against the fixture's hand-measured reference on the four gates (score.ts).
// The script and the service's nightly run share it. Each fixture is a folder
// of the plans bucket under eval/: its PDFs, request.json and takeoff.json.

import { createHash, randomUUID } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { generateText } from 'ai'
import { areaSchedule, runChecks, type Checks, type ScheduleLine } from './checks'
import { classifyFile, pageText, type Sheet, type SheetReader } from './classify'
import { READER_SYSTEM } from './prompt'
import { DEFAULT_TAKEOFF_MODEL, readPlans, type ModelUsage } from './read'
import { refineReading } from './refine'
import { RoofPlanTakeoffSchema, type RoofPlanTakeoff } from './schema'
import { scoreTakeoff, type Score } from './score'

export const EVAL_FOLDER = 'eval'
/** What marks the takeoff's rows in eval_runs, beside the quote evals. */
export const EVAL_CATALOGUE = 'roof-takeoff'
const GATES = ['structures', 'area', 'pitch', 'edges'] as const

export type EvalRequest = { job_name: string | null; job_ref: string | null; site_address: string | null; scope_note: string | null }
export type EvalFixture = { name: string; request: EvalRequest; reference: RoofPlanTakeoff; files: Map<string, Uint8Array> }
export type FixtureResult = {
  fixture: string
  reference: RoofPlanTakeoff
  score: Score
  /** The checks' verdict, or null when the reading failed. */
  status: Checks['status'] | null
  reading: RoofPlanTakeoff | null
  /** Why the reading failed, or null. */
  note: string | null
  usage: ModelUsage
}
/** The reader's and the classifier's model calls, swapped by the script and the tests. */
export type EvalModels = { generate?: typeof generateText; readSheet?: SheetReader }

/** The prompt's version, as eval_runs records it: the first 12 hex of its SHA-256. */
export const promptVersion = (system: string = READER_SYSTEM) => createHash('sha256').update(system).digest('hex').slice(0, 12)

/** A deliberately broken prompt: the reader's, with an estimator's waste and
 *  laps allowance on every area in place of its rule that an area is on plan.
 *  The gates must fail it (P2 Reading, TKO-15's done-when). Taking all the
 *  rules out isn't broken enough: Grange still passed without them, its
 *  sizes and edges worked out by the refine step (DEC-040). */
const AREA_RULE = 'plan_area_m2 is the area on plan, the horizontal projection. Never adjust it for pitch.'
export const brokenPrompt = READER_SYSTEM.replace(AREA_RULE, "plan_area_m2 is the roof's area with 10% added for waste and laps.")

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'
/** What the eval may change in the reader's model call. */
export type ReaderSwap = { system?: string; maxOutputTokens?: number; effort?: Effort }

/** The reader's model call with its system prompt, output limit or effort
 *  swapped, the reader unchanged: the broken-prompt check, and a fair run of a
 *  model that thinks by default, whose thinking counts against the limit (D-07). */
export function swapReader(swap: ReaderSwap, base: typeof generateText = generateText): typeof generateText {
  return ((args: Parameters<typeof generateText>[0]) => base({
    ...args,
    ...(swap.system ? { messages: args.messages?.map((m) => (m.role === 'system' ? { ...m, content: swap.system } : m)) } : {}),
    ...(swap.maxOutputTokens ? { maxOutputTokens: swap.maxOutputTokens } : {}),
    ...(swap.effort ? { providerOptions: { ...args.providerOptions, anthropic: { ...args.providerOptions?.anthropic, effort: swap.effort } } } : {}),
  } as Parameters<typeof generateText>[0])) as typeof generateText
}

/** The first area schedule in the fixture's files, as the check stage finds
 *  one in a run's plan sets; C3 reconciles against it. */
async function scheduleOf(files: Map<string, Uint8Array>): Promise<ScheduleLine[]> {
  const { getDocumentProxy } = await import('unpdf')
  for (const [file, bytes] of files) {
    const pdf = await getDocumentProxy(bytes.slice())
    try {
      for (let n = 1; n <= pdf.numPages; n++) {
        const lines = areaSchedule(await pageText(pdf, n), file, n)
        if (lines.length) return lines
      }
    } finally {
      await pdf.destroy()
    }
  }
  return []
}

/** Copies of the fixture's files: the PDF reader may take a buffer over. */
const copies = (files: Map<string, Uint8Array>) => new Map([...files].map(([name, bytes]) => [name, bytes.slice()]))

/** One fixture through the pipeline, scored against its reference. A reading
 *  that fails, or a stage that throws, such as a model call with a refused
 *  key, fails this fixture with its reason, not the whole eval. */
export async function evalFixture(fixture: EvalFixture, models: EvalModels = {}): Promise<FixtureResult> {
  const { request, reference } = fixture
  const usage: ModelUsage = { inputTokens: 0, outputTokens: 0, calls: 0 }
  const spend = (spent: { inputTokens: number; outputTokens: number }, calls: number) => {
    usage.inputTokens += spent.inputTokens
    usage.outputTokens += spent.outputTokens
    usage.calls += calls
  }
  const failed = (note: string): FixtureResult => {
    const nothing: RoofPlanTakeoff = { ...reference, structures: [] }
    return { fixture: fixture.name, reference, score: scoreTakeoff(reference, nothing), status: null, reading: null, note, usage }
  }
  try {
    const sheets: Sheet[] = []
    for (const [file, bytes] of fixture.files) {
      const classified = await classifyFile(file, bytes, models.readSheet)
      sheets.push(...classified.sheets)
      spend(classified.usage, classified.modelPages)
    }
    const read = await readPlans({
      sheets,
      files: copies(fixture.files),
      scopeNote: request.scope_note,
      job: { name: request.job_name, ref: request.job_ref, address: request.site_address },
    }, models.generate)
    spend(read.usage, read.usage.calls)
    if (!read.ok) return failed(read.note)

    const refined = await refineReading(read.takeoff, { sheets, files: copies(fixture.files) })
    const checks = runChecks(refined.takeoff, { scopeNote: request.scope_note, schedule: await scheduleOf(fixture.files) })
    return { fixture: fixture.name, reference, score: scoreTakeoff(reference, refined.takeoff), status: checks.status, reading: refined.takeoff, note: null, usage }
  } catch (error) {
    return failed(`The pipeline stopped: ${error instanceof Error ? error.message : String(error)}`.slice(0, 500))
  }
}

/** The fixtures in the bucket: each folder under eval/, with its PDFs, its
 *  request.json and its reference, takeoff.json. */
export async function loadFixtures(db: SupabaseClient, bucket: string): Promise<EvalFixture[]> {
  const store = db.storage.from(bucket)
  const get = async (path: string) => {
    const { data, error } = await store.download(path)
    if (error || !data) throw new Error(`eval fixture download failed for ${path}: ${error?.message ?? 'no data'}`)
    return new Uint8Array(await data.arrayBuffer())
  }
  const list = async (folder: string) => {
    const { data, error } = await store.list(folder)
    if (error) throw new Error(`eval fixture list failed for ${folder}: ${error.message}`)
    return (data ?? []).sort((a, b) => a.name.localeCompare(b.name))
  }
  const fixtures: EvalFixture[] = []
  for (const { name } of (await list(EVAL_FOLDER)).filter((entry) => entry.id === null)) {
    const folder = `${EVAL_FOLDER}/${name}`
    const json = async (file: string) => JSON.parse(new TextDecoder().decode(await get(`${folder}/${file}`)))
    const files = new Map<string, Uint8Array>()
    for (const entry of (await list(folder)).filter((e) => e.id !== null && /\.pdf$/i.test(e.name))) {
      files.set(entry.name, await get(`${folder}/${entry.name}`))
    }
    fixtures.push({ name, request: await json('request.json'), reference: RoofPlanTakeoffSchema.parse(await json('takeoff.json')), files })
  }
  return fixtures
}

/** Records an eval: one eval_runs row, scored as the share of gates passed,
 *  and one eval_run_items row a fixture. Returns the run's id. */
export async function recordEval(db: SupabaseClient, results: FixtureResult[], meta: { model: string; promptVersion: string; startedAt: Date }): Promise<string> {
  const id = randomUUID()
  const gates = Object.fromEntries(GATES.map((gate) => [gate, results.filter((r) => r.score[gate].pass).length]))
  const passed = Object.values(gates).reduce((sum, n) => sum + n, 0)
  const { error } = await db.from('eval_runs').insert({
    id,
    prompt_version: meta.promptVersion,
    catalogue_version: EVAL_CATALOGUE,
    total_score: results.length ? Math.round((passed / (GATES.length * results.length)) * 10_000) / 100 : 0,
    per_category: { model: meta.model, fixtures: results.length, ...gates, passing: results.filter((r) => r.score.pass).map((r) => r.fixture) },
    started_at: meta.startedAt.toISOString(),
    completed_at: new Date().toISOString(),
  })
  if (error) throw new Error(`eval run insert failed: ${error.message}`)
  const { error: itemsError } = await db.from('eval_run_items').insert(results.map((r) => ({
    run_id: id,
    intake_fixture_id: r.fixture,
    expected: r.reference,
    actual: r.reading ?? { error: r.note },
    notes: [
      ...GATES.map((gate) => `${r.score[gate].pass ? 'pass' : 'FAIL'} ${gate}: ${r.score[gate].detail}`),
      `checks: ${r.status ?? 'not run'}; ${r.usage.calls} model calls, ${r.usage.inputTokens} input and ${r.usage.outputTokens} output tokens`,
    ].join('\n'),
  })))
  if (itemsError) throw new Error(`eval run items insert failed: ${itemsError.message}`)
  return id
}

/** Runs every fixture in the bucket and records the run (DEC-040). `model`
 *  names the reader's model for the record; the reader reads TAKEOFF_MODEL. */
export async function runEval(db: SupabaseClient, bucket: string, options: EvalModels & { model?: string; system?: string; record?: boolean } = {}) {
  const startedAt = new Date()
  const generate = options.system ? swapReader({ system: options.system }, options.generate) : options.generate
  const results: FixtureResult[] = []
  for (const fixture of await loadFixtures(db, bucket)) results.push(await evalFixture(fixture, { generate, readSheet: options.readSheet }))
  const model = options.model ?? (process.env.TAKEOFF_MODEL?.trim() || DEFAULT_TAKEOFF_MODEL)
  const id = options.record === false ? null : await recordEval(db, results, { model, promptVersion: promptVersion(options.system), startedAt })
  return { id, results }
}
