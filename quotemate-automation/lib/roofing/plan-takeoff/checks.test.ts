// The takeoff checks (P2, TKO-13): each of C1 to C9 passing and failing on a
// made-up takeoff, the status rule, and reading an area schedule.
// checks.fixtures.test.ts runs them on the fixtures.

import { describe, expect, it } from 'vitest'
import {
  areaSchedule, complete, confidence, dimensionsConsistent, drawingStatus, exclusionsApplied, exclusionsAsked, pitchPlausible,
  runChecks, scaleCalibrated, scheduleReconciles, structureCount, type CheckContext,
} from './checks'
import type { PageText, Sheet, TextRun } from './classify'
import type { RoofPlanTakeoff } from './schema'

type Plane = RoofPlanTakeoff['structures'][number]['planes'][number]
const plane = (changes: Partial<Plane> = {}): Plane => ({
  id: 'S1-P1', plan_dims_mm: [10000, 8000], polygon_mm: null, plan_area_m2: 80, pitch_deg: 5, pitch_source: 'note',
  fall: null, profile: 'Custom Orb', finish_tag: null, sloped_area_m2: 80.31, confidence: 'high',
  evidence: [{ file: 'plans.pdf', page: 1, text: '10000', bbox: null }], ...changes,
})
const sheet = (changes: Partial<Sheet> = {}): Sheet => ({
  file: 'plans.pdf', page: 1, number: 'A101', title: 'ROOF PLAN', revision: 'A', status_text: 'FOR CONSTRUCTION', kind: 'roof_plan', used: true, ...changes,
})
const takeoff = (changes: Partial<RoofPlanTakeoff> = {}, planes = [plane()]): RoofPlanTakeoff => ({
  version: 1,
  scale: { stated: '1:100 @ A1', sheet_size: 'A1', pdf_page: [2383.94, 1683.78], calibration: { method: 'dimension_string', reference_mm: 10130, factor: 35.28, delta_pct: 0.01 } },
  sheets: [sheet()],
  structures: [{ id: 'S1', label: 'House', role: 'primary', source: 'plans', planes, edges: [], exclusions: [] }],
  scope: { includes: [], excludes: [], questions: [] },
  ...changes,
})
const ctx: CheckContext = { scopeNote: 'Roofing - Steel (Supply & Fit)', schedule: [] }
const footprint = (m2: number) => ({ ...ctx, schedule: [{ label: 'PROPOSED DUAL OCCUPANCY FOOTPRINT', m2, file: 'plans.pdf', page: 1 }] })
const calibration = (method: 'dimension_string' | 'title_block' | 'none', delta: number | null, sheetSize = 'A1', pdfPage: [number, number] = [2383.94, 1683.78]) =>
  takeoff({ scale: { stated: '1:100 @ A1', sheet_size: sheetSize, pdf_page: pdfPage, calibration: { method, reference_mm: 10130, factor: 35.28, delta_pct: delta } } })

describe('C1 scale calibrated', () => {
  it('passes when a written dimension confirms the stated scale within 1%', () => {
    expect(scaleCalibrated(takeoff())).toMatchObject({ result: 'pass', detail: expect.stringContaining('10130 mm dimension confirms 1:100 @ A1') })
  })
  it.each([
    ['written dimensions disagree with the stated scale', calibration('dimension_string', 3), '3% off'],
    ['only the stated scale is known, on an A1 sheet printed at A3', calibration('title_block', null, 'A1', [1190.52, 841.92]), 'printed at 50% size'],
    ['there is nothing to go on', calibration('none', null), 'state no scale'],
  ])('fails when %s', (_label, t, detail) => {
    expect(scaleCalibrated(t)).toMatchObject({ result: 'fail', detail: expect.stringContaining(detail) })
  })
})

describe('C2 dimensions consistent', () => {
  it('passes when sizes and outlines agree with areas', () => {
    expect(dimensionsConsistent(takeoff({}, [plane({ polygon_mm: [[0, 0], [10000, 0], [10000, 8000], [0, 8000]] })]))).toMatchObject({ result: 'pass' })
  })
  it('fails when a size disagrees with the area by more than 3%', () => {
    expect(dimensionsConsistent(takeoff({}, [plane({ plan_area_m2: 90 })]))).toMatchObject({ result: 'fail', detail: expect.stringContaining('80 m², but its area is 90 m²') })
  })
  it('is skipped when no plane has a size or outline', () => {
    expect(dimensionsConsistent(takeoff({}, [plane({ plan_dims_mm: null })]))).toMatchObject({ result: 'skipped' })
  })
})

