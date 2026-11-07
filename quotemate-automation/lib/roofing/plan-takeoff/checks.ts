// The takeoff checks, C1 to C9 (TKO-13, Service Spec §8). Each is a pure
// function over the takeoff and what the request and drawings say about it,
// returning pass, warning, fail or skipped with a plain detail. The model
// never decides a check. A run is ready when C1 to C6 pass or are skipped;
// C7 to C9 only warn.

import { printRatio } from './calibrate'
import { isPreliminary, type PageText } from './classify'
import type { RoofPlanTakeoff } from './schema'

export type CheckId = 'C1' | 'C2' | 'C3' | 'C4' | 'C5' | 'C6' | 'C7' | 'C8' | 'C9' | 'C10'
export type CheckResult = { id: CheckId; result: 'pass' | 'warning' | 'fail' | 'skipped'; detail: string; evidence?: { file: string; page: number } }
/** The checks as stored on the run. `schedule` is the area schedule C3 read
 *  from the drawings, kept so a correction can re-run the checks without
 *  opening the plans again (TKO-14). */
export type Checks = { version: 1; ran_at: string; status: 'ready' | 'needs_review'; results: CheckResult[]; schedule: ScheduleLine[] }
/** One line of an area schedule on the drawings, such as a footprint. */
export type ScheduleLine = { label: string; m2: number; file: string; page: number }
export type CheckContext = { scopeNote: string | null; schedule: ScheduleLine[] }

type Takeoff = RoofPlanTakeoff
const planesOf = (t: Takeoff) => t.structures.flatMap((s) => s.planes)
const off = (a: number, b: number) => Math.abs(a / b - 1) * 100
const m2 = (n: number) => `${Math.round(n * 100) / 100} m²`
const list = (items: string[]) => (items.length < 3 ? items.join(' and ') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`)

/** C1: a written dimension matches the scaled geometry within 1%. */
export function scaleCalibrated(t: Takeoff): CheckResult {
  const { calibration: c, stated, sheet_size, pdf_page } = t.scale
  const ratio = printRatio(sheet_size, pdf_page)
  const printed = Math.abs(ratio - 1) > 0.02 ? ` (an ${sheet_size} sheet printed at ${Math.round(ratio * 100)}% size)` : ''
  if (c.method === 'dimension_string' && (c.delta_pct === null || Math.abs(c.delta_pct) <= 1)) {
    return { id: 'C1', result: 'pass', detail: `The written ${c.reference_mm} mm dimension confirms ${stated ?? 'the scale'}: ${c.factor} mm a point${c.delta_pct === null ? '' : ` (${c.delta_pct}%)`}.` }
  }
  if (c.method === 'dimension_string') {
    return { id: 'C1', result: 'fail', detail: `Written dimensions give ${c.factor} mm a point, ${c.delta_pct}% off the stated ${stated}${printed}.` }
  }
  if (c.method === 'title_block') {
    return { id: 'C1', result: 'fail', detail: `No written dimension could be measured to confirm the stated ${stated}${printed}.` }
  }
  return { id: 'C1', result: 'fail', detail: 'The drawings state no scale, and no written dimension could be measured.' }
}

/** Polygon area in m² from corners in millimetres. */
const polygonArea = (corners: [number, number][]) =>
  Math.abs(corners.reduce((sum, [x, y], i) => {
    const [nx, ny] = corners[(i + 1) % corners.length]
    return sum + x * ny - nx * y
  }, 0)) / 2 / 1e6

/** C2: each plane's dimensions agree with its area within 3%. */
export function dimensionsConsistent(t: Takeoff): CheckResult {
  const problems: string[] = []
  let compared = 0
  for (const p of planesOf(t)) {
    if (p.plan_area_m2 === null) continue
    const sizes: Array<[string, number]> = []
    if (p.plan_dims_mm) sizes.push([`${p.plan_dims_mm[0]} × ${p.plan_dims_mm[1]} mm`, (p.plan_dims_mm[0] * p.plan_dims_mm[1]) / 1e6])
    if (p.polygon_mm && p.polygon_mm.length >= 3) sizes.push(['its outline', polygonArea(p.polygon_mm)])
    for (const [what, area] of sizes) {
      compared++
      if (off(p.plan_area_m2, area) > 3) problems.push(`${p.id}: ${what} is ${m2(area)}, but its area is ${m2(p.plan_area_m2)} (${off(p.plan_area_m2, area).toFixed(1)}%)`)
    }
  }
  if (!compared) return { id: 'C2', result: 'skipped', detail: 'No plane has a size or outline to compare with its area.' }
  if (problems.length) return { id: 'C2', result: 'fail', detail: `${problems.join('. ')}.` }
  return { id: 'C2', result: 'pass', detail: `Each plane's dimensions agree with its area within 3% (${compared} compared).` }
}

