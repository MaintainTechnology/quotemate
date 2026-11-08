// The eval (TKO-15, DEC-040) with stand-in models: a fixture goes through the
// pipeline as a run does and is scored against its reference, fixtures load
// from storage, and a run is recorded. The live eval is the script's.

import type { generateText } from 'ai'
import { PDFDocument } from 'pdf-lib'
import { describe, expect, it, vi } from 'vitest'
import { brokenPrompt, evalFixture, loadFixtures, promoteRun, promptVersion, recordEval, runEval, swapReader, type EvalFixture } from './eval'
import { READER_SYSTEM } from './prompt'
import type { RoofPlanTakeoff } from './schema'
import { fakeDb } from './test-db'

const plansPdf = async () => {
  const doc = await PDFDocument.create()
  doc.addPage([1191, 842]) // a blank A3 page: no text, so the classifier reads it
  return new Uint8Array(await doc.save())
}
const readSheet = vi.fn(async () => ({ number: 'A101', title: 'ROOF PLAN', revision: 'A', status_text: 'FOR CONSTRUCTION', kind: 'roof_plan' as const }))

const REFERENCE: RoofPlanTakeoff = {
  version: 1,
  scale: { stated: '1:100', sheet_size: 'A3', pdf_page: [1191, 842], calibration: { method: 'none', reference_mm: null, factor: null, delta_pct: null } },
  sheets: [],
  structures: [{
    id: 'S1', label: 'Garage', role: 'primary', source: 'plans', exclusions: [],
    planes: [{
      id: 'S1-P1', plan_dims_mm: [6000, 4000], polygon_mm: null, plan_area_m2: 24, pitch_deg: 5, pitch_source: 'note',
      fall: 'south', profile: 'Trimdek', finish_tag: null, sloped_area_m2: 24.09, confidence: 'high', evidence: [],
    }],
    edges: [
      { type: 'eave', length_m: 6, source: 'measured', confidence: 'high' },
      { type: 'high_side', length_m: 6, source: 'measured', confidence: 'high' },
      { type: 'barge', length_m: 4.015, source: 'derived', confidence: 'high' },
      { type: 'barge', length_m: 4.015, source: 'derived', confidence: 'high' },
    ],
  }],
  scope: { includes: [], excludes: [], questions: [] },
}
// The reader's reply, its edges read at right angles: the refine step's
// skillion edges put them right, so the eval scores what the pipeline finishes.
const reply = JSON.stringify({
  scale: { stated: '1:100', sheet_size: 'A3', page: 1 },
  structures: [{
    id: 'S1', label: 'Garage', role: 'primary',
    planes: [{
      id: 'S1-P1', plan_dims_mm: [6000, 4000], polygon_mm: null, plan_area_m2: 24, pitch_deg: 5, pitch_source: 'note',
      fall: 'south', profile: 'Trimdek', finish_tag: null, confidence: 'high', evidence: [{ page: 1, text: '6000' }],
    }],
    edges: ['eave', 'high_side', 'barge', 'barge'].map((type, i) => ({ type, length_m: i < 2 ? 4 : 6, source: 'measured', confidence: 'high' })),
    exclusions: [],
  }],
  scope: { includes: ['Roof sheeting'], excludes: [], questions: [] },
})
const answering = (...texts: string[]) => {
  const generate = vi.fn()
  for (const text of texts) generate.mockResolvedValueOnce({ text, finishReason: 'stop', usage: { inputTokens: 900, outputTokens: 300 } })
  return generate as unknown as typeof generateText
}
const fixture = async (): Promise<EvalFixture> => ({
  name: 'demo',
  request: { job_name: 'Demo garage', job_ref: 'J1', site_address: null, scope_note: 'Roofing - Steel (Supply & Fit).' },
  reference: REFERENCE,
  files: new Map([['plans.pdf', await plansPdf()]]),
})

