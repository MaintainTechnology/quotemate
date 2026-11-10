// The eval with the operator in the loop (TKO-30, DEC-048): a fixture's
// operator.json answers its numbered roof areas as the operator would on the
// run page, and the eval measures that answer before it scores the reading.
// refineReading stands in, so the test needs no drawing.

import type { generateText } from 'ai'
import { PDFDocument } from 'pdf-lib'
import { describe, expect, it, vi } from 'vitest'
import { evalFixture, type EvalFixture } from './eval'
import { refineReading } from './refine'
import type { RunRegions } from './regions'
import { RoofPlanTakeoffSchema } from './schema'

vi.mock('./refine', async (importOriginal) => ({ ...(await importOriginal<typeof import('./refine')>()), refineReading: vi.fn() }))

type P = [number, number]
const plane = (id: string, area: number, pitch: number) => ({
  id, plan_dims_mm: null, polygon_mm: null, plan_area_m2: area, pitch_deg: pitch, pitch_source: 'elevation' as const,
  fall: null, profile: null, finish_tag: null, sloped_area_m2: null, confidence: 'medium' as const, evidence: [],
})
const takeoff = (planes: ReturnType<typeof plane>[]) => RoofPlanTakeoffSchema.parse({
  version: 1,
  scale: { stated: '1:100', sheet_size: 'A3', pdf_page: [1191, 842], calibration: { method: 'none', reference_mm: null, factor: null, delta_pct: null } },
  sheets: [],
  structures: [{ id: 'S1', label: 'House', role: 'primary', source: 'plans', planes, edges: [], exclusions: [] }],
  scope: { includes: [], excludes: [], questions: [] },
})
// The pipeline measured the house's 40 m²; a lean-to on its west wall is the
// one numbered area, which the reader suggests falls east, across the answer.
const REFINED = takeoff([plane('S1-P1', 40, 25)])
const REFERENCE = takeoff([plane('S1-P1', 40, 25), plane('S1-P2', 14.3, 5)])
const HOUSE: P[] = [[100, 100], [300, 100], [300, 260], [100, 260]]
const REGIONS: RunRegions = {
  sheet: { file: 'plans.pdf', page: 1 }, factor: 50, pitch: 5, houses: [HOUSE],
  areas: [{ axis: 'h', spacing: 3.2, polygon: [[40, 140], [97.2, 140], [97.2, 240], [40, 240]], centre: [68.6, 190] }],
  roofs: [{ id: 'S1', label: 'House' }], suggested: [{ n: 1, roof: 'S1', fall: 'east', covers: 'Laundry' }], note: null, confirmed: null, before: null,
}
vi.mocked(refineReading).mockResolvedValue({
  takeoff: REFINED, changed: true, sheets: 1, measured: 0, pitched: 0, hipped: 0, derived: 0,
  regions: { stored: REGIONS, plan: new Uint8Array([37]) }, usage: { inputTokens: 2600, outputTokens: 250, calls: 1 },
})

// The reader's reply; what refineReading makes of it stands in above.
const reply = JSON.stringify({
  scale: { stated: '1:100', sheet_size: 'A3', page: 1 },
  structures: [{
    id: 'S1', label: 'House', role: 'primary',
    planes: [{ id: 'S1-P1', plan_dims_mm: null, polygon_mm: null, plan_area_m2: null, pitch_deg: null, pitch_source: null, fall: null, profile: null, finish_tag: null, confidence: 'low', evidence: [{ page: 1, text: 'ROOF PLAN' }] }],
    edges: [], exclusions: [],
  }],
  scope: { includes: [], excludes: [], questions: [] },
})
const generate = () => vi.fn().mockResolvedValue({ text: reply, finishReason: 'stop', usage: { inputTokens: 900, outputTokens: 300 } }) as unknown as typeof generateText
const readSheet = vi.fn(async () => ({ number: 'A104', title: 'ROOF PLAN', revision: 'A', status_text: 'FOR CONSTRUCTION', kind: 'roof_plan' as const }))
const fixture = async (operator: EvalFixture['operator']): Promise<EvalFixture> => {
  const doc = await PDFDocument.create()
  doc.addPage([1191, 842])
  return {
    name: 'lean-to', request: { job_name: null, job_ref: 'J1', site_address: null, scope_note: 'Re-roof the house.' },
    reference: REFERENCE, files: new Map([['plans.pdf', new Uint8Array(await doc.save())]]), operator,
  }
}

describe('evalFixture with the operator in the loop', () => {
  it("measures the fixture's operator answer before it scores, and notes how the reader's suggestion compared", async () => {
    const result = await evalFixture(await fixture([{ n: 1, roof: 'S1', fall: 'west' }]), { generate: generate(), readSheet })
    expect(vi.mocked(refineReading).mock.calls.at(-1)?.[1]).toMatchObject({ scopeNote: 'Re-roof the house.', suggest: expect.any(Function) })
    expect(result.reading?.structures[0].planes.map((p) => [p.plan_area_m2, p.fall])).toEqual([[40, null], [14.3, 'west']])
    expect(result.score.area.pass).toBe(true)
    expect(result.regions).toBe("1 numbered roof area; the operator's answer measured 1; the reader suggested 0 of 1 as the operator answered")
    // The classifier's call, the reader's, and the suggestion's.
    expect(result.usage).toEqual({ inputTokens: 3500, outputTokens: 550, calls: 3 })
  })

  it('measures nothing for a fixture with no operator answer, and says so', async () => {
    const result = await evalFixture(await fixture(null), { generate: generate(), readSheet })
    expect(result.reading?.structures[0].planes.map((p) => p.plan_area_m2)).toEqual([40])
    expect(result.score.area.pass).toBe(false)
    expect(result.regions).toBe('1 numbered roof area, and no operator answer in the fixture, so none is measured')
  })

  it("scores the reading as refined when the operator's answer can't be measured, and says why", async () => {
    const result = await evalFixture(await fixture([{ n: 2, roof: 'S1', fall: 'west' }]), { generate: generate(), readSheet })
    expect(result.reading?.structures[0].planes.map((p) => p.plan_area_m2)).toEqual([40])
    expect(result.regions).toMatch(/^1 numbered roof area; the operator's answer couldn't be measured: Area 1 has no answer/)
  })
})
