// The calibrate stage's work without the database (TKO-12, TKO-29, TKO-15,
// TKO-30): each chosen plan sheet's scale is checked against its own drawings,
// the best supported scale goes into the reading, the roofs the drawings don't
// dimension are scaled from their outlines, the planes they give no pitch take
// one from an elevation's roof lines, a hip roof is measured from its drawn
// hips and ridges, and each skillion's edges are worked out from its size.
// The stage and the eval share it, so the eval scores a reading as the
// pipeline finishes it.

import type { generateText } from 'ai'
import { calibrateSheet, chooseScale, pageSegments, type SheetScale } from './calibrate'
import { MIN_PAGE_TEXT, pageText, readingViewport, statedScale, type Sheet } from './classify'
import { skillionEdges } from './edges'
import { measureHipRoofs } from './hips'
import { measureOutlines } from './outline'
import { elevationPitches, familyPitches, pitchFromElevations, type ElevationPitch } from './pitch'
import { measureRegions, type PlanSheet } from './regions'
import { RoofPlanTakeoffSchema, type RoofPlanTakeoff } from './schema'

/** The chosen sheets that are plans, which calibration and measuring use. */
export const planSheets = (sheets: Sheet[]) =>
  sheets.filter((s) => s.used && (s.kind === 'roof_plan' || s.kind === 'site_plan'))

/** The chosen sheets that are elevations, whose roof lines give pitches (TKO-30). */
export const elevationSheets = (sheets: Sheet[]) => sheets.filter((s) => s.used && s.kind === 'elevation')

/** `files` holds each plan file's bytes by filename; pdf.js may take them over.
 *  Given `assign`, roofs still unsized after the hip roof take the rib areas
 *  the model assigns on a numbered copy of their sheet (DEC-047). */
export async function refineReading(reading: RoofPlanTakeoff, input: {
  sheets: Sheet[]
  files: Map<string, Uint8Array>
  scopeNote?: string | null
  assign?: typeof generateText
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
    // A copy for numbering the sheet's roof areas, as pdf.js may take the bytes over.
    const original = input.assign && mine.length ? bytes.slice() : new Uint8Array()
    const pdf = await getDocumentProxy(bytes)
    try {
      for (const sheet of mine) {
        const text = await pageText(pdf, sheet.page)
        if (text.chars < MIN_PAGE_TEXT) continue // a scan: no lines to measure
        const segments = await pageSegments(pdf, sheet.page)
        const scale = calibrateSheet({ page: text, segments, stated: statedScale(text) ?? readScale })
        scales.push(scale)
        const { factor } = scale.calibration
        const page = input.assign ? await pdf.getPage(sheet.page) : null
        const transform = page ? readingViewport(page, (await page.getTextContent()).items).viewport.transform : []
        if (factor) measurable.push({ file, page: sheet.page, text, segments, factor, transform, bytes: original })
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
  // The roofs joined to the hip roof, a lean-to each, at the shallowest pitch the elevation gives.
  const families = pitches ? familyPitches(pitches.found) : []
  const shallow = families.length ? Math.min(...families) : null
  const regions = input.assign && outlined.measured === 0
    ? await measureRegions(hips.takeoff, { reading, sheets: measurable, scopeNote: input.scopeNote ?? null, pitch: shallow, generate: input.assign })
    : { takeoff: hips.takeoff, regioned: 0, usage: null, refused: null }
  const { takeoff, derived } = skillionEdges(regions.takeoff)
  return {
    takeoff: RoofPlanTakeoffSchema.parse(takeoff),
    changed: scale !== null || outlined.measured > 0 || pitched.pitched > 0 || hips.hipped > 0 || regions.regioned > 0 || derived > 0,
    sheets: scales.length,
    measured: outlined.measured,
    pitched: pitched.pitched,
    hipped: hips.hipped,
    regioned: regions.regioned,
    refused: regions.refused,
    usage: regions.usage,
    derived,
  }
}
