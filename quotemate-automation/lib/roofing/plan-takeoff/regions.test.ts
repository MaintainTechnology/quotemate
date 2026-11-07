// TKO-30's lower roofs (DEC-047): rib-filled regions found on a roof plan,
// numbered on the sheet, assigned by the model and measured by the drawing.
// Each drawing is made up for its rule, 50 mm a point, the page's y growing
// downwards (south).

import { PDFDocument } from 'pdf-lib'
import { describe, expect, it, vi } from 'vitest'
import type { generateText } from 'ai'
import type { Segment } from './calibrate'
import { measureRegions, numberedPlan, placeRegions, ribRegions } from './regions'
import type { RoofPlanTakeoff } from './schema'

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

const plane = (id: string, area: number | null) => ({
  id, plan_dims_mm: null, polygon_mm: null, plan_area_m2: area, pitch_deg: area === null ? null : 25, pitch_source: null, fall: null,
  profile: null, finish_tag: null, sloped_area_m2: null, confidence: 'medium' as const, evidence: [{ file: 'plans.pdf', page: 1, text: 'ROOF PLAN', bbox: null }],
})
const TAKEOFF: RoofPlanTakeoff = {
  version: 1,
  scale: { stated: '1:100', sheet_size: 'A3', pdf_page: [1190, 842], calibration: { method: 'dimension_string', reference_mm: null, factor: F, delta_pct: 0 } },
  sheets: [],
  structures: [{
    id: 'S1', label: 'Existing house', role: 'primary', source: 'plans',
    planes: [plane('S1-P1', 40)],
    edges: [{ type: 'eave', length_m: 40, source: 'measured', confidence: 'medium' }],
    exclusions: [{ label: 'Roof over the new deck', reason: 'left out by the scope note', area_m2: null }],
  }],
  scope: { questions: [], notes: [] },
} as unknown as RoofPlanTakeoff
const REGIONS = ribRegions(DRAWING, [HOUSE]) // 1 the deck, 2 the lean-to
const place = (reply: unknown, over: Partial<Parameters<typeof placeRegions>[1]> = {}) => placeRegions(TAKEOFF, {
  regions: REGIONS, reply, eligible: ['S1'], houses: [HOUSE], factor: F, pitch: 5, sheet: { file: 'plans.pdf', page: 1 }, ...over,
})
const GOOD = { areas: [{ n: 1, roof: null, fall: 'north' }, { n: 2, roof: 'S1', fall: 'west' }], left_out: [{ label: 'Roof over the new deck', areas: [1] }] }

describe('placeRegions', () => {
  it("gives a roof each area assigned to it, at the elevation's shallow pitch, with its edges classed by its fall", () => {
    const { takeoff, regioned, refused } = place(GOOD)
    expect([regioned, refused]).toEqual([1, null])
    const [s1] = takeoff.structures
    expect(s1.planes.map((p) => [p.id, p.plan_area_m2, p.pitch_deg, p.fall, p.confidence])).toEqual([['S1-P1', 40, 25, null, 'medium'], ['S1-P2', 14.3, 5, 'west', 'medium']])
    expect(s1.planes[1].pitch_source).toBe('elevation')
    // Its eave on the west, its apron at the house, its barges along the fall.
    const added = s1.edges.slice(1).map((e) => [e.type, e.length_m]).sort()
    expect(added).toEqual([['apron', 5], ['barge', 2.871], ['barge', 2.871], ['eave', 5]])
  })

  it('measures nothing for an area the job leaves out, even assigned to a roof', () => {
    const reply = { ...GOOD, areas: [{ n: 1, roof: 'S1', fall: 'north' }, { n: 2, roof: 'S1', fall: 'west' }] }
    expect(place(reply).takeoff.structures[0].planes.map((p) => p.plan_area_m2)).toEqual([40, 14.3])
  })

  it('measures nothing when a left-out item is not found among the areas, as it could be in one assigned', () => {
    expect(place({ ...GOOD, left_out: [] })).toMatchObject({ regioned: 0, refused: expect.stringContaining('Roof over the new deck') })
  })

  it('measures nothing for a fall across its ribs, an area given twice, or a roof the reading did not leave unsized', () => {
    const across = { ...GOOD, areas: [GOOD.areas[0], { n: 2, roof: 'S1', fall: 'north' }] }
    const twice = { ...GOOD, areas: [...GOOD.areas, { n: 2, roof: 'S1', fall: 'west' }] }
    expect([across, twice].map((reply) => place(reply).regioned)).toEqual([0, 0])
    expect(place(GOOD, { eligible: [] }).regioned).toBe(0)
  })

  it("refuses a reply that isn't one", () => {
    expect(place('nonsense')).toMatchObject({ regioned: 0, refused: expect.stringContaining('could not be used') })
  })
})

