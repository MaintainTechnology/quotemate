// TKO-30's lower roofs (DEC-047, DEC-048). A roof plan can dimension nothing
// and leave the reader naming none of the roofs joined to a hip roof, as
// Whittaker's A104 does, though it fills each with sheeting ribs. The drawing
// finds every rib-filled area joined to the hip roof and numbers it on the
// sheet itself. One small model call suggests which of the job's roofs each
// number is; the operator confirms or changes that on the run page, and the
// drawing measures only what the operator confirms.
//
// Nothing the model says reaches a takeoff on its own. Asked alone, it
// misfiled a roof in each of three live reads (DEC-047), and the deck a scope
// leaves out is drawn as the roofs in it are.

import { anthropic } from '@ai-sdk/anthropic'
import type { SupabaseClient } from '@supabase/supabase-js'
import { generateText } from 'ai'
import { degrees, PDFDocument, rgb, StandardFonts } from 'pdf-lib'
import { z } from 'zod'
import { deterministicSampling } from '@/lib/llm/sampling'
import { currentSmsWork, smsWorkCheckpoint } from '@/lib/sms/durable-work'
import type { Segment } from './calibrate'
import { hipRoofs } from './hips'
import type { MeasuredSheet } from './outline'
import { DEFAULT_TAKEOFF_MODEL, type ModelUsage } from './read'
import { correctTakeoff, regionsPlanPath, type CorrectOutcome } from './runs'
import { RoofPlanTakeoffSchema, type RoofPlanTakeoff } from './schema'

type P = [number, number]
type Takeoff = RoofPlanTakeoff
type Structure = Takeoff['structures'][number]
type Plane = Structure['planes'][number]
type Edge = Structure['edges'][number]
type Axis = 'v' | 'h'

export const FALLS = ['north', 'south', 'east', 'west'] as const
export type Fall = (typeof FALLS)[number]

/** A rib-filled area: its ribs' axis and spacing, its polygon in sheet points, and where its number goes. */
export type RibRegion = { axis: Axis; spacing: number; polygon: P[]; centre: P }
/** A measured plan sheet with what numbering it needs: its viewport transform and its bytes. */
export type PlanSheet = MeasuredSheet & { transform: number[]; bytes: Uint8Array }

/** One numbered area's answer: the roof it belongs to, or null when it isn't
 *  part of the job, and which way it falls. */
export const RegionAnswerSchema = z.object({
  n: z.number().int().min(1).max(100),
  roof: z.string().min(1).max(20).nullable(),
  fall: z.enum(FALLS).nullable(),
})
export const RegionAnswersSchema = z.array(RegionAnswerSchema).min(1).max(100)
export type RegionAnswer = z.infer<typeof RegionAnswerSchema>
/** The reader's suggestion for one area, with what it says the area roofs. */
export type RegionSuggestion = RegionAnswer & { covers: string | null }

/** What the drawing found on one plan sheet: its rib areas in number order,
 *  the hip roofs they join, and the roofs the reading left unsized, which are
 *  the ones an area may join. */
export type FoundRegions = { sheet: PlanSheet; houses: P[][]; areas: RibRegion[]; roofs: Array<{ id: string; label: string }> }

/** A run's numbered roof areas (migration 228): what the calibrate stage found
 *  and the reader suggested, and what the operator confirmed. */
export type RunRegions = {
  sheet: { file: string; page: number }
  /** The sheet's calibrated millimetres a point. */
  factor: number
  /** The elevation's shallowest roof pitch, which a lean-to takes (DEC-044), or null. */
  pitch: number | null
  houses: P[][]
  areas: RibRegion[]
  roofs: Array<{ id: string; label: string }>
  suggested: RegionSuggestion[] | null
  /** Why the reader suggested nothing, or null. */
  note: string | null
  confirmed: { areas: RegionAnswer[]; at: string } | null
  /** The takeoff before the first confirmed answer, which a later answer starts from. */
  before: RoofPlanTakeoff | null
}

const DOWN: Record<Fall, P> = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] }
const FALL_WORDS: Record<Axis, string> = { v: 'north or south', h: 'east or west' }
const round = (n: number, places = 0) => Math.round(n * 10 ** places) / 10 ** places || 0
const unsized = (p: Plane) => p.plan_area_m2 === null && !p.plan_dims_mm && !p.polygon_mm
/** A sheet's ribs run down its fall, so an area can fall only one of two ways. */
const alongRibs = (area: RibRegion, fall: Fall) => (area.axis === 'v') === (fall === 'north' || fall === 'south')

// ── Finding the areas ───────────────────────────────────────────────────────

type Piece = { off: number; from: number; to: number }
type Rib = Piece
type Run = { k: number; c: number; from: number; to: number } // u = k * off + c, over off in [from, to]

const toXY = (axis: Axis, off: number, u: number): P => (axis === 'v' ? [off, u] : [u, off])