describe('C3 area schedule reconciles', () => {
  it('passes within 2% of the stated footprint', () => {
    expect(scheduleReconciles(takeoff(), footprint(81))).toMatchObject({ result: 'pass', evidence: { file: 'plans.pdf', page: 1 } })
  })
  it('fails beyond 2%', () => {
    expect(scheduleReconciles(takeoff(), footprint(100))).toMatchObject({ result: 'fail', detail: expect.stringContaining('20.0%') })
  })
  it('compares like with like: a carport outline is not a footprint, so it is skipped', () => {
    expect(scheduleReconciles(takeoff(), { ...ctx, schedule: [{ label: 'PROPOSED CARPORT AREAS', m2: 38, file: 'plans.pdf', page: 1 }] })).toMatchObject({ result: 'skipped' })
  })
  it('is skipped while plane areas are missing', () => {
    expect(scheduleReconciles(takeoff({}, [plane({ plan_area_m2: null })]), footprint(80))).toMatchObject({ result: 'skipped', detail: expect.stringContaining('incomplete') })
  })
})

describe('C4 pitch plausible', () => {
  it("passes at the profile's minimum", () => {
    expect(pitchPlausible(takeoff())).toMatchObject({ result: 'pass' })
  })
  it.each([
    ["under the profile's minimum", plane({ pitch_deg: 3 }), 'Custom Orb at 3° is under its 5° minimum'],
    ['outside 1° to 45°', plane({ pitch_deg: 50, profile: 'Klip-Lok' }), 'outside 1° to 45°'],
  ])('fails %s', (_label, p, detail) => {
    expect(pitchPlausible(takeoff({}, [p]))).toMatchObject({ result: 'fail', detail: expect.stringContaining(detail) })
  })
})

describe('C5 complete', () => {
  it('passes when every plane has an area, pitch and profile', () => {
    expect(complete(takeoff())).toMatchObject({ result: 'pass' })
  })
  it('fails and says what is missing', () => {
    expect(complete(takeoff({}, [plane({ plan_area_m2: null, profile: null })]))).toMatchObject({ result: 'fail', detail: 'S1-P1 has no area and profile.' })
  })
})

describe('C6 exclusions applied', () => {
  const note = (scopeNote: string) => ({ scopeNote, schedule: [] })
  const whittaker = note('Roofing - Steel (Supply & Fit). Re-roof the existing house, and exclude the insulated roof over the new deck.')
  it("reads the scope note's exclusions", () => {
    expect(exclusionsAsked(whittaker.scopeNote)).toEqual(['and exclude the insulated roof over the new deck'])
    expect(exclusionsAsked('Gutters by others; the pergola is not included')).toEqual(['Gutters by others', 'the pergola is not included'])
    expect(exclusionsAsked('Roofing - Steel (Supply & Fit)')).toEqual([])
  })
  it('passes when each exclusion the note makes is matched to an excluded roof', () => {
    const withDeck = takeoff()
    withDeck.structures[0].exclusions = [{ label: 'Deck roof', reason: 'insulated panel, excluded by the scope', area_m2: null }]
    expect(exclusionsApplied(withDeck, whittaker)).toMatchObject({ result: 'pass', detail: 'Excluded from the totals: Deck roof.' })
  })
  it('fails when an exclusion the note makes matches no excluded roof', () => {
    expect(exclusionsApplied(takeoff(), note('exclude the pergola'))).toMatchObject({ result: 'fail', detail: expect.stringContaining('"exclude the pergola"') })
  })
  it('ignores site context the reading lists when the note excludes nothing', () => {
    const context = takeoff({ scope: { includes: [], excludes: ['EXISTING 2 STOREY DWELLING', 'Neighbouring dwelling'], questions: [] } })
    expect(exclusionsApplied(context, note('Roofing - Steel (Supply & Fit)'))).toEqual({ id: 'C6', result: 'pass', detail: 'The request lists no exclusions.' })
  })
})

describe('C7 confidence', () => {
  it('passes at medium or above', () => {
    expect(confidence(takeoff({}, [plane({ confidence: 'medium' })]))).toMatchObject({ result: 'pass' })
  })
  it('warns on a low-confidence plane', () => {
    expect(confidence(takeoff({}, [plane({ confidence: 'low' })]))).toMatchObject({ result: 'warning', detail: 'Low confidence: S1-P1.' })
  })
})

