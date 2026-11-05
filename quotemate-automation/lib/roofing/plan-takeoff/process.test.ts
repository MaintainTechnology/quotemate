// The stage handler (P2, TKO-09) over the in-memory client: a run through all
// six stages, stale and replaced jobs, the three-attempt stop and a restart
// from the failed stage, and the failures retrying can't fix.

import { deflateSync } from 'node:zlib'
import { describe, expect, it, vi } from 'vitest'
import type { Checks } from './checks'
import { CLASSIFY_MODEL } from './classify'
import { processStage } from './process'
import { runFilePath, startRun, TAKEOFF_STAGES, type TakeoffStage } from './runs'
import type { RoofPlanTakeoff } from './schema'
import type { RunUsage } from './stages'
import { fakeDb, type Row } from './test-db'

// The scanned engineering set has no text layer, so classify asks the model
// about its page, and extract reads it. These stand in for the model.
const { READING } = vi.hoisted(() => ({
  READING: {
    scale: { stated: '1:100', sheet_size: 'A3', page: 1 },
    structures: [{
      id: 'S1', label: 'House', role: 'primary',
      planes: [{
        id: 'S1-P1', plan_dims_mm: [10000, 8000], polygon_mm: null, plan_area_m2: 80, pitch_deg: 5, pitch_source: 'engineering',
        fall: null, profile: 'Trimdek', finish_tag: null, confidence: 'high', evidence: [{ page: 1, text: '10000' }],
      }],
      edges: [], exclusions: [],
    }],
    scope: { includes: ['Roof sheeting'], excludes: [], questions: [] },
  },
}))
vi.mock('ai', () => ({
  generateObject: vi.fn(async () => ({
    object: { number: 'S15741-S200', title: 'ROOF FRAMING PLAN', revision: '0', status_text: 'CONSTRUCTION ISSUE', kind: 'roof_framing' },
  })),
  generateText: vi.fn(async () => ({ text: JSON.stringify(READING), finishReason: 'stop', usage: { inputTokens: 1000, outputTokens: 200 } })),
}))

const TENANT = '0b8f6c1e-2d4a-4f5b-9c3d-7e1a2b3c4d5e'
const RUN = '9a7b5c3d-1e2f-4a6b-8c0d-2e4f6a8b0c1d'
const NOW = '2026-11-01T10:00:00.000Z'

/** A PDF whose pages each carry a line of text, or none when `text` is
 *  empty. pdf.js counts the page objects, not the tree's /Count, so a test
 *  over the page limit needs real pages. */
function pdf({ text = 'GROUND FLOOR PLAN', pages = 1 } = {}) {
  const stream = text ? `BT /F1 18 Tf 20 150 Td (${text}) Tj ET` : ''
  const page = (i: number) => 5 + i // page objects follow the four shared ones
  return new TextEncoder().encode([
    '%PDF-1.4',
    '1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj',
    `2 0 obj<</Type/Pages/Kids[${Array.from({ length: pages }, (_, i) => `${page(i)} 0 R`).join(' ')}]/Count ${pages}>>endobj`,
    '3 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj',
    `4 0 obj<</Length ${stream.length}>>stream`,
    stream,
    'endstream',
    'endobj',
    ...Array.from({ length: pages }, (_, i) =>
      `${page(i)} 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 300]/Resources<</Font<</F1 3 0 R>>>>/Contents 4 0 R>>endobj`),
    'trailer<</Root 1 0 R>>',
    '%%EOF',
    '',
  ].join('\n'))
}

/** A run at `stage` with a plan set that has text and an engineering set
 *  scanned without one. */