/** How far C3 lets the planes stray from the schedule's footprint, in %. */
export const SCHEDULE_PCT = 2
/** The schedule line C3 reconciles against, which the reader checks itself by
 *  too (TKO-15). Like with like (DEC-012): a carport or deck line is an outline
 *  to the gutter, not sheeted area, so only footprint and roof-area lines count. */
export const footprintLine = (schedule: ScheduleLine[]) => schedule.find((l) => /FOOTPRINT|ROOF\s+AREA/i.test(l.label) && !/EXISTING/i.test(l.label))

/** C3: where the drawings state a roof footprint or area, the takeoff is
 *  within 2%. */
export function scheduleReconciles(t: Takeoff, ctx: CheckContext): CheckResult {
  const line = footprintLine(ctx.schedule)
  if (!line) return { id: 'C3', result: 'skipped', detail: 'No area schedule on the drawings states a roof footprint.' }
  const planes = planesOf(t)
  if (!planes.length || planes.some((p) => p.plan_area_m2 === null)) {
    return { id: 'C3', result: 'skipped', detail: `The plane areas are incomplete (C5), so they can't be set against the ${m2(line.m2)} ${line.label.toLowerCase()}.`, evidence: { file: line.file, page: line.page } }
  }
  const total = planes.reduce((sum, p) => sum + (p.plan_area_m2 ?? 0), 0)
  const detail = `${m2(total)} on plan against the schedule's ${m2(line.m2)} ${line.label.toLowerCase()} (${off(total, line.m2).toFixed(1)}%).`
  return { id: 'C3', result: off(total, line.m2) <= SCHEDULE_PCT ? 'pass' : 'fail', detail, evidence: { file: line.file, page: line.page } }
}

// Lowest published pitch per profile (manufacturers' figures, Lysaght and Stramit).
const PROFILE_MIN: Array<[RegExp, number, string]> = [
  [/custom\s*orb|corrugat/i, 5, 'Custom Orb'],
  [/spandek/i, 3, 'Spandek'],
  [/trimdek|monoclad/i, 2, 'Trimdek'],
  [/klip-?lok|longline|speed\s*deck/i, 1, 'Klip-Lok'],
  [/\btiles?\b/i, 15, 'Tile'],
]

/** C4: pitch between 1° and 45°, and at or above the profile's minimum. */
export function pitchPlausible(t: Takeoff): CheckResult {
  const judged = planesOf(t).filter((p) => p.pitch_deg !== null)
  if (!judged.length) return { id: 'C4', result: 'skipped', detail: 'No plane has a pitch to judge (C5).' }
  const problems: string[] = []
  for (const p of judged) {
    const pitch = p.pitch_deg as number
    if (pitch < 1 || pitch > 45) problems.push(`${p.id} at ${pitch}° is outside 1° to 45°`)
    const min = PROFILE_MIN.find(([pattern]) => pattern.test(p.profile ?? ''))
    if (min && pitch < min[1]) problems.push(`${p.id}: ${min[2]} at ${pitch}° is under its ${min[1]}° minimum`)
  }
  if (problems.length) return { id: 'C4', result: 'fail', detail: `${problems.join('. ')}.` }
  return { id: 'C4', result: 'pass', detail: "Every pitch is between 1° and 45°, and at or above its profile's published minimum." }
}