export function inside(pt: P, poly: P[]): boolean {
  let hit = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j]
    if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) hit = !hit
  }
  return hit
}
export const planArea = (poly: P[]) => Math.abs(poly.reduce((sum, [x1, y1], i) => { const [x2, y2] = poly[(i + 1) % poly.length]; return sum + x1 * y2 - x2 * y1 }, 0)) / 2
const box = (poly: P[]) => [Math.min(...poly.map((p) => p[0])), Math.min(...poly.map((p) => p[1])), Math.max(...poly.map((p) => p[0])), Math.max(...poly.map((p) => p[1]))]
const near = (p: P[], q: P[], gap = 8) => { const [a, b, c, d] = box(p); const [e, f, g, h] = box(q); return a <= g + gap && e <= c + gap && b <= h + gap && f <= d + gap }

/** Every rib-filled area joined to a house (a hip roof's eave outline), directly
 *  or through another, outside the houses themselves, numbered top to bottom
 *  and then left to right. Ribs are square strokes 1.5 to 15 points apart,
 *  walked from each long one; an area ends at a stroke between two ribs, or
 *  where the ribs run out. ponytail: ribs drawn square to the page; turn the
 *  walk for a roof drawn askew. */
export function ribRegions(segments: Segment[], houses: P[][]): RibRegion[] {
  const piecesOf = (axis: Axis): Piece[] => segments.flatMap(([x1, y1, x2, y2]): Piece[] =>
    axis === 'v' ? (Math.abs(x1 - x2) <= 0.25 && Math.abs(y2 - y1) >= 0.5 ? [{ off: (x1 + x2) / 2, from: Math.min(y1, y2), to: Math.max(y1, y2) }] : [])
      : (Math.abs(y1 - y2) <= 0.25 && Math.abs(x2 - x1) >= 0.5 ? [{ off: (y1 + y2) / 2, from: Math.min(x1, x2), to: Math.max(x1, x2) }] : []))
  const PIECES = { v: piecesOf('v'), h: piecesOf('h') }

  /** The rib at offsets [lo, hi] that continues `prev`: the pieces there joined. */
  function ribAt(axis: Axis, lo: number, hi: number, prev: Rib | null, seedU: number): Rib | null {
    const groups = new Map<number, Piece[]>()
    for (const p of PIECES[axis]) {
      if (p.off < lo || p.off > hi) continue
      const key = [...groups.keys()].find((k) => Math.abs(k - p.off) <= 0.3) ?? p.off
      groups.set(key, [...(groups.get(key) ?? []), p])
    }
    let best: Rib | null = null
    let bestScore = 0
    for (const ps of groups.values()) {
      const [a, b] = prev ? [prev.from, prev.to] : [seedU, seedU]
      const sorted = ps.sort((x, y) => x.from - y.from)
      let run: Rib | null = null
      for (const p of sorted) {
        if (!run) { if (p.to >= a - 0.01 && p.from <= b + 0.01) run = { ...p }; continue }
        if (p.from <= run.to + 0.5) run.to = Math.max(run.to, p.to)
      }
      if (!run) continue
      for (const p of [...sorted].reverse()) if (p.to >= run.from - 0.5 && p.from < run.from) run.from = p.from
      const score = Math.min(run.to, b) - Math.max(run.from, a) + (run.to - run.from) * 1e-3
      if (!best || score > bestScore) { best = { off: ps.reduce((s, p) => s + p.off, 0) / ps.length, from: run.from, to: run.to }; bestScore = score }
    }
    return best
  }

  function walk(axis: Axis, seed: P) {
    const [so, su] = axis === 'v' ? seed : [seed[1], seed[0]]
    const long = PIECES[axis].filter((p) => p.to - p.from >= 10 && Math.abs(p.off - so) <= 20 && p.from <= su && su <= p.to)
    const offs = [...new Set(long.map((p) => Math.round(p.off * 10) / 10))].sort((a, b) => a - b)
    const gaps = offs.slice(1).map((o, i) => o - offs[i]).filter((d) => d >= 1.5 && d <= 15).sort((a, b) => a - b)
    if (gaps.length < 3) return null
    const s = gaps[Math.floor(gaps.length / 2)]
    const start = ribAt(axis, so - s / 2, so + s / 2, null, su)
    if (!start) return null
    const ribs: Rib[] = [start]
    const sides: [number | null, number | null] = [null, null]
    const step = (dir: 1 | -1) => {
      let prev = start
      for (let guard = 0; guard < 2000; guard++) {
        const [w1, w2] = [prev.off + dir * s * 0.6, prev.off + dir * s * 1.4]
        const next = ribAt(axis, Math.min(w1, w2), Math.max(w1, w2), prev, 0)
        if (!next) return
        // A side: a stroke along the ribs between them, spanning most of what they share.
        const [o1, o2] = [Math.max(prev.from, next.from), Math.min(prev.to, next.to)]
        const side = PIECES[axis].find((p) => (p.off - prev.off) * dir > 0.2 && (next.off - p.off) * dir > 0.2
          && Math.min(p.to, o2) - Math.max(p.from, o1) >= 0.8 * (o2 - o1))
        if (side) { sides[dir > 0 ? 1 : 0] = side.off; return }
        const continuous = (pe: number, ne: number) => Math.abs(pe - ne) <= 1.3 * s + 0.3
        const stepLine = (pe: number, ne: number) => PIECES[axis].some((p) =>
          (p.off - prev.off) * dir > 0.2 && (next.off - p.off) * dir > 0.2 && p.from <= Math.min(pe, ne) + 0.6 && p.to >= Math.max(pe, ne) - 0.6)
        if (!(continuous(prev.from, next.from) || stepLine(prev.from, next.from))) return
        if (!(continuous(prev.to, next.to) || stepLine(prev.to, next.to))) return
        if (dir > 0) ribs.push(next)
        else ribs.unshift(next)
        prev = next
      }
    }
    step(1)
    step(-1)
    if (ribs.length < 4) return null
    // An end "rib" off the ribs' spacing is the area's edge line, taken in by
    // the walk; drawn ribs keep their spacing within a few per cent.
    // ponytail: an edge within 10% of the spacing still reads as a rib, half a rib over.
    const offPitch = (a: Rib, b: Rib) => Math.abs(Math.abs(a.off - b.off) - s) > 0.1 * s
    if (sides[0] === null && offPitch(ribs[0], ribs[1])) sides[0] = ribs[0].off
    if (sides[1] === null && offPitch(ribs.at(-1)!, ribs.at(-2)!)) sides[1] = ribs.at(-1)!.off
    return { axis, s, ribs, sides }
  }

  type Walked = NonNullable<ReturnType<typeof walk>> & { centre: P }
  const found: Walked[] = []
  const holds = (r: Walked, axis: Axis, off: number, u: number) => r.axis === axis && r.ribs[0].off - 0.5 <= off && off <= r.ribs.at(-1)!.off + 0.5
    && r.ribs.some((q) => Math.abs(q.off - off) <= r.s * 0.6 && q.from - 0.5 <= u && u <= q.to + 0.5)
  for (const axis of ['v', 'h'] as const) {
    for (const p of PIECES[axis]) {
      const mid = (p.from + p.to) / 2
      if (p.to - p.from < 10 || found.some((r) => holds(r, axis, p.off, mid))) continue
      const w = walk(axis, axis === 'v' ? [p.off, mid] : [mid, p.off])
      if (!w) continue
      const middle = w.ribs[Math.floor(w.ribs.length / 2)]
      const centre = toXY(axis, middle.off, (middle.from + middle.to) / 2)
      // The same area walked at another spacing: keep the walk with more ribs.
      const twin = found.findIndex((r) => r.axis === axis && Math.hypot(r.centre[0] - centre[0], r.centre[1] - centre[1]) <= 15)
      if (twin < 0) found.push({ ...w, centre })
      else if (found[twin].ribs.length < w.ribs.length) found[twin] = { ...w, centre }
    }
  }
  const areas = found
    .filter((r) => !houses.some((h) => inside(r.centre, h)))
    .map((r): RibRegion => ({ axis: r.axis, spacing: r.s, polygon: shape(r, segments), centre: r.centre }))
  const joined = new Set<number>()
  for (let grew = true; grew;) {
    grew = false
    areas.forEach((r, i) => {
      if (joined.has(i)) return
      if (houses.some((h) => near(r.polygon, h)) || [...joined].some((j) => near(r.polygon, areas[j].polygon))) { joined.add(i); grew = true }
    })
  }
  return areas.filter((_, i) => joined.has(i))
    .sort((a, b) => (Math.round(a.centre[1] / 20) - Math.round(b.centre[1] / 20)) || a.centre[0] - b.centre[0])
}

