// A skillion's edges, worked out from its plane (TKO-15, DEC-040): its eave
// and high side across its width, and its sides down its run along the roof at
// its pitch (DEC-039), with the reader's own types kept.

import { describe, expect, it } from 'vitest'
import { skillionEdges } from './edges'
import type { RoofPlanTakeoff } from './schema'

type Structure = RoofPlanTakeoff['structures'][number]
type Edge = Structure['edges'][number]
const edge = (type: Edge['type'], length_m: number | null = null): Edge => ({ type, length_m, source: 'measured', confidence: 'high' })
const roof = (dims: [number, number] | null, pitch: number | null, edges: Edge[], planes = 1): Structure => ({
  id: 'S1', label: 'House', role: 'primary', source: 'plans', exclusions: [], edges,
  planes: Array.from({ length: planes }, (_, i) => ({
    id: `S1-P${i + 1}`, plan_dims_mm: dims, polygon_mm: null, plan_area_m2: dims ? (dims[0] * dims[1]) / 1e6 : null,
    pitch_deg: pitch, pitch_source: 'note' as const, fall: 'south', profile: 'Custom Orb', finish_tag: null,
    sloped_area_m2: null, confidence: 'high' as const, evidence: [],
  })),
})
const takeoff = (...structures: Structure[]): RoofPlanTakeoff => ({
  version: 1,
  scale: { stated: '1:100', sheet_size: 'A1', pdf_page: [2384, 1684], calibration: { method: 'none', reference_mm: null, factor: null, delta_pct: null } },
  sheets: [],
  structures,
  scope: { includes: [], excludes: [], questions: [] },
})
const lengths = (s: Structure) => s.edges.map((e) => `${e.type} ${e.length_m}`)

describe('skillionEdges', () => {
  it("puts the eave and high side across the plane's width, and its sides down its run along the roof", () => {
    // Read at right angles, as Grange's live reading read House 1.
    const read = [edge('high_side', 9.6), edge('eave', 9.6), edge('barge', 10.13), edge('barge', 10.13)]
    const { takeoff: t, derived } = skillionEdges(takeoff(roof([10130, 9600], 5, read)))
    expect(derived).toBe(1)
    expect(lengths(t.structures[0])).toEqual(['eave 10.13', 'high_side 10.13', 'barge 9.637', 'barge 9.637'])
    expect(t.structures[0].edges[0]).toMatchObject({ source: 'derived', confidence: 'high' })
  })

  it("keeps the reader's types: an apron for a side or a top against a wall, a box gutter for an eave", () => {
    const bay = skillionEdges(takeoff(roof([3220, 5599], 3, [edge('eave'), edge('high_side'), edge('apron'), edge('barge')]))).takeoff
    expect(lengths(bay.structures[0])).toEqual(['eave 3.22', 'high_side 3.22', 'apron 5.607', 'barge 5.607'])
    const leanTo = skillionEdges(takeoff(roof([6000, 2400], 5, [edge('box_gutter'), edge('apron'), edge('barge'), edge('barge')]))).takeoff
    expect(lengths(leanTo.structures[0])).toEqual(['box_gutter 6', 'apron 6', 'barge 2.409', 'barge 2.409'])
  })

  it('gives a skillion read without edges an eave, a high side and two barges', () => {
    const bay = skillionEdges(takeoff(roof([3219, 5599], 3, []))).takeoff
    expect(lengths(bay.structures[0])).toEqual(['eave 3.219', 'high_side 3.219', 'barge 5.607', 'barge 5.607'])
  })

  it('leaves alone a roof of several planes, a plane with no size, and a plane with no pitch', () => {
    const read = [edge('eave', 4), edge('ridge', 4)]
    for (const s of [roof([4000, 3000], 20, read, 2), roof(null, 5, read), roof([4000, 3000], null, read)]) {
      const { takeoff: t, derived } = skillionEdges(takeoff(s))
      expect([derived, lengths(t.structures[0])]).toEqual([0, ['eave 4', 'ridge 4']])
    }
  })
})
