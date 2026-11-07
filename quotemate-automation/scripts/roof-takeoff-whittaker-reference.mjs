// Writes Whittaker's provisional hand-measured reference takeoff (TKO-00d,
// DEC-015) to eval/roof-takeoff/whittaker/takeoff.json: what a correct reading
// of the drawings gives, for the eval's gates (TKO-15). The plans are the
// client's and stay out of git, so each measurement is written here with where
// it came from, for anyone with the plan set to check.
//
// Measured on 6 November 2026:
// - Plan sizes off A104's roof plan, at its title block's 1:50 @ A1, printed
//   on A3: 35.3207 mm a point. No roof dimension is written. The deck's 6907 mm
//   bears the scale out to 0.08% (calibrate.fixtures.test.ts), but its digits
//   are drawn as outlines, so a run's scale rests on the title block and C1
//   fails, as Service Spec §12 expects. Each roof's edges are its vector lines:
//   the main roof's fascia, and the lower roofs' outlines where their ribs stop.
//   Points are millimetres in the sheet's frame, x east and y south.
// - Pitches off A302, none written: the main roof is drawn at 25.0° in all four
//   elevations (its 4232 mm slope is the plan's 3836 mm run at 25°), the laundry
//   roof and the entry skillions at 4.8°, the kitchen and sleepout roof at 4.9°.
// - The roof over the new deck (5917 × 7718 mm, 5° written) is excluded by the
//   scope note.
//
// Conventions (DEC-039): an area is on plan, as the roof plan draws it, so the
// lower roofs stop at the main roof's gutter line, though they run on under its
// eaves to the wall (about 290 mm, off the east elevation); a scope question
// asks how far. An edge's length is along the roof: a hip, valley or raking
// side is longer than it scales on plan, and a level edge is the same.
//
// Provisional until a roofer checks it (P2 Reading).
//
// Usage: node scripts/roof-takeoff-whittaker-reference.mjs

import { readFileSync, writeFileSync } from 'node:fs'

const PLAN = 'floor-plan.pdf'
const ELEVATIONS = 'elevations.pdf'
const MAIN = 25 // the main roof
const SOUTH = 4.9 // the kitchen and sleepout roof
const LOW = 4.8 // the laundry roof and the entry skillions

// The main roof: its fascia corners, its ridge, and its south-east wing's ridge.
const A = [5435, 1578] // north-west
const B = [13107, 1578] // north-east
const C = [13107, 5405] // where the wing's north eave meets the east eave
const D = [14946, 5405] // the wing's north-east
const E = [14946, 9898] // south-east
const F = [5435, 9898] // south-west
const P = [9271, 5414] // the ridge's north end
const Q = [9271, 6062] // the ridge's south end
const R = [10860, 7652] // the wing ridge's west end, at the head of the valley
const W = [12700, 7652] // the wing ridge's east end
// The kitchen and sleepout roof, falling south from the main roof's gutter line
// (y 10000) to eaves at y 13145 and, east of a step at x 9195, y 12352, with a
// hipped east end.
const G = [5338, 10000] // under the main roof's south-west corner
const H = [12590, 10000] // the head of the east end's hip
const T = [14946, 10000]
const I = [14946, 12352] // south-east
const J = [9195, 12352]
const K = [9195, 13145]
const L = [2193, 13145] // the foot of its hip with the laundry roof
// The new laundry and bathroom roof, falling west from the main roof's west
// gutter line (x 5338), its north side at the deck roof's edge (y 8135).
const M = [1777, 8135]
const N = [5338, 8135]
const O = [1777, 13145]
// The entry skillions in the main roof's north-east corner, between its east
// gutter line (x 13204) and the wing's north gutter line (y 5308): one falling
// north, one east, a hip between them.
const S1 = [13204, 1578]
const S2 = [14946, 1578]
const S3 = [14946, 5308]
const S4 = [13204, 5308]
const SH = [13204, 3151] // the head of their hip