/** Runs of one slope along a chain of rib ends (off, u), broken where the end jumps. */
function runsOf(chain: P[], s: number): Run[] {
  const runs: Run[] = []
  let start = 0
  const fit = (i: number, j: number): Run => {
    const [o1, u1] = chain[i], [o2, u2] = chain[j]
    const k = j > i ? (u2 - u1) / (o2 - o1) : 0
    return { k, c: u1 - k * o1, from: o1, to: o2 }
  }
  for (let i = 1; i < chain.length; i++) {
    const jump = Math.abs(chain[i][1] - chain[i - 1][1]) > 1.5 * s + 0.5
    const run = fit(start, i)
    const bent = chain.slice(start, i + 1).some(([o, u]) => Math.abs(run.k * o + run.c - u) > 0.8)
    if (jump || (i - start >= 2 && bent)) {
      runs.push(fit(start, i - 1))
      start = i
    }
  }
  runs.push(fit(start, chain.length - 1))
  return runs
}

const meet = (a: Run, b: Run): number | null => (Math.abs(a.k - b.k) < 1e-6 ? null : (b.c - a.c) / (a.k - b.k))

/** An area's straight-edged polygon: its rib-end chains as runs of one slope,
 *  each slanted run moved to the middle stroke of the band its ribs end on
 *  (the line a hip is measured on), carried to the side strokes or to where
 *  the two chains meet. */
