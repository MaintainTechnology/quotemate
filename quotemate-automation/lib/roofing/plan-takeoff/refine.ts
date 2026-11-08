// The calibrate stage's work without the database (TKO-12, TKO-29, TKO-15,
// TKO-30): each chosen plan sheet's scale is checked against its own drawings,
// the best supported scale goes into the reading, the roofs the drawings don't
// dimension are scaled from their outlines, the planes they give no pitch take
// one from an elevation's roof lines, a hip roof is measured from its drawn
// hips and ridges, and each skillion's edges are worked out from its size.
// Roofs the drawings leave unmeasured beside a hip roof come back as numbered
// areas for the operator to answer (TKO-30, DEC-048).
// The stage and the eval share it, so the eval scores a reading as the
// pipeline finishes it.

import type { generateText } from 'ai'
import { calibrateSheet, chooseScale, pageSegments, type SheetScale } from './calibrate'
import { MIN_PAGE_TEXT, pageText, readingViewport, statedScale, type Sheet } from './classify'
import { skillionEdges } from './edges'
import { measureHipRoofs } from './hips'
import { measureOutlines } from './outline'
import { elevationPitches, familyPitches, pitchFromElevations, type ElevationPitch } from './pitch'
import type { ModelUsage } from './read'
import { findRegions, numberedPlan, suggestRegions, type FoundRegions, type PlanSheet, type RunRegions } from './regions'
import { RoofPlanTakeoffSchema, type RoofPlanTakeoff } from './schema'

/** The chosen sheets that are plans, which calibration and measuring use. */
export const planSheets = (sheets: Sheet[]) =>
  sheets.filter((s) => s.used && (s.kind === 'roof_plan' || s.kind === 'site_plan'))

/** The chosen sheets that are elevations, whose roof lines give pitches (TKO-30). */
export const elevationSheets = (sheets: Sheet[]) => sheets.filter((s) => s.used && s.kind === 'elevation')

/** A run's numbered roof areas as the calibrate stage keeps them, with the
 *  numbered plan the operator reads them from. */
export type RefinedRegions = { stored: RunRegions; plan: Uint8Array }

/** `files` holds each plan file's bytes by filename; pdf.js may take them
 *  over. Roofs the reading left unsized beside a hip roof come back as
 *  `regions`, with the reader's suggestion when `suggest` is given; nothing is
 *  measured from them until the operator answers (DEC-048). */
export async function refineReading(reading: RoofPlanTakeoff, input: {
  sheets: Sheet[]
  files: Map<string, Uint8Array>
  scopeNote?: string | null
  suggest?: typeof generateText
}) {
  const plans = planSheets(input.sheets)
  const elevations = elevationSheets(input.sheets)
  // A sheet that states no scale falls back on the scale the model read.
  const read = reading.scale
  const readScale = read.stated && (read.sheet_size && !read.stated.includes(read.sheet_size) ? `${read.stated} @ ${read.sheet_size}` : read.stated)

  const { getDocumentProxy } = await import('unpdf')
  const scales: SheetScale[] = []
  const measurable: PlanSheet[] = []
  // The elevation whose roof lines are best supported, of those chosen.
  let pitches: { found: ElevationPitch[]; support: number; sheet: { file: string; page: number } } | null = null
  for (const [file, bytes] of input.files) {
    const mine = plans.filter((s) => s.file === file)
    const drawn = elevations.filter((s) => s.file === file)
    if (!mine.length && !drawn.length) continue
    // A copy for numbering a plan's roof areas, as pdf.js takes the bytes over.
    const original = mine.length ? bytes.slice() : new Uint8Array()
    const pdf = await getDocumentProxy(bytes)
    try {
      for (const sheet of mine) {
        const text = await pageText(pdf, sheet.page)
        if (text.chars < MIN_PAGE_TEXT) continue // a scan: no lines to measure
        const segments = await pageSegments(pdf, sheet.page)
        const scale = calibrateSheet({ page: text, segments, stated: statedScale(text) ?? readScale })
        scales.push(scale)
        const { factor } = scale.calibration
        if (!factor) continue
        // The viewport the strokes were read in, which numbering draws back through.
        const page = await pdf.getPage(sheet.page)
        const { transform } = readingViewport(page, (await page.getTextContent()).items).viewport
        measurable.push({ file, page: sheet.page, text, segments, factor, transform, bytes: original })
      }
      // An elevation needs no text, only its strokes: Whittaker's lettering is
      // drawn as outlines, and a scan has no strokes to find.
      for (const sheet of drawn) {
        const found = elevationPitches(await pageSegments(pdf, sheet.page))
        const support = found.reduce((sum, f) => sum + f.support, 0)
        if (found.length && support > (pitches?.support ?? 0)) pitches = { found, support, sheet: { file, page: sheet.page } }
      }
    } finally {
      await pdf.destroy()
    }
  }
  const scale = chooseScale(scales)
  const outlined = measureOutlines(scale ? { ...reading, scale } : reading, measurable)
  // A pitch before the edges, which run down a skillion, and along a hip
  // roof's hips and valleys, at its pitch.
  const pitched = pitches ? pitchFromElevations(outlined.takeoff, pitches.found, pitches.sheet) : { takeoff: outlined.takeoff, pitched: 0 }
  const hips = measureHipRoofs(pitched.takeoff, measurable)
  const { takeoff, derived } = skillionEdges(hips.takeoff)
  // Roofs still unmeasured beside a hip roof, numbered for the operator. A
  // reading whose roofs TKO-29 found by their tags, as Grange's, needs none.
  const found = outlined.measured === 0 ? findRegions(reading, measurable) : null
  const numbered = found ? await numberRegions(found, takeoff, pitches ? familyPitches(pitches.found) : [], input) : null
  return {
    takeoff: RoofPlanTakeoffSchema.parse(takeoff),
    changed: scale !== null || outlined.measured > 0 || pitched.pitched > 0 || hips.hipped > 0 || derived > 0,
    sheets: scales.length,
    measured: outlined.measured,
    pitched: pitched.pitched,
    hipped: hips.hipped,
    derived,
    regions: numbered?.regions ?? null,
    /** The suggestion's model use, or null when there was no call. */
    usage: numbered?.usage ?? null,
  }
}

/** The found areas as the run keeps them, numbered on a copy of their sheet,
 *  with the reader's suggestion when `suggest` is given. A sheet pdf-lib can't
 *  copy gives none: the run then reads as it did before TKO-30. */
async function numberRegions(found: FoundRegions, takeoff: RoofPlanTakeoff, families: number[], input: { scopeNote?: string | null; suggest?: typeof generateText }) {
  let plan: Uint8Array
  try {
    plan = await numberedPlan(found.sheet.bytes, found.sheet.page, found.sheet.transform, found.areas)
  } catch {
    return null
  }
  const suggestion: { suggested: RunRegions['suggested']; note: string | null; usage: ModelUsage | null } = input.suggest
    ? await suggestRegions(found, { takeoff, plan: plan.slice(), scopeNote: input.scopeNote ?? null, generate: input.suggest })
    : { suggested: null, note: null, usage: null }
  const stored: RunRegions = {
    sheet: { file: found.sheet.file, page: found.sheet.page },
    factor: found.sheet.factor,
    pitch: families.length ? Math.min(...families) : null,
    houses: found.houses,
    areas: found.areas,
    roofs: found.roofs,
    suggested: suggestion.suggested,
    note: suggestion.note,
    confirmed: null,
    before: null,
  }
  return { regions: { stored, plan } satisfies RefinedRegions, usage: suggestion.usage }
}
