// A skillion's edges, worked out from its plane (TKO-15, DEC-040). A roof of
// one rectangular plane falls one way, so its eave and high side run across
// its width, and its two sides down its run, along the roof at its pitch
// (DEC-039). The lengths come from the plane's size, so an edge can't disagree
// with the plane it bounds. The reader's own types stand: a box gutter for the
// eave, and an apron or parapet for a top or side against a wall.

import type { RoofPlanTakeoff } from './schema'

type Takeoff = RoofPlanTakeoff
type Structure = Takeoff['structures'][number]
type Edge = Structure['edges'][number]
type EdgeType = Edge['type']

/** The edge types a skillion's four sides can be; the reader's others stay. */
const SIDES: EdgeType[] = ['eave', 'box_gutter', 'high_side', 'apron', 'parapet', 'barge']
const round3 = (n: number) => Math.round(n * 1000) / 1000

/** Works out the edges of each roof of one plane with a size and a pitch. */
export function skillionEdges(takeoff: Takeoff): { takeoff: Takeoff; derived: number } {
  let derived = 0
  const structures = takeoff.structures.map((structure): Structure => {
    const [plane, ...others] = structure.planes
    if (!plane || others.length || !plane.plan_dims_mm || plane.pitch_deg === null) return structure
    const [width, run] = plane.plan_dims_mm.map((mm) => mm / 1000)
    const down = run / Math.cos((plane.pitch_deg * Math.PI) / 180)

    const read = structure.edges.map((e) => e.type)
    const eave: EdgeType = read.includes('box_gutter') && !read.includes('eave') ? 'box_gutter' : 'eave'
    const top: EdgeType = (['high_side', 'parapet', 'apron'] as const).find((t) => read.includes(t)) ?? 'high_side'
    const rest = [...read]
    if (rest.includes(top)) rest.splice(rest.indexOf(top), 1)
    const sides = rest.filter((t) => t === 'barge' || t === 'apron' || t === 'parapet').slice(0, 2)
    while (sides.length < 2) sides.push('barge')

    const made = (type: EdgeType, length: number): Edge => ({ type, length_m: round3(length), source: 'derived', confidence: plane.confidence })
    derived += 1
    return {
      ...structure,
      edges: [
        made(eave, width),
        made(top, width),
        ...sides.map((type) => made(type, down)),
        ...structure.edges.filter((e) => !SIDES.includes(e.type)),
      ],
    }
  })
  return { takeoff: { ...takeoff, structures }, derived }
}
