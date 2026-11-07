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
import { namesIn, redact, redactLabel } from './pack/privacy'
import { READER_SYSTEM } from './prompt'
import { DEFAULT_TAKEOFF_MODEL, readPlans, type ModelUsage } from './read'
import { refineReading } from './refine'
import { EVAL_FOLDER, RETENTION_MONTHS } from './runs'
import { RoofPlanTakeoffSchema, type RoofPlanTakeoff } from './schema'
import { scoreTakeoff, type Score } from './score'

export { EVAL_FOLDER }
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
/** The models a fixture's run calls: the reader's, the sheets', and the one
 *  assigning a sheet's numbered roof areas (DEC-047), which a swapped reader
 *  doesn't change. */
export type EvalModels = { generate?: typeof generateText; readSheet?: SheetReader; assign?: typeof generateText }

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

    const refined = await refineReading(read.takeoff, { sheets, files: copies(fixture.files), scopeNote: request.scope_note, assign: models.assign ?? generateText })
    if (refined.usage) spend(refined.usage, refined.usage.calls)
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

// ── The corpus (TKO-00c, DEC-036) ───────────────────────────────────────────

export type PromoteOutcome =
  | { ok: true; name: string; files: number }
  | { ok: false; error: 'invalid_name' | 'not_found' | 'not_corrected' | 'exists' }

/** A fixture's folder name: lower-case letters, digits and hyphens. */
const FIXTURE_NAME = /^[a-z0-9][a-z0-9-]{1,39}$/
const encode = (value: unknown) => new TextEncoder().encode(`${JSON.stringify(value, null, 2)}\n`)

/** A correction as an eval reference: no drawing text (no evidence, sheet
 *  titles or status text), plan files under their plain names, and every name
 *  or contact detail the run's text gives away taken out, as a pack's are
 *  (DEC-037). The scorer reads only sizes, pitches and edges. */
function fixtureTakeoff(takeoff: RoofPlanTakeoff, plain: Map<string, string>, names: ReadonlySet<string>): RoofPlanTakeoff {
  const clean = (text: string) => redact(text, names)
  const maybe = (text: string | null) => (text == null ? null : clean(text))
  return RoofPlanTakeoffSchema.parse({
    ...takeoff,
    sheets: takeoff.sheets.map((s) => ({
      ...s, file: plain.get(s.file) ?? 'plans.pdf', number: maybe(s.number), title: null, revision: maybe(s.revision), status_text: null,
    })),
    structures: takeoff.structures.map((s) => ({
      ...s,
      label: redactLabel(s.label, s.id, names),
      planes: s.planes.map((p) => ({ ...p, fall: maybe(p.fall), profile: maybe(p.profile), finish_tag: maybe(p.finish_tag), evidence: [] })),
      exclusions: s.exclusions.map((x) => ({ ...x, label: clean(x.label), reason: clean(x.reason) })),
    })),
    scope: { includes: takeoff.scope.includes.map(clean), excludes: takeoff.scope.excludes.map(clean), questions: takeoff.scope.questions.map(clean) },
  })
}

/** Promotes a live run a tradie corrected into the eval's corpus (TKO-00c,
 *  DEC-036), as `eval/<name>/` in the plans bucket, where the nightly eval
 *  reads it:
 *  - its plan PDFs, as plans-1.pdf and so on, since their names can carry the site;
 *  - its request, without the site address or the job's name, and its scope
 *    note filtered;
 *  - its correction as the reference, through `fixtureTakeoff`.
 *  The fixture is kept as long as the run is (D-06): request.json says when it
 *  expires, and the retention sweep deletes it then. Nothing is overwritten,
 *  and a copy that fails part way leaves nothing behind. */
export async function promoteRun(db: SupabaseClient, bucket: string, input: { tenantId: string; runId: string; name: string; now?: Date }): Promise<PromoteOutcome> {
  if (!FIXTURE_NAME.test(input.name)) return { ok: false, error: 'invalid_name' }
  const found = await db.from('roof_takeoff_runs')
    .select('id, job_name, job_ref, scope_note, latest_extraction_id')
    .eq('id', input.runId).eq('tenant_id', input.tenantId)
    .maybeSingle()
  if (found.error) throw new Error(`run lookup failed: ${found.error.message}`)
  const run = found.data as { job_name: string | null; job_ref: string | null; scope_note: string | null; latest_extraction_id: string | null } | null
  if (!run) return { ok: false, error: 'not_found' }
  const reading = run.latest_extraction_id
    ? await db.from('plan_extractions').select('corrected_items').eq('id', run.latest_extraction_id).eq('tenant_id', input.tenantId).maybeSingle()
    : { data: null, error: null }
  if (reading.error) throw new Error(`reading lookup failed: ${reading.error.message}`)
  const corrected = (reading.data as { corrected_items: unknown } | null)?.corrected_items
  if (!corrected) return { ok: false, error: 'not_corrected' }

  const store = db.storage.from(bucket)
  const folder = `${EVAL_FOLDER}/${input.name}`
  const existing = await store.list(folder)
  if (existing.error) throw new Error(`fixture list failed: ${existing.error.message}`)
  if (existing.data.length) return { ok: false, error: 'exists' }

  const uploads = await db.from('plan_uploads')
    .select('filename, pdf_path, created_at')
    .eq('takeoff_run_id', input.runId).eq('tenant_id', input.tenantId)
    .order('created_at', { ascending: true })
  if (uploads.error) throw new Error(`upload lookup failed: ${uploads.error.message}`)
  const files = uploads.data as Array<{ filename: string; pdf_path: string }>
  // ponytail: two uploads of one name share its plain name in the reference; a run's names are its own.
  const plain = new Map(files.map((f, i) => [f.filename, `plans-${i + 1}.pdf`]))

  const correction = RoofPlanTakeoffSchema.parse(corrected)
  const names = namesIn(correction, null, { job_name: run.job_name, scope_note: run.scope_note })
  const now = input.now ?? new Date()
  const expires = new Date(now)
  expires.setUTCMonth(expires.getUTCMonth() + RETENTION_MONTHS)
  const request = {
    job_name: null,
    job_ref: run.job_ref,
    site_address: null,
    scope_note: run.scope_note == null ? null : redact(run.scope_note, names),
    promoted: { run_id: input.runId, at: now.toISOString(), expires_at: expires.toISOString() },
  }

  const written: string[] = []
  const put = async (path: string, body: Uint8Array, contentType: string) => {
    const { error } = await store.upload(path, body, { contentType, upsert: false })
    if (error) throw new Error(`fixture upload failed for ${path}: ${error.message}`)
    written.push(path)
  }
  try {
    for (const [i, file] of files.entries()) {
      const got = await store.download(file.pdf_path)
      if (got.error || !got.data) throw new Error(`plan download failed for upload ${i + 1}: ${got.error?.message ?? 'no data'}`)
      await put(`${folder}/plans-${i + 1}.pdf`, new Uint8Array(await got.data.arrayBuffer()), 'application/pdf')
    }
    // The reference last: the eval takes a folder as a fixture once it has one.
    await put(`${folder}/request.json`, encode(request), 'application/json')
    await put(`${folder}/takeoff.json`, encode(fixtureTakeoff(correction, plain, names)), 'application/json')
  } catch (error) {
    if (written.length) await store.remove(written)
    throw error
  }
  return { ok: true, name: input.name, files: files.length }
}