function shape(r: { axis: Axis; s: number; ribs: Rib[]; sides: [number | null, number | null] }, segments: Segment[]): P[] {
  const { axis, ribs, s } = r
  const along = segments.flatMap(([x1, y1, x2, y2]) => axis === 'v'
    ? (Math.abs(x1 - x2) <= 0.25 ? [{ off: x1, from: Math.min(y1, y2), to: Math.max(y1, y2) }] : [])
    : (Math.abs(y1 - y2) <= 0.25 ? [{ off: y1, from: Math.min(x1, x2), to: Math.max(x1, x2) }] : []))
  const sideBeyond = (dir: 1 | -1): number => {
    const end = dir > 0 ? ribs.at(-1)! : ribs[0]
    const stroke = along
      .filter((p) => (p.off - end.off) * dir > 0.2 && (p.off - end.off) * dir <= 2.5 * s
        && Math.min(p.to, end.to) - Math.max(p.from, end.from) >= 0.5 * (end.to - end.from))
      .sort((p, q) => Math.abs(p.off - end.off) - Math.abs(q.off - end.off))[0]
    return stroke?.off ?? end.off + (dir * s) / 2
  }
  const a = r.sides[0] ?? sideBeyond(-1)
  const b = r.sides[1] ?? sideBeyond(1)
  const strokes = segments.flatMap(([x1, y1, x2, y2]) => {
    const [o1, u1] = axis === 'v' ? [x1, y1] : [y1, x1]
    const [o2, u2] = axis === 'v' ? [x2, y2] : [y2, x2]
    if (Math.abs(o2 - o1) < 2) return []
    const k = (u2 - u1) / (o2 - o1)
    return [{ k, c: u1 - k * o1, from: Math.min(o1, o2), to: Math.max(o1, o2) }]
  })
  const snap = (run: Run, outward: 1 | -1): Run => {
    if (Math.abs(run.k) < 0.3) return run
    const mid = (run.from + run.to) / 2
    const scale = Math.sqrt(1 + run.k * run.k)
    const band = strokes
      .filter((t) => Math.abs(Math.atan(t.k) - Math.atan(run.k)) <= (6 * Math.PI) / 180
        && Math.min(t.to, run.to) - Math.max(t.from, run.from) >= 0.3 * (run.to - run.from))
      .map((t) => ({ t, d: (outward * (t.k * mid + t.c - (run.k * mid + run.c))) / scale }))
      .filter(({ d }) => d >= -3.5 && d <= 9)
      .sort((p, q) => p.d - q.d)
    const first = band.findIndex(({ d }) => d >= -0.8)
    if (first < 0) return run
    const chain = [band[first]]
    for (const next of band.slice(first + 1)) if (next.d - chain.at(-1)!.d <= 4.5 && next.d - chain.at(-1)!.d >= 0.6) chain.push(next)
    return chain.length < 3 ? run : { ...run, k: chain[1].t.k, c: chain[1].t.c }
  }
  const lows = runsOf(ribs.map((q) => [q.off, q.from]), s).map((run) => snap(run, -1))
  const highs = runsOf(ribs.map((q) => [q.off, q.to]), s).map((run) => snap(run, 1))
  // The chains run on to the sides, unless they meet first, up to 2.5 ribs
  // past a side stroke, as a band's own stroke can end there.
  const ends = (side: number, low: Run, high: Run, inner: number) => {
    const m = meet(low, high)
    return m !== null && (m - inner) * (side - inner) > 0 && Math.abs(m - inner) < Math.abs(side - inner) + 2.5 * s ? { at: m, apex: true } : { at: side, apex: false }
  }
  const first = ends(a, lows[0], highs[0], lows[0].from)
  const last = ends(b, lows.at(-1)!, highs.at(-1)!, lows.at(-1)!.to)
  const points = (runs: Run[]): P[] => {
    const pts: P[] = [[first.at, runs[0].k * first.at + runs[0].c]]
    for (let i = 0; i + 1 < runs.length; i++) {
      const [r1, r2] = [runs[i], runs[i + 1]]
      const m = meet(r1, r2)
      if (m !== null && m >= r1.to - 2 * s && m <= r2.from + 2 * s) pts.push([m, r1.k * m + r1.c])
      else {
        const o = (r1.to + r2.from) / 2 // a step, square across half way between the ribs
        pts.push([o, r1.k * o + r1.c], [o, r2.k * o + r2.c])
      }
    }
    pts.push([last.at, runs.at(-1)!.k * last.at + runs.at(-1)!.c])
    return pts
  }
  const highPts = points(highs)
  const ring = [...points(lows), ...(last.apex ? highPts.slice(0, -1) : highPts).reverse()]
  const poly = (first.apex ? ring.slice(0, -1) : ring).map(([o, u]) => toXY(axis, o, u))
  return poly.filter((p, i) => i === 0 || Math.hypot(p[0] - poly[i - 1][0], p[1] - poly[i - 1][1]) > 0.05)
}

/** The rib areas on the one plan sheet, of those the reading's unsized roofs
 *  cite, that draws them joined to a hip roof; or null. The roofs are the
 *  reading's own, before the drawing measured anything: an area may join one
 *  of them. ponytail: one sheet a job, and areas joined to a hip roof; seed
 *  from other measured roofs if a job needs it. */
export function findRegions(reading: Takeoff, sheets: PlanSheet[]): FoundRegions | null {
  const roofs = reading.structures.filter((s) => s.planes.length && s.planes.every(unsized))
  if (!roofs.length) return null
  const cited = sheets.filter((sheet) => roofs.some((s) => s.planes.some((p) => p.evidence.some((e) => e.file === sheet.file && e.page === sheet.page))))
  const drawn = cited.map((sheet) => {
    const houses = hipRoofs(sheet.segments, sheet.factor).map((r) => r.outline)
    return { sheet, houses, areas: houses.length ? ribRegions(sheet.segments, houses) : [] }
  }).filter((d) => d.areas.length)
  if (drawn.length !== 1) return null
  return { ...drawn[0], roofs: roofs.map((s) => ({ id: s.id, label: s.label })) }
}