function setup(stage: TakeoffStage = 'intake', patch: Row = {}, files: { plan?: Uint8Array; declared?: number; missing?: boolean } = {}) {
  const plan = files.plan ?? pdf()
  const engineering = pdf({ text: '' })
  const upload = (id: string, filename: string, docType: string, size: number) => ({
    id, filename, doc_type: docType, size_bytes: size, tenant_id: TENANT, takeoff_run_id: RUN,
    pdf_path: runFilePath(TENANT, RUN, id), is_raster: null,
  })
  const uploads = [
    upload('upload-plan', 'Architectural.pdf', 'plan_set', files.declared ?? plan.length),
    upload('upload-eng', 'Engineering.pdf', 'engineering', engineering.length),
  ]
  const objects: Record<string, Uint8Array> = { [uploads[1].pdf_path]: engineering }
  if (!files.missing) objects[uploads[0].pdf_path] = plan
  return fakeDb({
    runs: [{ id: RUN, tenant_id: TENANT, status: 'queued', stage, status_note: null, usage: { starts: [NOW] }, checks: null, ...patch }],
    uploads,
    objects,
  })
}

const step = (fake: ReturnType<typeof fakeDb>, stage: TakeoffStage, attempt = 1, restart?: number) =>
  processStage(fake.db, { runId: RUN, stage, attempt, restart })
const enqueuedKeys = (fake: ReturnType<typeof fakeDb>) => fake.rpc.mock.calls.map(([, params]) => params.p_key)

/** The least a reading can be: no sheets, no roofs. */
const EMPTY_TAKEOFF: RoofPlanTakeoff = {
  version: 1,
  scale: { stated: null, sheet_size: null, pdf_page: [300, 300], calibration: { method: 'none', reference_mm: null, factor: null, delta_pct: null } },
  sheets: [],
  structures: [],
  scope: { includes: [], excludes: [], questions: [] },
}

