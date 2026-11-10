// The eval (TKO-15, DEC-040) with stand-in models: a fixture goes through the
// pipeline as a run does and is scored against its reference, fixtures load
// from storage, and a run is recorded. The live eval is the script's.

import type { generateText } from 'ai'
import { PDFDocument } from 'pdf-lib'
import { describe, expect, it, vi } from 'vitest'
import { brokenPrompt, evalFixture, loadFixtures, promptVersion, recordEval, runEval, swapReader, type EvalFixture } from './eval'
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