describe('evalFixture', () => {
  it('classifies, reads, refines and checks a fixture as a run is, then scores it', async () => {
    const generate = answering(reply)
    const result = await evalFixture(await fixture(), { generate, readSheet })
    expect(readSheet).toHaveBeenCalled()
    const [call] = (generate as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [{ messages: Array<{ content: unknown }> }]
    expect(JSON.stringify(call.messages)).toContain('<scope_note>Roofing - Steel (Supply & Fit).</scope_note>')
    // Two model calls: the classifier's read of the blank page, and the reader's.
    expect(result).toMatchObject({ fixture: 'demo', status: 'needs_review', note: null, usage: { inputTokens: 900, outputTokens: 300, calls: 2 } })
    expect(result.score.pass).toBe(true)
    expect(result.reading?.structures[0].edges.map((e) => `${e.type} ${e.length_m}`)).toEqual(['eave 6', 'high_side 6', 'barge 4.015', 'barge 4.015'])
  })

  it('fails a fixture whose model call throws, with the error as its reason, rather than the whole eval', async () => {
    const generate = vi.fn().mockRejectedValue(new Error('invalid x-api-key')) as unknown as typeof generateText
    const result = await evalFixture(await fixture(), { generate, readSheet })
    expect(result).toMatchObject({ status: null, reading: null, note: 'The pipeline stopped: invalid x-api-key', score: { pass: false } })
  })

  it('scores a reading that failed as failing every gate, with its reason', async () => {
    const result = await evalFixture(await fixture(), { generate: answering('not json', 'still not json'), readSheet })
    expect(result).toMatchObject({ status: null, reading: null, note: expect.stringMatching(/./) })
    expect(result.score).toMatchObject({ pass: false, structures: { pass: false, detail: '0 roofs read, 1 expected.' }, area: { pass: false }, pitch: { pass: false }, edges: { pass: false } })
  })
})

describe('loadFixtures', () => {
  it('reads each folder under eval/ as a fixture: its PDFs, its request and its reference', async () => {
    const json = (value: unknown) => new TextEncoder().encode(JSON.stringify(value))
    const { db } = fakeDb({
      objects: {
        'eval/demo/request.json': json({ job_name: 'Demo garage', job_ref: 'J1', site_address: null, scope_note: null }),
        'eval/demo/takeoff.json': json(REFERENCE),
        'eval/demo/plans.pdf': await plansPdf(),
        'eval/README.txt': 3,
      },
    })
    const [demo, ...others] = await loadFixtures(db, 'plan-pdfs')
    expect(others).toEqual([])
    expect(demo).toMatchObject({ name: 'demo', request: { job_name: 'Demo garage' }, reference: { structures: [{ id: 'S1' }] } })
    expect([...demo.files.keys()]).toEqual(['plans.pdf'])
  })

  it("takes a fixture's operator.json as the operator's answer to its numbered roof areas (TKO-30)", async () => {
    const json = (value: unknown) => new TextEncoder().encode(JSON.stringify(value))
    const areas = [{ n: 1, roof: 'S1', fall: 'west' }, { n: 2, roof: null, fall: null }]
    const { db } = fakeDb({
      objects: {
        'eval/demo/request.json': json({ job_name: null, job_ref: 'J1', site_address: null, scope_note: null }),
        'eval/demo/takeoff.json': json(REFERENCE),
        'eval/demo/operator.json': json({ note: 'As the drawings read.', areas }),
        'eval/other/request.json': json({ job_name: null, job_ref: 'J2', site_address: null, scope_note: null }),
        'eval/other/takeoff.json': json(REFERENCE),
      },
    })
    const [demo, other] = await loadFixtures(db, 'plan-pdfs')
    expect([demo.operator, other.operator]).toEqual([areas, null])
  })
})

describe('recordEval', () => {
  it("writes one eval_runs row, scored as the share of gates passed, and one item a fixture", async () => {
    const { db, tables } = fakeDb()
    const passing = await evalFixture(await fixture(), { generate: answering(reply), readSheet })
    const failing = { ...(await evalFixture(await fixture(), { generate: answering('x', 'y'), readSheet })), fixture: 'broken' }
    const id = await recordEval(db, [passing, failing], { model: 'claude-opus-4-8', promptVersion: 'abc123', startedAt: new Date('2026-11-06T10:00:00Z') })
    expect(tables.eval_runs).toEqual([expect.objectContaining({
      id, prompt_version: 'abc123', catalogue_version: 'roof-takeoff', total_score: 50,
      per_category: { model: 'claude-opus-4-8', fixtures: 2, structures: 1, area: 1, pitch: 1, edges: 1, passing: ['demo'] },
      started_at: '2026-11-06T10:00:00.000Z',
    })])
    expect(tables.eval_run_items.map((row) => [row.run_id, row.intake_fixture_id])).toEqual([[id, 'demo'], [id, 'broken']])
    expect(tables.eval_run_items[0]).toMatchObject({ expected: REFERENCE, notes: expect.stringContaining('pass structures: 1 roofs read, 1 expected.') })
    expect(tables.eval_run_items[1]).toMatchObject({ actual: { error: expect.any(String) } })
  })

  it("notes what came of a fixture's numbered roof areas (TKO-30)", async () => {
    const { db, tables } = fakeDb()
    const result = await evalFixture(await fixture(), { generate: answering(reply), readSheet })
    await recordEval(db, [{ ...result, regions: "6 numbered roof areas; the operator's answer measured 5" }], { model: 'claude-opus-4-8', promptVersion: 'abc123', startedAt: new Date('2026-11-08T10:00:00Z') })
    expect(tables.eval_run_items[0].notes).toContain("regions: 6 numbered roof areas; the operator's answer measured 5")
  })
})

describe('runEval', () => {
  it('runs every fixture in storage and records the run', async () => {
    const json = (value: unknown) => new TextEncoder().encode(JSON.stringify(value))
    const { db, tables } = fakeDb({
      objects: {
        'eval/demo/request.json': json({ job_name: 'Demo garage', job_ref: 'J1', site_address: null, scope_note: null }),
        'eval/demo/takeoff.json': json(REFERENCE),
        'eval/demo/plans.pdf': await plansPdf(),
      },
    })
    const { id, results } = await runEval(db, 'plan-pdfs', { generate: answering(reply), readSheet })
    expect(results.map((r) => [r.fixture, r.score.pass])).toEqual([['demo', true]])
    expect(tables.eval_runs).toEqual([expect.objectContaining({ id, prompt_version: promptVersion(), total_score: 100 })])
  })
})

describe('promoteRun (TKO-00c)', () => {
  const NOW = new Date('2026-11-07T00:00:00.000Z')
  const PLAN_FILE = 'Floor plan - 5 Smith St.pdf'
  const corrected = (): RoofPlanTakeoff => ({
    ...structuredClone(REFERENCE),
    sheets: [{ file: PLAN_FILE, page: 1, number: 'A104', title: 'SMITH RESIDENCE ROOF PLAN', revision: 'P3', status_text: 'PRELIMINARY', kind: 'roof_plan', used: true }],
    structures: REFERENCE.structures.map((s) => ({
      ...structuredClone(s),
      planes: s.planes.map((p) => ({ ...structuredClone(p), evidence: [{ file: PLAN_FILE, page: 1, text: 'Client: Jane Smith', bbox: null }] })),
    })),
    scope: { includes: ['Re-roof'], excludes: [], questions: ['Ask Jane Smith on 0412 345 678 about the gutters.'] },
  })
  const setup = async (correction: RoofPlanTakeoff | null = corrected()) => fakeDb({
    runs: [{
      id: 'r1', tenant_id: 't1', status: 'needs_review', job_name: 'Smith St re-roof', job_ref: 'J1',
      site_address: '5 Smith St, Town QLD 4000', scope_note: 'Roofing - Steel. Call Jane Smith on 0412 345 678.', latest_extraction_id: 'x1',
    }],
    extractions: [{ id: 'x1', tenant_id: 't1', takeoff_run_id: 'r1', items: REFERENCE, corrected_items: correction }],
    uploads: [{ id: 'u1', tenant_id: 't1', takeoff_run_id: 'r1', filename: PLAN_FILE, pdf_path: 'roofing/t1/r1/u1.pdf', created_at: '2026-11-01T00:00:00.000Z' }],
    objects: { 'roofing/t1/r1/u1.pdf': await plansPdf() },
  })
  const json = (fake: ReturnType<typeof fakeDb>, path: string) => JSON.parse(new TextDecoder().decode(fake.objects[path] as Uint8Array))
  const fixtureFiles = (fake: ReturnType<typeof fakeDb>) => Object.keys(fake.objects).filter((key) => key.startsWith('eval/')).sort()

  it('copies a corrected run into eval/<name>/: its PDFs under plain names, and no site, names or drawing text', async () => {
    const fake = await setup()
    await expect(promoteRun(fake.db, 'plan-pdfs', { tenantId: 't1', runId: 'r1', name: 'smith-st', now: NOW })).resolves.toEqual({ ok: true, name: 'smith-st', files: 1 })
    expect(fixtureFiles(fake)).toEqual(['eval/smith-st/plans-1.pdf', 'eval/smith-st/request.json', 'eval/smith-st/takeoff.json'])
    expect(fake.objects['eval/smith-st/plans-1.pdf']).toEqual(fake.objects['roofing/t1/r1/u1.pdf'])
    // Kept as long as the run is (D-06), when the sweep removes it.
    expect(json(fake, 'eval/smith-st/request.json')).toEqual({
      job_name: null, job_ref: 'J1', site_address: null,
      scope_note: 'Roofing - Steel. Call [name removed] on [phone removed].',
      promoted: { run_id: 'r1', at: '2026-11-07T00:00:00.000Z', expires_at: '2027-11-07T00:00:00.000Z' },
    })
    const reference = json(fake, 'eval/smith-st/takeoff.json')
    expect(reference.sheets).toEqual([{ file: 'plans-1.pdf', page: 1, number: 'A104', title: null, revision: 'P3', status_text: null, kind: 'roof_plan', used: true }])
    expect(reference.structures[0].planes[0].evidence).toEqual([])
    expect(JSON.stringify(reference)).not.toMatch(/Jane|Smith|SMITH|0412/)
    // The nightly eval takes it as it takes the others.
    const loaded = (await loadFixtures(fake.db, 'plan-pdfs')).find((f) => f.name === 'smith-st')
    expect([...(loaded?.files.keys() ?? [])]).toEqual(['plans-1.pdf'])
  })

  it("carries the operator's answer to the run's numbered roof areas, so the eval measures it as the run page did (TKO-30)", async () => {
    const fake = await setup()
    const areas = [{ n: 1, roof: 'S1', fall: 'west' }, { n: 2, roof: null, fall: null }]
    fake.tables.roof_takeoff_runs[0].regions = { confirmed: { areas, at: '2026-11-06T00:00:00.000Z' } }
    await expect(promoteRun(fake.db, 'plan-pdfs', { tenantId: 't1', runId: 'r1', name: 'smith-st', now: NOW })).resolves.toMatchObject({ ok: true })
    expect(fixtureFiles(fake)).toEqual(['eval/smith-st/operator.json', 'eval/smith-st/plans-1.pdf', 'eval/smith-st/request.json', 'eval/smith-st/takeoff.json'])
    expect(json(fake, 'eval/smith-st/operator.json')).toEqual({ areas })
    expect((await loadFixtures(fake.db, 'plan-pdfs')).find((f) => f.name === 'smith-st')?.operator).toEqual(areas)
  })

  it("refuses a run it can't find, one no tradie corrected, a name that isn't a plain slug, and a name taken", async () => {
    const uncorrected = await setup(null)
    const promote = (fake: ReturnType<typeof fakeDb>, name: string, runId = 'r1') => promoteRun(fake.db, 'plan-pdfs', { tenantId: 't1', runId, name, now: NOW })
    await expect(promote(uncorrected, 'smith-st', 'nope')).resolves.toEqual({ ok: false, error: 'not_found' })
    await expect(promote(uncorrected, 'smith-st')).resolves.toEqual({ ok: false, error: 'not_corrected' })
    await expect(promote(uncorrected, 'Smith St')).resolves.toEqual({ ok: false, error: 'invalid_name' })
    const taken = await setup()
    taken.objects['eval/grange/request.json'] = new TextEncoder().encode('{}')
    await expect(promote(taken, 'grange')).resolves.toEqual({ ok: false, error: 'exists' })
    expect(fixtureFiles(taken)).toEqual(['eval/grange/request.json'])
  })

  it('leaves nothing behind when a copy fails part way', async () => {
    const fake = await setup()
    fake.hooks.onUpload = () => { fake.fail.upload = true } // the plans copy; then storage refuses
    await expect(promoteRun(fake.db, 'plan-pdfs', { tenantId: 't1', runId: 'r1', name: 'smith-st', now: NOW })).rejects.toThrow(/upload refused/)
    expect(fixtureFiles(fake)).toEqual([])
  })
})

describe('the prompts the eval swaps in', () => {
  it('versions the prompt by its hash, and breaks it with an estimator\'s waste allowance on every area', () => {
    expect(promptVersion()).toMatch(/^[0-9a-f]{12}$/)
    expect(promptVersion(brokenPrompt)).not.toBe(promptVersion())
    expect(brokenPrompt).not.toContain('Never adjust it for pitch')
    expect(brokenPrompt).toContain("plan_area_m2 is the roof's area with 10% added for waste and laps.")
    // One rule changed, the rest as they are.
    expect(brokenPrompt.split('\n').filter((line, i) => line !== READER_SYSTEM.split('\n')[i])).toHaveLength(1)
  })

  it("swaps the reader's system prompt and nothing else", async () => {
    const base = vi.fn(async () => ({ text: '{}' }))
    const generate = swapReader({ system: 'Report the roofs.' }, base as unknown as typeof generateText)
    await generate({ model: 'm', messages: [{ role: 'system', content: READER_SYSTEM }, { role: 'user', content: 'plans' }] } as never)
    expect(base).toHaveBeenCalledWith({ model: 'm', messages: [{ role: 'system', content: 'Report the roofs.' }, { role: 'user', content: 'plans' }] })
  })

  it("swaps the reader's output limit and effort, for a model that thinks (D-07)", async () => {
    const base = vi.fn(async () => ({ text: '{}' }))
    const generate = swapReader({ maxOutputTokens: 32_000, effort: 'medium' }, base as unknown as typeof generateText)
    const messages = [{ role: 'user', content: 'plans' }]
    await generate({ model: 'm', maxOutputTokens: 12_000, messages } as never)
    expect(base).toHaveBeenCalledWith({ model: 'm', maxOutputTokens: 32_000, messages, providerOptions: { anthropic: { effort: 'medium' } } })
  })
})