/** C5: every plane has an area, a pitch and a profile. */
export function complete(t: Takeoff): CheckResult {
  const planes = planesOf(t)
  if (!planes.length) return { id: 'C5', result: 'fail', detail: 'The takeoff has no roof planes.' }
  const missing = planes.flatMap((p) => {
    const gaps = [p.plan_area_m2 === null && 'area', p.pitch_deg === null && 'pitch', p.profile === null && 'profile'].filter(Boolean) as string[]
    return gaps.length ? [`${p.id} has no ${list(gaps)}`] : []
  })
  if (missing.length) return { id: 'C5', result: 'fail', detail: `${missing.join('; ')}.` }
  return { id: 'C5', result: 'pass', detail: 'Every plane has an area, a pitch and a profile.' }
}

const STOP = new Set(['roof', 'roofs', 'over', 'with', 'from', 'that', 'this', 'their', 'area', 'areas', 'exclude', 'excluded', 'the'])
const words = (text: string) => new Set(text.toLowerCase().match(/[a-z]{4,}/g)?.filter((w) => !STOP.has(w)) ?? [])

// A scope note's clause that takes something out, such as Whittaker's
// "exclude the insulated roof over the new deck".
const EXCLUDING = /\b(exclud\w*|not included|by others|omit\w*)\b/i

/** The clauses of a scope note that exclude something. */
export const exclusionsAsked = (note: string | null) =>
  (note ?? '').split(/[.;\n,]/).map((clause) => clause.trim()).filter((clause) => EXCLUDING.test(clause))

/** C6: each exclusion the scope note makes is matched to a roof taken out of
 *  the totals. The note decides what is excluded, not the reading's
 *  scope.excludes, which also lists site context such as a neighbour's house
 *  (DEC-021). */
export function exclusionsApplied(t: Takeoff, ctx: CheckContext): CheckResult {
  const excluded = t.structures.flatMap((s) => s.exclusions)
  const asked = exclusionsAsked(ctx.scopeNote)
  if (!asked.length) {
    const detail = excluded.length ? `Excluded from the totals: ${list(excluded.map((e) => e.label))}.` : 'The request lists no exclusions.'
    return { id: 'C6', result: 'pass', detail }
  }
  const unmatched = asked.filter((x) => {
    const want = words(x)
    return !excluded.some((e) => [...words(`${e.label} ${e.reason}`)].some((w) => want.has(w)))
  })
  if (unmatched.length) return { id: 'C6', result: 'fail', detail: `Not matched to an excluded roof: ${unmatched.map((x) => `"${x}"`).join(', ')}.` }
  return { id: 'C6', result: 'pass', detail: `Excluded from the totals: ${list(excluded.map((e) => e.label))}.` }
}

/** C7: no plane below medium confidence. Warns only. */
export function confidence(t: Takeoff): CheckResult {
  const low = planesOf(t).filter((p) => p.confidence === 'low').map((p) => p.id)
  if (low.length) return { id: 'C7', result: 'warning', detail: `Low confidence: ${list(low)}.` }
  return { id: 'C7', result: 'pass', detail: 'No plane is below medium confidence.' }
}

/** C8: no sheet marked preliminary or not for construction. Warns only. */
export function drawingStatus(t: Takeoff): CheckResult {
  const marked = t.sheets.filter((s) => isPreliminary(s.status_text))
  if (marked.length) {
    const byStatus = new Map<string, string[]>()
    for (const s of marked) byStatus.set(s.status_text as string, [...(byStatus.get(s.status_text as string) ?? []), s.number ?? `${s.file} page ${s.page}`])
    const detail = [...byStatus].map(([status, sheets]) => `${list(sheets)} marked ${status}`).join('; ')
    return { id: 'C8', result: 'warning', detail: `${detail}. Confirm the current revision with the builder.`, evidence: { file: marked[0].file, page: marked[0].page } }
  }
  const statuses = [...new Set(t.sheets.map((s) => s.status_text).filter(Boolean))]
  return { id: 'C8', result: 'pass', detail: statuses.length ? `The drawings are ${list(statuses as string[])}.` : 'No sheet is marked preliminary.' }
}