// ── Numbering them on the sheet ─────────────────────────────────────────────

/** A one-page PDF of the sheet, each area outlined and numbered on the page
 *  itself, so its lettering stays. `transform` is the viewport the strokes
 *  were read in; numbers are turned with the page, so they read upright. */
export async function numberedPlan(bytes: Uint8Array, page: number, transform: number[], regions: RibRegion[]): Promise<Uint8Array> {
  const [a, b, c, d, e, f] = transform
  const det = a * d - b * c
  const user = ([x, y]: P) => ({ x: (d * (x - e) - c * (y - f)) / det, y: (a * (y - f) - b * (x - e)) / det })
  const out = await PDFDocument.create()
  const [copy] = await out.copyPages(await PDFDocument.load(bytes, { ignoreEncryption: true }), [page - 1])
  out.addPage(copy)
  const font = await out.embedFont(StandardFonts.HelveticaBold)
  const turn = copy.getRotation().angle % 360
  const rad = (turn * Math.PI) / 180
  regions.forEach((r, i) => {
    r.polygon.forEach((p, k) => copy.drawLine({ start: user(p), end: user(r.polygon[(k + 1) % r.polygon.length]), thickness: 1.2, color: rgb(0.9, 0.1, 0.2) }))
    const at = user(r.centre)
    copy.drawCircle({ x: at.x, y: at.y, size: 11, color: rgb(1, 0.85, 0), borderColor: rgb(0.9, 0.1, 0.2), borderWidth: 1.5 })
    const label = String(i + 1)
    const [dx, dy] = [-font.widthOfTextAtSize(label, 14) / 2, -5]
    copy.drawText(label, { x: at.x + dx * Math.cos(rad) - dy * Math.sin(rad), y: at.y + dx * Math.sin(rad) + dy * Math.cos(rad), size: 14, font, color: rgb(0, 0, 0), rotate: degrees(turn) })
  })
  return out.save()
}

// ── The reader's suggestion ─────────────────────────────────────────────────

const Reply = z.object({
  areas: z.array(z.object({
    n: z.number().int(),
    rooms: z.array(z.string().max(200)).max(30).optional(),
    covers: z.string().max(500).nullable().optional(),
    roof: z.string().max(50).nullable(),
    fall: z.enum(FALLS).nullable(),
  })).max(100),
  left_out: z.array(z.object({ label: z.string().max(500), areas: z.array(z.number().int()).max(100) })).max(50),
})

const SUGGEST_SYSTEM = "You read an architect's roof plan for a roofer. Its areas of roof sheeting are outlined in red and numbered in yellow circles. Say which of the job's roofs each numbered area belongs to, or that it is not part of the job. Answer with JSON only."

function suggestPrompt(takeoff: Takeoff, scopeNote: string | null, areas: RibRegion[]): string {
  const roofs = takeoff.structures.map((s) => `- ${s.id}: ${s.label}`).join('\n')
  const leftOut = takeoff.structures.flatMap((s) => s.exclusions.map((x) => `- "${x.label}"`)).join('\n') || '- none'
  const numbered = areas.map((r, i) => `- ${i + 1}: falls ${FALL_WORDS[r.axis]}`).join('\n')
  return `The PDF is the job's roof plan sheet. Each yellow number marks one area of roof sheeting, outlined in red. A hipped roof's own faces are not numbered: they are measured already.

The numbered areas, each with the two ways its sheeting lets it fall:
${numbered}

The job's roofs, as read from its plans:
${roofs}

Scope: ${scopeNote ?? 'not given'}

Left out of the job:
${leftOut}

For each number, in this order:
- "rooms": the rooms the area roofs. Where the sheet has a floor plan beside the roof plan, line the two up (they share a scale and an orientation): each roof covers the rooms drawn under it.
- "covers": what the area roofs, as the drawing's labels name it.
- "roof": the id of the job's roof the area belongs to, or null when it is not part of the job: a roof the scope leaves out, or anything else. A roof the job names by its rooms (a laundry, a bathroom) is the area over those rooms.
- "fall": which of its two ways the area falls, as its FALL arrow shows: "north" (up the page), "south", "east" (right) or "west".
Then, as "left_out", each left-out item's label as given and the numbers of its areas.

Reply with JSON only:
{"areas":[{"n":1,"rooms":["..."],"covers":"...","roof":"S1","fall":"north"}],"left_out":[{"label":"...","areas":[3]}]}`
}

/** The JSON a reply holds, without any fence around it, or null. */
function replyJson(text: string): unknown {
  const [start, end] = [text.indexOf('{'), text.lastIndexOf('}')]
  if (start < 0 || end <= start) return null
  try {
    return JSON.parse(text.slice(start, end + 1))
  } catch {
    return null
  }
}

