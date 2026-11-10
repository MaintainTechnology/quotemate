// TKO-30's lower roofs (DEC-047, DEC-048): rib-filled areas found on a roof
// plan and numbered on the sheet; the reader suggests which roof each is, and
// the drawing measures what the operator confirms. Each drawing is made up
// for its rule, 50 mm a point, the page's y growing downwards (south).

import { readFileSync } from 'node:fs'
import type { generateText } from 'ai'
import { PDFDocument } from 'pdf-lib'
import { describe, expect, it, vi } from 'vitest'
import type { Segment } from './calibrate'
import {
  assignRegions,
  findRegions,
  numberedPlan,
  placeRegions,
  regionsPlan,
  ribRegions,
  suggestRegions,
  type RegionAnswer,
  type RunRegions,
} from './regions'
import { regionsPlanPath } from './runs'
import { RoofPlanTakeoffSchema, type RoofPlanTakeoff } from './schema'
import { fakeDb } from './test-db'

type P = [number, number]
const F = 50 // mm a point
const lines = (pts: P[]): Segment[] => pts.map((a, i) => { const b = pts[(i + 1) % pts.length]; return [a[0], a[1], b[0], b[1]] })
/** A hip or ridge as drawn: its centre line and a band stroke each side, as hips.test.ts draws them. */
function banded(a: P, b: P): Segment[] {
  const [dx, dy] = [b[0] - a[0], b[1] - a[1]]
  const length = Math.hypot(dx, dy)
  const [ux, uy] = [dx / length, dy / length]
  const [nx, ny] = [-uy * 2.9, ux * 2.9]
  const side = (s: number): Segment => [a[0] + 3 * ux + s * nx, a[1] + 3 * uy + s * ny, b[0] - 3 * ux + s * nx, b[1] - 3 * uy + s * ny]
  return [[a[0], a[1], b[0], b[1]], side(1), side(-1)]
}
// The house: a hip roof 200 by 160 points, its hips meeting a ridge, each eave
// a gutter with its outer line 2.8 points out. Its faces are measured already.
const HOUSE: P[] = [[100, 100], [300, 100], [300, 260], [100, 260]]
const HIP_ROOF: Segment[] = [
  ...banded([100, 100], [180, 180]), ...banded([100, 260], [180, 180]), ...banded([300, 100], [220, 180]), ...banded([300, 260], [220, 180]), ...banded([180, 180], [220, 180]),
  ...lines(HOUSE), ...lines([[97.2, 97.2], [302.8, 97.2], [302.8, 262.8], [97.2, 262.8]]),
]
/** Ribs 3.2 points apart across [from, to], the first 2 points in, so the walk
 *  can take an edge line in as a rib, as on a real plan; each runs along the
 *  other axis over [lo, hi]. */
const ribs = (axis: 'v' | 'h', from: number, to: number, lo: number, hi: number): Segment[] => {
  const out: Segment[] = []
  for (let o = from + 2; o < to - 0.5; o += 3.2) out.push(axis === 'v' ? [o, lo, o, hi] : [lo, o, hi, o])
  return out
}
// A lean-to on the west wall, falling west: ribs from its eave at x 40 to the
// house's outer gutter line at x 97.2, between barges at y 140 and 240.
const LEAN_TO: Segment[] = [...lines([[40, 140], [97.2, 140], [97.2, 240], [40, 240]]), ...ribs('h', 140, 240, 40, 97.2)]
// A deck roof on the north wall, falling north, which the job leaves out.
const DECK: Segment[] = [...lines([[100, 40], [300, 40], [300, 97.2], [100, 97.2]]), ...ribs('v', 100, 300, 40, 97.2)]
// Hatching far from any roof, and the house's own sheeting inside its outline.
const HATCH: Segment[] = [...lines([[700, 450], [760, 450], [760, 490], [700, 490]]), ...ribs('h', 450, 490, 700, 760)]
const OWN: Segment[] = ribs('v', 120, 160, 104, 116)
const DRAWING: Segment[] = [...HIP_ROOF, ...LEAN_TO, ...DECK, ...HATCH, ...OWN]
const m2 = (polygon: P[]) => (Math.abs(polygon.reduce((s, [x, y], i) => { const [nx, ny] = polygon[(i + 1) % polygon.length]; return s + x * ny - nx * y }, 0)) / 2) * F * F / 1e6

describe('ribRegions', () => {
  it('finds each area of ribs joined to the house, but not the house itself or hatching elsewhere', () => {
    const regions = ribRegions(DRAWING, [HOUSE])
    expect(regions.map((r) => [r.axis, Math.round(m2(r.polygon) * 10) / 10])).toEqual([['v', 28.6], ['h', 14.3]])
  })
})