describe('C8 drawing status', () => {
  it('passes and names the issue', () => {
    expect(drawingStatus(takeoff())).toMatchObject({ result: 'pass', detail: 'The drawings are FOR CONSTRUCTION.' })
  })
  it('warns on preliminary sheets', () => {
    const t = takeoff({ sheets: [sheet({ number: 'A104', status_text: 'PRELIMINARY 21.04.26' }), sheet({ number: 'A302', page: 2, status_text: 'PRELIMINARY 21.04.26' })] })
    expect(drawingStatus(t)).toMatchObject({ result: 'warning', detail: 'A104 and A302 marked PRELIMINARY 21.04.26. Confirm the current revision with the builder.' })
  })
})

describe('C9 structure count', () => {
  const staged = takeoff({ sheets: [sheet({ title: 'SITE PLAN STAGE 1 - PROPOSED' }), sheet({ page: 2, title: 'SITE PLAN STAGE 2 - PROPOSED' })] })
  it('passes when the request leaves nothing open', () => {
    expect(structureCount(takeoff(), ctx)).toMatchObject({ result: 'pass', detail: '1 roof read.' })
    expect(structureCount(staged, { ...ctx, scopeNote: 'Stage 1 only' })).toMatchObject({ result: 'pass' })
  })
  it("warns when the drawings have stages the request doesn't choose between", () => {
    expect(structureCount(staged, ctx)).toMatchObject({ result: 'warning', detail: expect.stringContaining("over 2 stages, and the request doesn't say") })
  })
  it('warns when no roof was read', () => {
    expect(structureCount(takeoff({}, []), ctx)).toMatchObject({ result: 'warning' })
  })
})

describe('runChecks', () => {
  it('is ready when C1 to C6 pass or are skipped, whatever C7 to C9 say', () => {
    const t = takeoff({ sheets: [sheet({ status_text: 'PRELIMINARY' })] }, [plane({ confidence: 'low' })])
    const checks = runChecks(t, ctx, new Date('2026-11-02T00:00:00.000Z'))
    expect(checks).toMatchObject({ version: 1, ran_at: '2026-11-02T00:00:00.000Z', status: 'ready' })
    expect(checks.results.map((r) => `${r.id} ${r.result}`)).toEqual([
      'C1 pass', 'C2 pass', 'C3 skipped', 'C4 pass', 'C5 pass', 'C6 pass', 'C7 warning', 'C8 warning', 'C9 pass', 'C10 skipped',
    ])
  })
  it('needs review when one of C1 to C6 fails', () => {
    expect(runChecks(takeoff({}, [plane({ pitch_deg: null })]), ctx).status).toBe('needs_review')
  })
})

describe('areaSchedule', () => {
  const run = (x: number, y: number, size: number, text: string): TextRun => ({ x, x2: x + text.length * size * 0.55, y, size, text })
  const page = (...runs: TextRun[]): PageText => ({ width: 2384, height: 1684, chars: 400, runs })

  it("reads each line's label and area, joining a label that wraps", () => {
    const lines = areaSchedule(page(
      run(1900, 930, 20, 'STAGE 2 AREA SCHEDULE'),
      run(1720, 970, 20, 'SITE AREA'), run(2148, 970, 20, '607M'), run(2190, 963, 13, '2'),
      run(1720, 1103, 20, 'PROPOSED DUAL OCCUPANCY'), run(2148, 1106, 20, '233M'),
      run(1720, 1125, 20, 'FOOTPRINT'),
      run(1720, 1170, 20, 'PROPOSED HOUSES GFA'), run(2100, 1169, 20, '188M'), run(2160, 1169, 20, 'x 2 = 376M'),
    ), 'plans.pdf', 1)
    expect(lines.map((l) => [l.label, l.m2])).toEqual([
      ['SITE AREA', 607], ['PROPOSED DUAL OCCUPANCY FOOTPRINT', 233], ['PROPOSED HOUSES GFA', 188],
    ])
  })

  it('finds nothing on a sheet without a schedule', () => {
    expect(areaSchedule(page(run(100, 100, 12, 'ROOF PLAN')), 'plans.pdf', 1)).toEqual([])
  })
})