const tan = (deg) => Math.tan((deg * Math.PI) / 180)
const cos = (deg) => Math.cos((deg * Math.PI) / 180)
const round = (n, places) => Math.round(n * 10 ** places) / 10 ** places
/** A level edge's length: an eave, ridge, or a high side along the wall. */
const level = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1])
/** A raking side's length: a barge, or an apron, running down a plane at `pitch`. */
const rake = (a, b, pitch) => level(a, b) / cos(pitch)
/** A hip's or valley's length between a plane falling east or west at `pitchX`
 *  and one falling north or south at `pitchY`: its rise is each plane's run
 *  along it at its pitch (their mean, where they differ by a few millimetres). */
const hip = (a, b, pitchX, pitchY = pitchX) => {
  const [dx, dy] = [Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1])]
  return Math.hypot(dx, dy, (dx * tan(pitchX) + dy * tan(pitchY)) / 2)
}
/** A polygon's area on plan, in m². */
const area = (points) => Math.abs(points.reduce((sum, [x, y], i) => {
  const [nx, ny] = points[(i + 1) % points.length]
  return sum + x * ny - nx * y
}, 0)) / 2 / 1e6
/** The plane's corners with north up, from just south-west of the roofs. */
const northUp = (points) => points.map(([x, y]) => [x - 1676, 13242 - y])

const PLAN_EVIDENCE = { file: PLAN, page: 1, text: 'A104 roof plan, scaled at 1:50 @ A1 printed on A3 (35.3207 mm a point); no roof dimension is written', bbox: null }
const plane = (id, points, pitch, fall, elevation) => {
  const plan = area(points)
  return {
    id,
    plan_dims_mm: null,
    polygon_mm: northUp(points),
    plan_area_m2: round(plan, 2),
    pitch_deg: pitch,
    pitch_source: 'elevation',
    fall,
    profile: 'MRS',
    finish_tag: null,
    sloped_area_m2: round(plan / cos(pitch), 2),
    confidence: 'medium',
    evidence: [PLAN_EVIDENCE, { file: ELEVATIONS, page: 1, text: elevation, bbox: null }],
  }
}
const edge = (type, lengthMm) => ({ type, length_m: round(lengthMm / 1000, 3), source: 'derived', confidence: 'medium' })

const mainPitch = `A302: the main roof drawn at ${MAIN}° in all four elevations`
const southPitch = `A302 east elevation: the kitchen and sleepout roof drawn at ${SOUTH}°`
const entryPitch = `A302 north elevation: the entry skillions drawn at ${LOW}°`
const house = {
  id: 'S1',
  label: 'Existing house, re-roof',
  role: 'primary',
  source: 'plans',
  planes: [
    plane('S1-P1', [A, B, P], MAIN, 'north', mainPitch),
    plane('S1-P2', [A, P, Q, F], MAIN, 'west', mainPitch),
    plane('S1-P3', [P, B, C, R, Q], MAIN, 'east', mainPitch),
    plane('S1-P4', [F, Q, R, W, E], MAIN, 'south', mainPitch),
    plane('S1-P5', [R, C, D, W], MAIN, 'north', mainPitch),
    plane('S1-P6', [D, E, W], MAIN, 'east', mainPitch),
    plane('S1-P7', [G, H, I, J, K, L], SOUTH, 'south', southPitch),
    plane('S1-P8', [H, T, I], SOUTH, 'east', southPitch),
    plane('S1-P9', [S1, S2, SH], LOW, 'north', entryPitch),
    plane('S1-P10', [SH, S2, S3, S4], LOW, 'east', entryPitch),
  ],
  edges: [
    // The main roof: its eaves on the fascia, its hips, valley and ridges.
    edge('eave', level(A, B)), edge('eave', level(B, C)), edge('eave', level(C, D)),
    edge('eave', level(D, E)), edge('eave', level(E, F)), edge('eave', level(F, A)),
    edge('hip', hip(A, P, MAIN)), edge('hip', hip(B, P, MAIN)), edge('hip', hip(F, Q, MAIN)),
    edge('hip', hip(Q, R, MAIN)), edge('hip', hip(D, W, MAIN)), edge('hip', hip(E, W, MAIN)),
    edge('valley', hip(C, R, MAIN)),
    edge('ridge', level(P, Q)), edge('ridge', level(R, W)),
    // The kitchen and sleepout roof: its eaves, the step's barge, the east end's
    // hip, and its top against the wall, level along the south roof and raking
    // along the east end.
    edge('eave', level(K, L)), edge('eave', level(J, I)), edge('eave', level(T, I)),
    edge('barge', rake(J, K, SOUTH)),
    edge('hip', hip(H, I, SOUTH)),
    edge('apron', level(G, H)), edge('apron', rake(H, T, SOUTH)),
    // The entry skillions: their eaves, their hip, and their sides against the walls.
    edge('eave', level(S1, S2)), edge('eave', level(S2, S3)),
    edge('hip', hip(SH, S2, LOW)),
    edge('apron', rake(S1, SH, LOW)), edge('apron', level(SH, S4)), edge('apron', rake(S4, S3, LOW)),
  ],
  exclusions: [{ label: 'Insulated roof over the new deck', reason: 'Left out by the scope note', area_m2: round((5917 * 7718) / 1e6, 2) }],
}