/** The reader's suggestion for each numbered area, in one model call on the
 *  numbered plan. Only what the operator could confirm is suggested: a roof
 *  the reading left unsized, or none for an area the reply leaves out of the
 *  job, and a fall along the area's sheeting. A number the reply leaves
 *  unclear gets no suggestion, so the operator answers it. */
export async function suggestRegions(regions: Pick<RunRegions, 'areas' | 'roofs'>, input: {
  takeoff: Takeoff
  plan: Uint8Array
  scopeNote: string | null
  generate?: typeof generateText
}): Promise<{ suggested: RegionSuggestion[] | null; note: string | null; usage: ModelUsage }> {
  const model = process.env.TAKEOFF_MODEL?.trim() || DEFAULT_TAKEOFF_MODEL
  const generate = input.generate ?? generateText
  const reply = await smsWorkCheckpoint('regions:suggest', async () => {
    const result = await generate({
      model: anthropic(model),
      messages: [
        { role: 'system', content: SUGGEST_SYSTEM },
        { role: 'user', content: [{ type: 'file', data: input.plan, mediaType: 'application/pdf' }, { type: 'text', text: suggestPrompt(input.takeoff, input.scopeNote, regions.areas) }] },
      ],
      ...deterministicSampling(model),
      maxOutputTokens: 2_000,
      maxRetries: 0, // the queue retries the attempt
      abortSignal: currentSmsWork()?.signal,
    })
    return { text: result.text, inputTokens: result.usage.inputTokens ?? 0, outputTokens: result.usage.outputTokens ?? 0 }
  })
  const usage: ModelUsage = { inputTokens: reply.inputTokens, outputTokens: reply.outputTokens, calls: 1 }
  const parsed = Reply.safeParse(replyJson(reply.text))
  if (!parsed.success) return { suggested: null, note: "The reader's suggestion couldn't be used, so every numbered area waits on the operator.", usage }
  const roofs = new Set(regions.roofs.map((r) => r.id))
  const leftOut = new Set(parsed.data.left_out.flatMap((l) => l.areas))
  const suggested = regions.areas.flatMap((area, i): RegionSuggestion[] => {
    const n = i + 1
    const given = parsed.data.areas.filter((a) => a.n === n)
    const entry = given.length === 1 ? given[0] : null
    const fall = entry?.fall && alongRibs(area, entry.fall) ? entry.fall : null
    const covers = entry?.covers?.trim().slice(0, 120) || entry?.rooms?.join(', ').slice(0, 120) || null
    if (leftOut.has(n) || (entry && entry.roof === null)) return [{ n, roof: null, fall, covers }]
    return entry?.roof && roofs.has(entry.roof) ? [{ n, roof: entry.roof, fall, covers }] : []
  })
  return { suggested, note: null, usage }
}

// ── Measuring what the operator confirms ────────────────────────────────────

export type PlaceOutcome = { ok: true; takeoff: Takeoff; placed: number } | { ok: false; problems: string[] }

/** Whether an answer can be measured, and the problems in words when not:
 *  every number answered once, each area of the job given a roof the reading
 *  left unsized and a fall along its sheeting. A roof measured from aerial
 *  data takes no area from the plan, as aerial data wins for an existing roof
 *  (App Flow F6). */
function answerProblems(takeoff: Takeoff, regions: Pick<RunRegions, 'areas' | 'roofs'>, answers: RegionAnswer[]): string[] {
  const count = regions.areas.length
  const problems: string[] = []
  const given = new Map<number, number>()
  for (const a of answers) given.set(a.n, (given.get(a.n) ?? 0) + 1)
  for (let n = 1; n <= count; n++) {
    if (!given.has(n)) problems.push(`Area ${n} has no answer: give it a roof, or leave it out of the job.`)
    else if (given.get(n)! > 1) problems.push(`Area ${n} is answered more than once.`)
  }
  for (const n of given.keys()) if (n < 1 || n > count) problems.push(`Area ${n} isn't on the numbered plan, which numbers ${count}.`)
  const roofs = new Set(regions.roofs.map((r) => r.id))
  for (const a of answers) {
    if (a.roof === null || a.n < 1 || a.n > count) continue
    const structure = takeoff.structures.find((s) => s.id === a.roof)
    if (!structure || !roofs.has(a.roof)) problems.push(`Area ${a.n} names ${a.roof}, which isn't one of the roofs the drawings left unmeasured.`)
    else if (structure.source !== 'plans' || structure.aerial) problems.push(`Area ${a.n} names ${a.roof}, which is measured from aerial data, so it takes no area from the plan.`)
    const area = regions.areas[a.n - 1]
    if (!a.fall || !alongRibs(area, a.fall)) problems.push(`Area ${a.n}'s sheeting lets it fall ${FALL_WORDS[area.axis]}: say which.`)
  }
  return [...new Set(problems)]
}

/** The takeoff with each area the operator gives a roof as one of its planes
 *  (filling a plane the reading left unsized, else a new one), at the
 *  elevation's shallow pitch, the pitch a lean-to takes (DEC-044). Its outline
 *  is in the hip roof's frame, as hips.ts gives its faces, so the pack draws
 *  the two together. Its edges are classed by its fall: the low end an eave,
 *  an edge with a house beyond it an apron, a side a barge, and a slanted edge
 *  two areas share a hip, or a valley where both fall to it. A reading's edge
 *  without a length goes once the drawing measures one of its type, and a high
 *  side without one once an apron is measured. */
