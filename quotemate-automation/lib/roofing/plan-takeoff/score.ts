// Scores a takeoff against its hand-measured reference (TKO-15) on the four
// P2 gates. A reading can split or merge roofs (Grange's carport is two bays,
// or one), so roofs pair only when the counts match, and then for area alone;
// the other gates score the whole job. Pure, so the eval script and the tests
// share it.

import type { RoofPlanTakeoff } from './schema'

export const GATES = { areaPct: 3, pitchDeg: 2, edgePct: 5 } as const

export type Gate = { pass: boolean; detail: string }
export type Score = { pass: boolean; structures: Gate; area: Gate; pitch: Gate; edges: Gate }

type Takeoff = RoofPlanTakeoff
const planesOf = (t: Takeoff) => t.structures.flatMap((s) => s.planes)
const round = (n: number) => Math.round(n * 100) / 100
const off = (actual: number, expected: number) =>
  expected === 0 ? (actual === 0 ? 0 : Infinity) : Math.abs(actual / expected - 1) * 100

/** Structure count: roofs with planes, exactly. */
function structures(expected: Takeoff, actual: Takeoff): Gate {
  const count = (t: Takeoff) => t.structures.filter((s) => s.planes.length).length
  const [e, a] = [count(expected), count(actual)]
  return { pass: a === e, detail: `${a} roofs read, ${e} expected.` }
}

/** Plan area: the job's total within 3%, and, when the roof counts match, each
 *  roof within 3% of the one it pairs with, so one roof's shortfall can't hide
 *  another's excess. Roofs pair by size, largest with largest. A reading that
 *  splits or merges roofs is held to its total, as the structures gate already
 *  fails it. An unknown area fails it. */
function area(expected: Takeoff, actual: Takeoff): Gate {
  const sum = (planes: Takeoff['structures'][number]['planes']) => round(planes.reduce((s, p) => s + (p.plan_area_m2 ?? 0), 0))
  const unknown = planesOf(actual).filter((p) => p.plan_area_m2 === null).length
  if (unknown) return { pass: false, detail: `${unknown} plane${unknown === 1 ? ' has' : 's have'} no area, so the total is incomplete.` }
  const [e, a] = [sum(planesOf(expected)), sum(planesOf(actual))]
  const job = `${a} m² against ${e} m² (${off(a, e).toFixed(1)}%).`
  // ponytail: pairs by size order, the natural pairing while roofs differ in size; pair by position if two references ever hold same-size roofs read differently
  const roofs = (t: Takeoff) => t.structures.filter((s) => s.planes.length)
    .map((s) => ({ label: s.label, m2: sum(s.planes) }))
    .sort((x, y) => y.m2 - x.m2)
  const [want, got] = [roofs(expected), roofs(actual)]
  const misses = want.length !== got.length ? [] : got.flatMap((roof, i) => off(roof.m2, want[i].m2) <= GATES.areaPct
    ? []
    : [`${roof.label} ${roof.m2} m² against ${want[i].m2} m² (${off(roof.m2, want[i].m2).toFixed(1)}%)`])
  return { pass: off(a, e) <= GATES.areaPct && !misses.length, detail: misses.length ? `${job} By roof: ${misses.join('; ')}.` : job }
}

/** Pitch: every pitch in the reference has one within 2° in the reading, and
 *  the other way round. An unknown pitch fails it. */
function pitch(expected: Takeoff, actual: Takeoff): Gate {
  const pitches = (t: Takeoff) => [...new Set(planesOf(t).map((p) => p.pitch_deg))]
  const [e, a] = [pitches(expected) as number[], pitches(actual)]
  if (a.includes(null)) return { pass: false, detail: 'A plane has no pitch.' }
  const near = (x: number, among: number[]) => among.some((y) => Math.abs(x - y) <= GATES.pitchDeg)
  const read = a as number[]
  const pass = e.every((x) => near(x, read)) && read.every((x) => near(x, e))
  return { pass, detail: `${read.join('°, ')}° read, ${e.join('°, ')}° expected.` }
}

/** Edges: each edge type's total length within 5%. A type on one side only,
 *  or an unknown length, fails it. */
function edges(expected: Takeoff, actual: Takeoff): Gate {
  const totals = (t: Takeoff) => {
    const sums = new Map<string, number | null>()
    for (const edge of t.structures.flatMap((s) => s.edges)) {
      const before = sums.get(edge.type)
      sums.set(edge.type, before === null || edge.length_m === null ? null : (before ?? 0) + edge.length_m)
    }
    return sums
  }
  const [e, a] = [totals(expected), totals(actual)]
  // A type a side doesn't have totals 0; an unknown length stays null.
  const total = (sums: Map<string, number | null>, type: string) => (sums.has(type) ? sums.get(type) ?? null : 0)
  const misses = [...new Set([...e.keys(), ...a.keys()])].flatMap((type) => {
    const [want, got] = [total(e, type), total(a, type)]
    if (got === null) return [`${type} has an unknown length`]
    if (want === null || off(got, want) <= GATES.edgePct) return []
    return [`${type} ${round(got)} m against ${round(want)} m`]
  })
  return { pass: !misses.length, detail: misses.length ? `${misses.join('; ')}.` : 'Every edge type within 5%.' }
}

export function scoreTakeoff(expected: Takeoff, actual: Takeoff): Score {
  const gates = {
    structures: structures(expected, actual),
    area: area(expected, actual),
    pitch: pitch(expected, actual),
    edges: edges(expected, actual),
  }
  return { pass: Object.values(gates).every((g) => g.pass), ...gates }
}