// A valid takeoff, Grange's hand-measured one with its roofs swapped for the
// test house: one plane read at 40 m², an eave, and a high side read without
// a length.
const GRANGE = RoofPlanTakeoffSchema.parse(JSON.parse(readFileSync('eval/roof-takeoff/grange/takeoff.json', 'utf8')))
const plane = (id: string, area: number | null) => ({
  id, plan_dims_mm: null, polygon_mm: null, plan_area_m2: area, pitch_deg: area === null ? null : 25, pitch_source: area === null ? null : 'elevation' as const,
  fall: null, profile: null, finish_tag: null, sloped_area_m2: null, confidence: 'medium' as const, evidence: [{ file: 'plans.pdf', page: 1, text: 'ROOF PLAN', bbox: null }],
})
const house = (planes: ReturnType<typeof plane>[], extra: Record<string, unknown> = {}) => ({
  id: 'S1', label: 'Existing house', role: 'primary' as const, source: 'plans' as const, planes,
  edges: [{ type: 'eave' as const, length_m: 40, source: 'measured' as const, confidence: 'medium' as const }, { type: 'high_side' as const, length_m: null, source: 'measured' as const, confidence: 'low' as const }],
  exclusions: [{ label: 'Roof over the new deck', reason: 'left out by the scope note', area_m2: null }],
  ...extra,
})
const TAKEOFF: RoofPlanTakeoff = RoofPlanTakeoffSchema.parse({ ...GRANGE, structures: [house([plane('S1-P1', 40)])] })
const AREAS = ribRegions(DRAWING, [HOUSE]) // 1 the deck, 2 the lean-to
const REGIONS: RunRegions = {
  sheet: { file: 'plans.pdf', page: 1 },
  factor: F,
  pitch: 5,
  houses: [HOUSE],
  areas: AREAS,
  roofs: [{ id: 'S1', label: 'Existing house' }],
  suggested: null,
  note: null,
  confirmed: null,
  before: null,
}
const GOOD: RegionAnswer[] = [{ n: 1, roof: null, fall: null }, { n: 2, roof: 'S1', fall: 'west' }]

describe('placeRegions', () => {
  it("gives a roof each area the operator assigns, at the elevation's shallow pitch, in its hip roof's frame, its edges classed by its fall", () => {
    const placed = placeRegions(TAKEOFF, REGIONS, GOOD)
    expect(placed).toMatchObject({ ok: true, placed: 1 })
    if (!placed.ok) return
    const [s1] = placed.takeoff.structures
    expect(s1.planes.map((p) => [p.id, p.plan_area_m2, p.pitch_deg, p.pitch_source, p.fall, p.confidence])).toEqual([
      ['S1-P1', 40, 25, 'elevation', null, 'medium'],
      ['S1-P2', 14.3, 5, 'elevation', 'west', 'medium'],
    ])
    // The house's frame, as hips.ts draws its faces: x east of its west eave,
    // y north of its south eave, so the pack draws the lean-to beside them.
    const outline = s1.planes[1].polygon_mm!
    expect([Math.min(...outline.map((p) => p[0])), Math.max(...outline.map((p) => p[0])), Math.min(...outline.map((p) => p[1])), Math.max(...outline.map((p) => p[1]))])
      .toEqual([-3000, -140, 1000, 6000])
    // Its eave on the west, its apron at the house, its barges along the fall.
    expect(s1.edges.slice(1).map((e) => [e.type, e.length_m]).sort()).toEqual([['apron', 5], ['barge', 2.871], ['barge', 2.871], ['eave', 5]])
    // The reading's high side without a length is the apron the drawing measured.
    expect(s1.edges.some((e) => e.type === 'high_side')).toBe(false)
  })

  it('measures nothing when every area is left out of the job', () => {
    expect(placeRegions(TAKEOFF, REGIONS, [{ n: 1, roof: null, fall: null }, { n: 2, roof: null, fall: null }])).toEqual({ ok: true, takeoff: TAKEOFF, placed: 0 })
  })

  it.each([
    ['leaves a number out', [GOOD[1]], 'Area 1'],
    ['gives a number twice', [...GOOD, GOOD[1]], 'Area 2'],
    ['names a number the plan does not draw', [...GOOD, { n: 3, roof: 'S1', fall: 'west' }], 'Area 3'],
    ['gives an area a fall across its sheeting', [GOOD[0], { n: 2, roof: 'S1', fall: 'north' }], 'east or west'],
    ['gives an area of the job no fall', [GOOD[0], { n: 2, roof: 'S1', fall: null }], 'east or west'],
    ['names a roof the drawings sized or the takeoff lacks', [GOOD[0], { n: 2, roof: 'S9', fall: 'west' }], 'S9'],
  ])('refuses an answer that %s, naming the problem', (_, answer, says) => {
    const placed = placeRegions(TAKEOFF, REGIONS, answer as RegionAnswer[])
    expect(placed.ok).toBe(false)
    if (!placed.ok) expect(placed.problems.join(' ')).toContain(says)
  })

  it('gives a roof measured from aerial data no area from the plan', () => {
    const hybrid = RoofPlanTakeoffSchema.parse({ ...TAKEOFF, structures: [house([plane('S1-P1', 40)], { source: 'hybrid' })] })
    const placed = placeRegions(hybrid, REGIONS, GOOD)
    expect(placed.ok).toBe(false)
    if (!placed.ok) expect(placed.problems.join(' ')).toContain('aerial')
  })
})