export function placeRegions(takeoff: Takeoff, regions: Pick<RunRegions, 'areas' | 'roofs' | 'houses' | 'factor' | 'pitch' | 'sheet'>, answers: RegionAnswer[]): PlaceOutcome {
  const problems = answerProblems(takeoff, regions, answers)
  if (problems.length) return { ok: false, problems }
  type Placed = { n: number; region: RibRegion; roof: string; fall: Fall }
  const placed: Placed[] = answers.flatMap((a): Placed[] => (a.roof && a.fall ? [{ n: a.n, region: regions.areas[a.n - 1], roof: a.roof, fall: a.fall }] : []))
  if (!placed.length) return { ok: true, takeoff, placed: 0 }

  const f = regions.factor
  const rad = regions.pitch === null ? null : (regions.pitch * Math.PI) / 180
  // Edges: what lies 3, 6 or 9 points beyond each one's middle says what it is.
  const edgesOf = new Map<string, Edge[]>()
  placed.forEach((r, i) => {
    const poly = r.region.polygon
    const down = DOWN[r.fall]
    for (let k = 0; k < poly.length; k++) {
      const [p, q] = [poly[k], poly[(k + 1) % poly.length]]
      const len = Math.hypot(q[0] - p[0], q[1] - p[1])
      if (len < 0.5) continue
      const dir: P = [(q[0] - p[0]) / len, (q[1] - p[1]) / len]
      const mid: P = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2]
      let out: P = [dir[1], -dir[0]]
      if (inside([mid[0] + out[0] * 1.5, mid[1] + out[1] * 1.5], poly)) out = [-out[0], -out[1]]
      const beyond = [3, 6, 9].map((t): P => [mid[0] + out[0] * t, mid[1] + out[1] * t])
      const lean = Math.abs(dir[0] * down[0] + dir[1] * down[1])
      const kind = lean < 0.3 ? 'across' : lean > 0.9 ? 'side' : 'slant'
      const other = placed.findIndex((o, j) => j !== i && beyond.some((b) => inside(b, o.region.polygon)))
      let type: Edge['type']
      if (other >= 0) {
        if (other < i) continue // counted from the other area
        const away = down[0] * -out[0] + down[1] * -out[1] > 0 && DOWN[placed[other].fall][0] * out[0] + DOWN[placed[other].fall][1] * out[1] > 0
        type = kind === 'slant' ? (away ? 'hip' : 'valley') : away ? 'ridge' : 'valley'
      } else if (regions.houses.some((h) => beyond.some((b) => inside(b, h)))) type = 'apron'
      else if (kind === 'across') type = out[0] * down[0] + out[1] * down[1] > 0 ? 'eave' : 'apron'
      else if (kind === 'side') type = 'barge'
      else type = 'hip'
      const plan = (len * f) / 1000
      const slope = rad === null ? null : type === 'hip' || type === 'valley' ? Math.sqrt(1 + Math.tan(rad) ** 2 / 2) : kind === 'side' ? 1 / Math.cos(rad) : 1
      const edges = edgesOf.get(r.roof) ?? []
      edges.push({ type, length_m: slope === null ? null : round(plan * slope, 3), source: 'measured', confidence: 'medium' })
      edgesOf.set(r.roof, edges)
    }
  })

  // The hip roof's frame (hips.ts): x east of its west eave, y north of its south eave.
  const frame = regions.houses[0] ?? placed[0].region.polygon
  const [left, bottom] = [Math.min(...frame.map((p) => p[0])), Math.max(...frame.map((p) => p[1]))]
  const structures = takeoff.structures.map((s): Structure => {
    const mine = placed.filter((r) => r.roof === s.id)
    if (!mine.length) return s
    const planes = [...s.planes]
    const evidence = [...new Map(s.planes.flatMap((p) => p.evidence).map((e) => [JSON.stringify(e), e])).values()].slice(0, 49)
    for (const r of mine) {
      const poly = r.region.polygon
      const area = round((planArea(poly) * f * f) / 1e6, 2)
      const [x1, y1, x2, y2] = box(poly)
      const at = planes.findIndex(unsized)
      const kept = at >= 0 && planes[at].pitch_deg !== null
      const pitch = kept ? planes[at].pitch_deg : regions.pitch
      const plane: Plane = {
        id: at >= 0 ? planes[at].id : `${s.id}-P${planes.length + 1}`,
        plan_dims_mm: null,
        polygon_mm: poly.map(([x, y]) => [round((x - left) * f), round((bottom - y) * f)]),
        plan_area_m2: area,
        pitch_deg: pitch,
        pitch_source: kept ? planes[at].pitch_source : pitch === null ? null : 'elevation',
        fall: r.fall,
        profile: at >= 0 ? planes[at].profile : null,
        finish_tag: at >= 0 ? planes[at].finish_tag : null,
        sloped_area_m2: pitch === null ? null : round(area / Math.cos((pitch * Math.PI) / 180), 2),
        confidence: 'medium',
        evidence: [...(at >= 0 ? planes[at].evidence.slice(0, 49) : evidence), {
          file: regions.sheet.file,
          page: regions.sheet.page,
          text: `Roof area ${r.n} of the numbered plan, as the operator confirmed: drawn sheeting, ${area} m² on plan`,
          bbox: [round(x1, 1), round(y1, 1), round(x2, 1), round(y2, 1)],
        }],
      }
      if (at >= 0) planes[at] = plane
      else planes.push(plane)
    }
    const added = edgesOf.get(s.id) ?? []
    const measured = new Set<string>(added.map((e) => e.type))
    const covered = (e: Edge) => e.length_m === null && (measured.has(e.type) || (e.type === 'high_side' && measured.has('apron')))
    return { ...s, planes, edges: [...s.edges.filter((e) => !covered(e)), ...added] }
  })
  return { ok: true, takeoff: { ...takeoff, structures }, placed: placed.length }
}