const laundry = {
  id: 'S2',
  label: 'New laundry and bathroom section',
  role: 'secondary',
  source: 'plans',
  planes: [plane('S2-P1', [M, N, G, L, O], LOW, 'west', `A302 south elevation: the laundry roof drawn at ${LOW}°`)],
  edges: [
    edge('eave', level(M, O)),
    edge('barge', rake(M, N, LOW)), edge('barge', rake(O, L, LOW)),
    edge('apron', level(N, G)),
    // The hip it shares with the kitchen and sleepout roof, counted once.
    edge('hip', hip(G, L, LOW, SOUTH)),
  ],
  exclusions: [],
}

const sheets = JSON.parse(readFileSync('eval/roof-takeoff/whittaker/sheets.json', 'utf8')).sheets.map((sheet) => {
  const copy = { ...sheet }
  delete copy.model // the expectations' marker for pages the model reads
  return copy
})

const takeoff = {
  version: 1,
  scale: {
    stated: '1:50 @ A1',
    sheet_size: 'A1',
    pdf_page: [1190.52, 841.92],
    calibration: { method: 'title_block', reference_mm: null, factor: 35.3207, delta_pct: null },
  },
  sheets,
  structures: [house, laundry],
  scope: {
    includes: [
      'Re-roof the existing house: its hip roof at 25° and its lower roofs at about 5°',
      'Roof the new laundry and bathroom section',
    ],
    excludes: ['The insulated roof over the new deck'],
    questions: [
      'The drawings give metal roof sheeting (MRS) but no profile or colour. Which sheet is it?',
      'No pitch is written: are the main roof’s 25° and the lower roofs’ 5°, measured off the elevations, right?',
      'How far do the lower roofs run under the main roof’s eaves? The roof plan shows them to its gutter line.',
      'The drawings are marked PRELIMINARY 21.04.26. Is there a later revision?',
    ],
  },
}

writeFileSync('eval/roof-takeoff/whittaker/takeoff.json', `${JSON.stringify(takeoff, null, 2)}\n`)

const sum = (xs) => round(xs.reduce((a, b) => a + b, 0), 2)
for (const s of takeoff.structures) {
  console.log(`${s.id} ${s.label}: ${s.planes.length} planes, ${sum(s.planes.map((p) => p.plan_area_m2))} m² on plan, ${sum(s.planes.map((p) => p.sloped_area_m2))} m² of roof`)
}
const totals = {}
for (const e of takeoff.structures.flatMap((s) => s.edges)) totals[e.type] = round((totals[e.type] ?? 0) + e.length_m, 3)
console.log('edges (m):', JSON.stringify(totals))