const SHEET = { file: 'plans.pdf', page: 1, text: { width: 800, height: 600, chars: 100, runs: [] }, segments: DRAWING, factor: F, transform: [1, 0, 0, -1, 0, 600], bytes: new Uint8Array() }
// The reading before the drawing measured anything: the house unsized.
const READING: RoofPlanTakeoff = RoofPlanTakeoffSchema.parse({ ...TAKEOFF, structures: [house([plane('S1-P1', null)])] })

describe('findRegions', () => {
  it('finds the rib areas joined to the hip roof on the sheet the unsized roofs cite, with those roofs', () => {
    const found = findRegions(READING, [SHEET])
    expect(found && [found.areas.length, found.roofs, found.sheet.file, found.houses.length]).toEqual([2, [{ id: 'S1', label: 'Existing house' }], 'plans.pdf', 1])
  })

  it('finds nothing when the reading sized every roof, or no unsized roof cites the sheet', () => {
    expect(findRegions(TAKEOFF, [SHEET])).toBeNull()
    expect(findRegions(READING, [{ ...SHEET, page: 2 }])).toBeNull()
  })
})

const answering = (reply: unknown) => vi.fn().mockResolvedValue({
  text: typeof reply === 'string' ? reply : JSON.stringify(reply), finishReason: 'stop', usage: { inputTokens: 2600, outputTokens: 250 },
}) as unknown as typeof generateText

describe('suggestRegions', () => {
  const REPLY = {
    areas: [{ n: 1, rooms: [], covers: 'Deck', roof: null, fall: 'north' }, { n: 2, rooms: ['Laundry'], covers: 'Laundry lean-to', roof: 'S1', fall: 'west' }],
    left_out: [{ label: 'Roof over the new deck', areas: [1] }],
  }
  const plan = new Uint8Array([37, 80, 68, 70])

  it("asks the reader which roof each number is, naming each area's two falls and what the job leaves out, and suggests its answer", async () => {
    const generate = answering(REPLY)
    await expect(suggestRegions(REGIONS, { takeoff: TAKEOFF, plan, scopeNote: 'Re-roof the house; leave out the deck roof.', generate })).resolves.toEqual({
      suggested: [{ n: 1, roof: null, fall: 'north', covers: 'Deck' }, { n: 2, roof: 'S1', fall: 'west', covers: 'Laundry lean-to' }],
      note: null,
      usage: { inputTokens: 2600, outputTokens: 250, calls: 1 },
    })
    const asked = JSON.stringify(vi.mocked(generate).mock.calls[0])
    expect(asked).toContain('Roof over the new deck')
    expect(asked).toContain('1: falls north or south')
    expect(asked).toContain('2: falls east or west')
  })

  it("suggests no roof the drawings sized and no fall across the sheeting, and takes a left-out area out of the job", async () => {
    const reply = { areas: [{ n: 1, roof: 'S1', fall: 'east' }, { n: 2, roof: 'S9', fall: 'west' }], left_out: [{ label: 'Roof over the new deck', areas: [1] }] }
    const { suggested } = await suggestRegions(REGIONS, { takeoff: TAKEOFF, plan, scopeNote: null, generate: answering(reply) })
    expect(suggested).toEqual([{ n: 1, roof: null, fall: null, covers: null }])
  })

  it("keeps no suggestion from a reply that isn't one, and says why", async () => {
    await expect(suggestRegions(REGIONS, { takeoff: TAKEOFF, plan, scopeNote: null, generate: answering('not json') })).resolves.toEqual({
      suggested: null,
      note: expect.stringContaining('suggestion'),
      usage: { inputTokens: 2600, outputTokens: 250, calls: 1 },
    })
  })
})