describe('processStage', () => {
  it('takes a run through all six stages, ending needs_review when no written dimension confirms the scale', async () => {
    const fake = setup()
    let outcome = await step(fake, 'intake')
    expect(fake.tables.roof_takeoff_runs[0]).toMatchObject({ status: 'extracting', stage: 'classify' })
    const seen: TakeoffStage[] = ['intake']
    while (outcome.done === 'advanced') {
      seen.push(outcome.next)
      outcome = await step(fake, outcome.next)
    }
    expect(seen).toEqual([...TAKEOFF_STAGES])
    expect(outcome).toEqual({ done: 'finished', status: 'needs_review' })

    const [run] = fake.tables.roof_takeoff_runs
    const [reading] = fake.tables.plan_extractions
    expect(run).toMatchObject({
      status: 'needs_review', stage: 'persist', latest_extraction_id: reading.id, model: 'claude-opus-4-8',
      checks: { status: 'needs_review' }, completed_at: expect.any(String),
    })
    // The reading cites the engineering page it came from, with the sloped
    // area worked out from the pitch; each model stage records what it spent.
    const items = reading.items as RoofPlanTakeoff
    expect(items.structures[0].planes[0]).toMatchObject({
      plan_area_m2: 80, sloped_area_m2: 80.31, evidence: [{ file: 'Engineering.pdf', page: 1, text: '10000', bbox: null }],
    })
    expect(items.scale.pdf_page).toEqual([300, 300])
    // No plan sheet to calibrate, so C1 fails; the rest of the reading holds up.
    expect((run.checks as Checks).results.map((r) => `${r.id} ${r.result}`)).toEqual([
      'C1 fail', 'C2 pass', 'C3 skipped', 'C4 pass', 'C5 pass', 'C6 pass', 'C7 pass', 'C8 pass', 'C9 pass', 'C10 skipped',
    ])
    expect((run.usage as RunUsage).stages).toEqual({
      classify: { input_tokens: 0, output_tokens: 0, model_calls: 1, seconds: expect.any(Number) },
      extract: { input_tokens: 1000, output_tokens: 200, model_calls: 1, seconds: expect.any(Number) },
    })
    // The plan set's page has no title block; the model read the scanned one.
    expect(run.sheet_index).toEqual([
      { file: 'Architectural.pdf', page: 1, number: null, title: null, revision: null, status_text: null, kind: 'other', used: false },
      { file: 'Engineering.pdf', page: 1, number: 'S200', title: 'ROOF FRAMING PLAN', revision: '0', status_text: 'CONSTRUCTION ISSUE', kind: 'roof_framing', used: true },
    ])
    expect(reading).toMatchObject({ plan_upload_id: 'upload-eng', trade: 'roofing', takeoff_run_id: RUN, tenant_id: TENANT, model: 'claude-opus-4-8' })
    // The plan set has a text layer; the scanned engineering set has none.
    expect(fake.tables.plan_uploads.map((u) => [u.id, u.is_raster])).toEqual([['upload-plan', false], ['upload-eng', true]])
    expect(enqueuedKeys(fake)).toEqual(TAKEOFF_STAGES.slice(1).map((stage) => `takeoff:${RUN}:${stage}:0`))

    // One trace per stage attempt, carrying the two model stages' use (TKO-27).
    const traces = fake.tables.pipeline_traces
    expect(traces.map((t) => [t.step, t.substep, t.status, t.tenant_id])).toEqual(
      TAKEOFF_STAGES.map((stage) => ['plan_takeoff', stage, 'ok', TENANT]),
    )
    expect(traces.map((t) => t.decisions)).toEqual(TAKEOFF_STAGES.map((stage) => ({
      run_id: RUN,
      attempt: 1,
      ...(stage === 'classify' && { model: CLASSIFY_MODEL, input_tokens: 0, output_tokens: 0 }),
      ...(stage === 'extract' && { model: 'claude-opus-4-8', input_tokens: 1000, output_tokens: 200 }),
    })))
    expect(traces.every((t) => typeof t.duration_ms === 'number')).toBe(true)
  })

  it('does nothing for a job the run has moved past, a replaced job, or a deleted run', async () => {
    const fake = setup('classify', { status: 'extracting' })
    await expect(step(fake, 'intake')).resolves.toEqual({ done: 'skipped', reason: 'the run is extracting at classify' })
    await expect(step(fake, 'classify', 1, 5)).resolves.toEqual({ done: 'skipped', reason: 'a later start replaced this job' })
    await expect(processStage(fake.db, { runId: '5e4d3c2b-1a2b-4c3d-9e8f-0a1b2c3d4e5f', stage: 'classify', attempt: 1 }))
      .resolves.toEqual({ done: 'skipped', reason: 'the run no longer exists' })
    expect(fake.tables.roof_takeoff_runs[0]).toMatchObject({ status: 'extracting', stage: 'classify' })
    expect(fake.rpc).not.toHaveBeenCalled()
  })

  it('retries a failing stage, fails the run on the third attempt with its reason, and restarts there', async () => {
    const fake = setup('check', { status: 'extracting' })
    fake.tables.plan_extractions.push({ id: 'reading-1', takeoff_run_id: RUN, tenant_id: TENANT, model: 'claude-opus-4-8', items: EMPTY_TAKEOFF, created_at: NOW })
    fake.fail.readings = true
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(step(fake, 'check', 1)).rejects.toThrow('readings unavailable')
    await expect(step(fake, 'check', 2)).rejects.toThrow('readings unavailable')
    const note = 'The takeoff checks failed three times. Start the run again to retry it.'
    await expect(step(fake, 'check', 3)).resolves.toEqual({ done: 'failed', note })
    expect(fake.tables.roof_takeoff_runs[0]).toMatchObject({ status: 'failed', stage: 'check', status_note: note })

    // Each attempt left a trace, and the failure an err trace with its cause
    // and one structured log line: P2's alert (TKO-27).
    const cause = expect.stringContaining('readings unavailable')
    expect(fake.tables.pipeline_traces.map((t) => [t.substep, t.status, t.message, t.decisions])).toEqual([
      ['check', 'warn', cause, { run_id: RUN, attempt: 1 }],
      ['check', 'warn', cause, { run_id: RUN, attempt: 2 }],
      ['check', 'err', note, { run_id: RUN, attempt: 3, error: cause }],
    ])
    expect(logged.mock.calls.map(([line]) => JSON.parse(String(line)))).toEqual([{
      level: 'error', event: 'takeoff_run_failed', run_id: RUN, tenant_id: TENANT, stage: 'check', attempt: 3, note, cause,
    }])
    logged.mockRestore()

    fake.fail.readings = false
    await expect(startRun(fake.db, 'plan-pdfs', { tenantId: TENANT, runId: RUN, runsPerHour: 8 }))
      .resolves.toMatchObject({ ok: true, stage: 'check' })
    await expect(step(fake, 'check', 1, 1)).resolves.toEqual({ done: 'advanced', next: 'persist' })
    expect(enqueuedKeys(fake)).toEqual([`takeoff:${RUN}:check:1`, `takeoff:${RUN}:persist:1`])
  })

  it('fails the run without running the stage when an attempt past the third arrives', async () => {
    const fake = setup('extract', { status: 'extracting' })
    const note = 'The plan reading ran out of time three times. Start the run again to retry it.'
    await expect(step(fake, 'extract', 4)).resolves.toEqual({ done: 'failed', note })
    expect(fake.tables.plan_extractions).toEqual([])
    expect(fake.tables.pipeline_traces).toEqual([
      expect.objectContaining({ substep: 'extract', status: 'err', message: note, decisions: { run_id: RUN, attempt: 4 } }),
    ])
  })

  it.each([
    ['a file that is not a PDF', { plan: new TextEncoder().encode('not a pdf at all') }, 'Architectural.pdf is not a PDF file.'],
    ['a file of another size than declared', { declared: 99 }, "Architectural.pdf isn't the size it was declared at."],
    ['a file missing from storage', { missing: true }, 'Architectural.pdf is missing from storage.'],
    ['more than 200 pages', { plan: pdf({ pages: 201 }) }, 'The plans have more than 200 pages, the most a run takes.'],
  ])('fails the run at once for %s', async (_label, files, note) => {
    const fake = setup('intake', {}, files)
    await expect(step(fake, 'intake', 1)).resolves.toEqual({ done: 'failed', note })
    expect(fake.tables.roof_takeoff_runs[0]).toMatchObject({ status: 'failed', stage: 'intake', status_note: note })
    expect(fake.tables.pipeline_traces.map((t) => [t.substep, t.status, t.message])).toEqual([['intake', 'err', note]])
    expect(fake.rpc).not.toHaveBeenCalled()
  })

  it('fails the run at once for a file that unpacks to hundreds of megabytes, before the PDF reader opens it', async () => {
    // 130 kB that inflates to 130 MB: a flate bomb exhausts the service's
    // memory in text extraction (TKO-28).
    const data = deflateSync(Buffer.alloc(130 * 1024 * 1024))
    const plan = new Uint8Array(Buffer.concat([
      Buffer.from(`%PDF-1.7\n1 0 obj\n<< /Length ${data.length} /Filter /FlateDecode >>\nstream\n`),
      data,
      Buffer.from('\nendstream\nendobj\ntrailer\n<< >>\n%%EOF\n'),
    ]))
    const note = "Architectural.pdf unpacks to far more than any plan set, so it wasn't read. Save it again as a standard PDF."
    const fake = setup('intake', {}, { plan })
    await expect(step(fake, 'intake', 1)).resolves.toEqual({ done: 'failed', note })
    expect(fake.tables.roof_takeoff_runs[0]).toMatchObject({ status: 'failed', stage: 'intake', status_note: note })
    expect(fake.tables.pipeline_traces.map((t) => [t.substep, t.status, t.message])).toEqual([['intake', 'err', note]])
    expect(fake.rpc).not.toHaveBeenCalled()
  })

  it('marks the run ready when its checks pass, linking the latest reading', async () => {
    const fake = setup('persist', { status: 'extracting', checks: { status: 'ready' } })
    fake.tables.plan_extractions.push(
      { id: 'reading-old', takeoff_run_id: RUN, tenant_id: TENANT, model: 'model-a', created_at: '2026-11-01T10:01:00.000Z' },
      { id: 'reading-new', takeoff_run_id: RUN, tenant_id: TENANT, model: 'model-b', created_at: '2026-11-01T10:05:00.000Z' },
    )
    await expect(step(fake, 'persist')).resolves.toEqual({ done: 'finished', status: 'ready' })
    expect(fake.tables.roof_takeoff_runs[0]).toMatchObject({ status: 'ready', latest_extraction_id: 'reading-new', model: 'model-b' })
    expect(fake.rpc).not.toHaveBeenCalled()
  })
})