// ── The operator's answer, through the API ──────────────────────────────────

export type AssignOutcome =
  | CorrectOutcome
  | { ok: false; error: 'no_regions' }
  | { ok: false; error: 'invalid_answer'; problems: string[] }

/** A run with a reading and no stage running, as a correction needs. */
const CORRECTABLE = ['ready', 'needs_review']

async function saveRegions(db: SupabaseClient, run: { id: string; tenant_id: string }, regions: RunRegions) {
  const { error } = await db.from('roof_takeoff_runs').update({ regions }).eq('id', run.id).eq('tenant_id', run.tenant_id)
  if (error) throw new Error(`takeoff regions save failed: ${error.message}`)
}

/** Measures the operator's answer to the run's numbered roof areas and saves
 *  the result as the run's correction, which re-runs the checks. A later
 *  answer starts from the takeoff as it was before the first, which is kept
 *  first, so an area is never counted twice. */
export async function assignRegions(db: SupabaseClient, input: { tenantId: string; runId: string; areas: unknown; now?: Date }): Promise<AssignOutcome> {
  const found = await db.from('roof_takeoff_runs')
    .select('id, tenant_id, status, regions, latest_extraction_id')
    .eq('id', input.runId).eq('tenant_id', input.tenantId)
    .maybeSingle()
  if (found.error) throw new Error(`takeoff run lookup failed: ${found.error.message}`)
  const run = found.data as { id: string; tenant_id: string; status: string; regions: RunRegions | null; latest_extraction_id: string | null } | null
  if (!run) return { ok: false, error: 'not_found' }
  if (!run.regions) return { ok: false, error: 'no_regions' }
  if (!CORRECTABLE.includes(run.status) || !run.latest_extraction_id) return { ok: false, error: 'conflict_status', status: run.status }
  const answers = RegionAnswersSchema.safeParse(input.areas)
  if (!answers.success) {
    return { ok: false, error: 'invalid_answer', problems: answers.error.issues.slice(0, 10).map((issue) => `${issue.path.map(String).join('.') || 'areas'}: ${issue.message}`) }
  }
  const reading = await db.from('plan_extractions')
    .select('items, corrected_items')
    .eq('id', run.latest_extraction_id).eq('tenant_id', run.tenant_id)
    .maybeSingle()
  if (reading.error) throw new Error(`takeoff reading lookup failed: ${reading.error.message}`)
  const current = reading.data as { items: unknown; corrected_items: unknown } | null
  const base = RoofPlanTakeoffSchema.parse(run.regions.before ?? current?.corrected_items ?? current?.items)
  const placed = placeRegions(base, run.regions, answers.data)
  if (!placed.ok) return { ok: false, error: 'invalid_answer', problems: placed.problems }
  if (!run.regions.before) await saveRegions(db, run, { ...run.regions, before: base })
  const outcome = await correctTakeoff(db, { tenantId: input.tenantId, runId: input.runId, takeoff: placed.takeoff, now: input.now })
  if (outcome.ok) await saveRegions(db, run, { ...run.regions, before: base, confirmed: { areas: answers.data, at: (input.now ?? new Date()).toISOString() } })
  return outcome
}

/** The run's numbered plan, for the run page to show beside the answer. */
export async function regionsPlan(db: SupabaseClient, bucket: string, input: { tenantId: string; runId: string }): Promise<{ ok: true; pdf: Uint8Array } | { ok: false; error: 'not_found' | 'no_regions' }> {
  const found = await db.from('roof_takeoff_runs')
    .select('id, regions')
    .eq('id', input.runId).eq('tenant_id', input.tenantId)
    .maybeSingle()
  if (found.error) throw new Error(`takeoff run lookup failed: ${found.error.message}`)
  if (!found.data) return { ok: false, error: 'not_found' }
  if (!(found.data as { regions: RunRegions | null }).regions) return { ok: false, error: 'no_regions' }
  const { data, error } = await db.storage.from(bucket).download(regionsPlanPath(input.tenantId, input.runId))
  if (error || !data) {
    if (!error || /not found/i.test(error.message)) return { ok: false, error: 'no_regions' }
    throw new Error(`takeoff numbered plan download failed: ${error.message}`)
  }
  return { ok: true, pdf: new Uint8Array(await data.arrayBuffer()) }
}