/** C9: the roofs read match what the request asks for. Warns only. */
export function structureCount(t: Takeoff, ctx: CheckContext): CheckResult {
  const count = t.structures.filter((s) => s.planes.length).length
  if (!count) return { id: 'C9', result: 'warning', detail: 'No roof was read from the plans.' }
  const stages = new Set(t.sheets.flatMap((s) => [...(s.title ?? '').matchAll(/\bSTAGE\s+(\d+)/gi)].map((m) => m[1])))
  if (stages.size > 1 && !/\bstages?\b/i.test(ctx.scopeNote ?? '')) {
    return { id: 'C9', result: 'warning', detail: `The drawings show ${count} roofs over ${stages.size} stages, and the request doesn't say which stages to price.` }
  }
  return { id: 'C9', result: 'pass', detail: `${count} roof${count === 1 ? '' : 's'} read.` }
}

/** C10: a roof measured from aerial data (TKO-21) agrees with the plan area
 *  the drawings gave it, within 5%. A warning, so it never blocks a run. */
function aerialAgrees(t: Takeoff): CheckResult {
  const merged = t.structures.filter((s) => s.aerial)
  if (!merged.length) return { id: 'C10', result: 'skipped', detail: 'No roof was measured from aerial data.' }
  const apart = merged.flatMap((s) => {
    const { drawn_plan_m2: drawn, footprint_m2: aerial } = s.aerial!
    if (!drawn) return []
    const pct = off(aerial, drawn)
    return pct > 5 ? [`${s.label}: ${m2(aerial)} from aerial data against ${m2(drawn)} drawn (${Math.round(pct)}%)`] : []
  })
  if (apart.length) return { id: 'C10', result: 'warning', detail: `${apart.join('. ')}. Check which roofs stand already.` }
  return { id: 'C10', result: 'pass', detail: `Measured from aerial data: ${list(merged.map((s) => s.label))}.` }
}

/** Runs C1 to C10 and sets the status: ready unless C1 to C6 has a failure. */
export function runChecks(t: Takeoff, ctx: CheckContext, now = new Date()): Checks {
  const results = [
    scaleCalibrated(t), dimensionsConsistent(t), scheduleReconciles(t, ctx), pitchPlausible(t), complete(t),
    exclusionsApplied(t, ctx), confidence(t), drawingStatus(t), structureCount(t, ctx), aerialAgrees(t),
  ]
  const blocking = results.slice(0, 6).some((r) => r.result === 'fail')
  return { version: 1, ran_at: now.toISOString(), status: blocking ? 'needs_review' : 'ready', results, schedule: ctx.schedule }
}

const AREA = /^(\d+(?:\.\d+)?)\s*M(?:²|2)?$/i

/** A sheet's area schedule, if it has one: each line's label and m². A label
 *  that wraps carries on in the lines below it that have no value. */
export function areaSchedule(page: PageText, file: string, pageNumber: number): ScheduleLine[] {
  const heading = page.runs.find((r) => /AREA\s+SCHEDULE/i.test(r.text))
  if (!heading) return []
  const near = page.runs.filter((r) => r.y > heading.y && r.y < heading.y + 0.3 * page.height && Math.abs(r.x - heading.x) < 0.25 * page.width)
  const values = near.filter((r) => AREA.test(r.text))
  const hasValue = (r: { y: number }) => values.some((v) => Math.abs(v.y - r.y) <= 0.5 * v.size)
  const lines: ScheduleLine[] = []
  for (const value of values) {
    const label = near
      .filter((r) => r.x2 < value.x && Math.abs(r.y - value.y) <= 0.5 * value.size && !/^\d/.test(r.text))
      .sort((a, b) => a.x - b.x)[0]
    if (!label) continue
    const parts = [label.text]
    for (let last = label; ;) {
      const next = near.find((r) => r !== last && Math.abs(r.x - label.x) < 2 && r.y > last.y && r.y - last.y <= 1.5 * last.size && !hasValue(r))
      if (!next) break
      parts.push(next.text)
      last = next
    }
    lines.push({ label: parts.join(' '), m2: Number(value.text.match(AREA)?.[1]), file, page: pageNumber })
  }
  return lines
}