describe('numberedPlan', () => {
  it('draws each region its number on a copy of the page', async () => {
    const doc = await PDFDocument.create()
    doc.addPage([400, 400])
    const numbered = await numberedPlan(await doc.save(), 1, [1, 0, 0, -1, 0, 400], REGIONS)
    const { getDocumentProxy } = await import('unpdf')
    const pdf = await getDocumentProxy(numbered)
    const text = (await (await pdf.getPage(1)).getTextContent()).items.map((i) => ('str' in i ? i.str : '')).join(' ')
    expect([pdf.numPages, text]).toEqual([1, '1 2'])
  })
})

describe('measureRegions', () => {
  const sheet = { file: 'plans.pdf', page: 1, text: { width: 400, height: 400, chars: 100, runs: [] }, segments: DRAWING, factor: F, transform: [1, 0, 0, -1, 0, 400] }
  const reading = { ...TAKEOFF, structures: [{ ...TAKEOFF.structures[0], planes: [plane('S1-P1', null)] }] } as RoofPlanTakeoff
  // The house measured by hips.ts, the lean-to still to find.
  const measured = { ...TAKEOFF, structures: [{ ...TAKEOFF.structures[0], planes: [plane('S1-P1', 40), plane('S1-P2', null)] }] } as RoofPlanTakeoff

  it('asks the model to assign the numbered areas, and measures what it assigns', async () => {
    const bytes = await (async () => { const d = await PDFDocument.create(); d.addPage([400, 400]); return d.save() })()
    const generate = vi.fn().mockResolvedValue({ text: JSON.stringify(GOOD), finishReason: 'stop', usage: { inputTokens: 2600, outputTokens: 250 } }) as unknown as typeof generateText
    const result = await measureRegions(measured, { reading, sheets: [{ ...sheet, bytes }], scopeNote: 'Re-roof the house; leave out the deck roof.', pitch: 5, generate })
    expect([result.regioned, result.usage]).toEqual([1, { inputTokens: 2600, outputTokens: 250, calls: 1 }])
    expect(result.takeoff.structures[0].planes.map((p) => p.plan_area_m2)).toEqual([40, 14.3])
    const [{ messages }] = vi.mocked(generate).mock.calls[0] as unknown as [{ messages: Array<{ content: unknown }> }]
    expect(JSON.stringify(messages)).toContain('Roof over the new deck')
    // Each area's ribs allow two falls, which the prompt names.
    expect(JSON.stringify(messages)).toContain('1: falls north or south')
    expect(JSON.stringify(messages)).toContain('2: falls east or west')
  })

  it('makes no call when every plane is sized', async () => {
    const generate = vi.fn() as unknown as typeof generateText
    const result = await measureRegions(TAKEOFF, { reading, sheets: [{ ...sheet, bytes: new Uint8Array() }], scopeNote: null, pitch: 5, generate })
    expect([result.regioned, result.usage, vi.mocked(generate).mock.calls.length]).toEqual([0, null, 0])
  })
})