describe('numberedPlan', () => {
  it('draws each area its number on a copy of the page', async () => {
    const doc = await PDFDocument.create()
    doc.addPage([400, 400])
    const numbered = await numberedPlan(await doc.save(), 1, [1, 0, 0, -1, 0, 400], AREAS)
    const { getDocumentProxy } = await import('unpdf')
    const pdf = await getDocumentProxy(numbered)
    const text = (await (await pdf.getPage(1)).getTextContent()).items.map((i) => ('str' in i ? i.str : '')).join(' ')
    expect([pdf.numPages, text]).toEqual([1, '1 2'])
  })
})

describe('assignRegions', () => {
  const NOW = new Date('2026-11-08T10:00:00.000Z')
  const seed = (regions: RunRegions | null = REGIONS, status = 'needs_review') => fakeDb({
    runs: [{ id: 'r1', tenant_id: 't1', status, scope_note: null, checks: { schedule: [] }, latest_extraction_id: 'x1', regions }],
    extractions: [{ id: 'x1', tenant_id: 't1', takeoff_run_id: 'r1', items: TAKEOFF, corrected_items: null }],
  })
  const assign = (fake: ReturnType<typeof fakeDb>, areas: unknown, tenantId = 't1') => assignRegions(fake.db, { tenantId, runId: 'r1', areas, now: NOW })
  const corrected = (fake: ReturnType<typeof fakeDb>) => (fake.tables.plan_extractions[0].corrected_items as RoofPlanTakeoff | null)?.structures[0].planes.map((p) => p.plan_area_m2)

  it("measures the areas the operator confirms as the run's correction, and the checks run again", async () => {
    const fake = seed()
    await expect(assign(fake, GOOD)).resolves.toMatchObject({ ok: true, run_id: 'r1', checks: { status: expect.any(String) } })
    expect(corrected(fake)).toEqual([40, 14.3])
    // The reading stays as the pipeline left it, beside the correction (DEC-019).
    expect(fake.tables.plan_extractions[0].items).toEqual(TAKEOFF)
    expect(fake.tables.roof_takeoff_runs[0].regions).toMatchObject({ confirmed: { areas: GOOD, at: NOW.toISOString() }, before: TAKEOFF })
  })

  it('measures a second answer from the takeoff before the first, so no area counts twice', async () => {
    const fake = seed()
    await assign(fake, GOOD)
    await assign(fake, GOOD)
    expect(corrected(fake)).toEqual([40, 14.3])
  })

  it("refuses an answer it can't place, and changes nothing", async () => {
    const fake = seed()
    await expect(assign(fake, [GOOD[1]])).resolves.toMatchObject({ ok: false, error: 'invalid_answer', problems: [expect.stringContaining('Area 1')] })
    await expect(assign(fake, 'nonsense')).resolves.toMatchObject({ ok: false, error: 'invalid_answer' })
    expect(corrected(fake)).toBeUndefined()
    expect(fake.tables.roof_takeoff_runs[0].regions).toEqual(REGIONS)
  })

  it("refuses a run with no numbered areas, a run still being read, and another tenant's run", async () => {
    await expect(assign(seed(null), GOOD)).resolves.toEqual({ ok: false, error: 'no_regions' })
    await expect(assign(seed(REGIONS, 'extracting'), GOOD)).resolves.toMatchObject({ ok: false, error: 'conflict_status', status: 'extracting' })
    await expect(assign(seed(), GOOD, 't2')).resolves.toEqual({ ok: false, error: 'not_found' })
  })
})

describe('regionsPlan', () => {
  it("gives the run's numbered plan, and nothing for a run without one or another tenant's run", async () => {
    const pdf = new Uint8Array([37, 80, 68, 70])
    const fake = fakeDb({
      runs: [{ id: 'r1', tenant_id: 't1', regions: REGIONS }, { id: 'r2', tenant_id: 't1', regions: null }],
      objects: { [regionsPlanPath('t1', 'r1')]: pdf },
    })
    const plan = (tenantId: string, runId: string) => regionsPlan(fake.db, 'plan-pdfs', { tenantId, runId })
    await expect(plan('t1', 'r1')).resolves.toEqual({ ok: true, pdf })
    await expect(plan('t1', 'r2')).resolves.toEqual({ ok: false, error: 'no_regions' })
    await expect(plan('t2', 'r1')).resolves.toEqual({ ok: false, error: 'not_found' })
  })
})
