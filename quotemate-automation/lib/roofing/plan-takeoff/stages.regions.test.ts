// The calibrate stage keeps a run's numbered roof areas (TKO-30, DEC-048): the
// numbered plan in the run's folder, the areas and the reader's suggestion on
// the run, and the suggestion's model use. refineReading stands in, so the
// test needs no drawing; refine.fixtures.test.ts finds Whittaker's for real.

import { describe, expect, it, vi } from 'vitest'
import { refineReading } from './refine'
import type { RunRegions } from './regions'
import { regionsPlanPath } from './runs'
import type { RoofPlanTakeoff } from './schema'
import { STAGE_RUNNERS, type RunUsage } from './stages'
import { fakeDb } from './test-db'

vi.mock('./refine', async (importOriginal) => ({ ...(await importOriginal<typeof import('./refine')>()), refineReading: vi.fn() }))

const TAKEOFF: RoofPlanTakeoff = {
  version: 1,
  scale: { stated: null, sheet_size: null, pdf_page: [300, 300], calibration: { method: 'none', reference_mm: null, factor: null, delta_pct: null } },
  sheets: [],
  structures: [],
  scope: { includes: [], excludes: [], questions: [] },
}
const square: Array<[number, number]> = [[0, 0], [10, 0], [10, 10], [0, 10]]
const STORED: RunRegions = {
  sheet: { file: 'plans.pdf', page: 1 }, factor: 35.3, pitch: 5, houses: [square],
  areas: [{ axis: 'v', spacing: 3, polygon: square, centre: [5, 5] }, { axis: 'h', spacing: 3, polygon: square, centre: [5, 5] }],
  roofs: [{ id: 'S1', label: 'House' }], suggested: [{ n: 1, roof: 'S1', fall: 'north', covers: null }], note: null, confirmed: null, before: null,
}
const refined = (regions: { stored: RunRegions; plan: Uint8Array } | null) => ({
  takeoff: TAKEOFF, changed: false, sheets: 1, measured: 0, pitched: 0, hipped: 0, derived: 0,
  regions, usage: regions ? { inputTokens: 2600, outputTokens: 250, calls: 1 } : null,
})
// A run read once before, whose areas a restart replaces.
const seed = () => fakeDb({
  runs: [{ id: 'r1', tenant_id: 't1', sheet_index: [], scope_note: 'Re-roof the house.', usage: { starts: [] }, checks: null, regions: { ...STORED, note: 'from the last read' } }],
  extractions: [{ id: 'x1', tenant_id: 't1', takeoff_run_id: 'r1', items: TAKEOFF, model: 'claude-opus-4-8', created_at: '2026-11-08T00:00:00.000Z' }],
})
const calibrate = (fake: ReturnType<typeof fakeDb>) =>
  STAGE_RUNNERS.calibrate({ db: fake.db, bucket: 'plan-pdfs', run: { id: 'r1', tenant_id: 't1', usage: { starts: [] }, checks: null } })

describe('the calibrate stage and the numbered roof areas', () => {
  it("keeps the run's numbered areas, their plan and the suggestion's model use, and asks with the run's scope note", async () => {
    const plan = new Uint8Array([37, 80, 68, 70])
    vi.mocked(refineReading).mockResolvedValue(refined({ stored: STORED, plan }) as never)
    const fake = seed()
    await expect(calibrate(fake)).resolves.toMatchObject({ regions: 2 })
    expect(vi.mocked(refineReading).mock.calls[0][1]).toMatchObject({ scopeNote: 'Re-roof the house.', suggest: expect.any(Function) })
    expect(fake.objects[regionsPlanPath('t1', 'r1')]).toEqual(plan)
    const [run] = fake.tables.roof_takeoff_runs
    expect(run.regions).toEqual(STORED)
    expect((run.usage as RunUsage).stages?.calibrate).toMatchObject({ input_tokens: 2600, output_tokens: 250, model_calls: 1 })
    // A restart writes the plan again.
    vi.mocked(refineReading).mockResolvedValue(refined({ stored: STORED, plan: new Uint8Array([1]) }) as never)
    await calibrate(fake)
    expect(fake.objects[regionsPlanPath('t1', 'r1')]).toEqual(new Uint8Array([1]))
  })

  it('clears the areas a run had before when its reading has none, and spends nothing', async () => {
    vi.mocked(refineReading).mockResolvedValue(refined(null) as never)
    const fake = seed()
    await expect(calibrate(fake)).resolves.toMatchObject({ regions: 0 })
    const [run] = fake.tables.roof_takeoff_runs
    expect(run.regions).toBeNull()
    expect(run.usage).toEqual({ starts: [] })
    expect(Object.keys(fake.objects)).toEqual([])
  })
})
