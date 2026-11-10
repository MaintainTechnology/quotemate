// The calibrate stage's work without the database (TKO-12, TKO-29, TKO-15,
// TKO-30): each chosen plan sheet's scale is checked against its own drawings,
// the best supported scale goes into the reading, the roofs the drawings don't
// dimension are scaled from their outlines, the planes they give no pitch take
// one from an elevation's roof lines, and each skillion's edges are worked out
// from its size. The stage and the eval share it, so the eval scores a reading
// as the pipeline finishes it.

import { calibrateSheet, chooseScale, pageSegments, type SheetScale } from './calibrate'
import { MIN_PAGE_TEXT, pageText, statedScale, type Sheet } from './classify'
import { skillionEdges } from './edges'
import { measureOutlines, type MeasuredSheet } from './outline'
import { elevationPitches, pitchFromElevations, type ElevationPitch } from './pitch'
import { RoofPlanTakeoffSchema, type RoofPlanTakeoff } from './schema'

/** The chosen sheets that are plans, which calibration and measuring use. */
export const planSheets = (sheets: Sheet[]) =>
  sheets.filter((s) => s.used && (s.kind === 'roof_plan' || s.kind === 'site_plan'))

/** The chosen sheets that are elevations, whose roof lines give pitches (TKO-30). */
export const elevationSheets = (sheets: Sheet[]) => sheets.filter((s) => s.used && s.kind === 'elevation')

/** `files` holds each plan file's bytes by filename; pdf.js may take them over. */
export async function refineReading(reading: RoofPlanTakeoff, input: { sheets: Sheet[]; files: Map<string, Uint8Array> }) {
  const plans = planSheets(input.sheets)
  const elevations = elevationSheets(input.sheets)
  // A sheet that states no scale falls back on the scale the model read.
  const read = reading.scale
  const readScale = read.stated && (read.sheet_size && !read.stated.includes(read.sheet_size) ? `${read.stated} @ ${read.sheet_size}` : read.stated)

  const { getDocumentProxy } = await import('unpdf')
  const scales: SheetScale[] = []
  const measurable: MeasuredSheet[] = []
  // The elevation whose roof lines are best supported, of those chosen.
  let pitches: { found: ElevationPitch[]; support: number; sheet: { file: string; page: number } } | null = null
  for (const [file, bytes] of input.files) {
    const mine = plans.filter((s) => s.file === file)
    const drawn = elevations.filter((s) => s.file === file)
    if (!mine.length && !drawn.length) continue
    const pdf = await getDocumentProxy(bytes)
    try {
      for (const sheet of mine) {
        const text = await pageText(pdf, sheet.page)
        if (text.chars < MIN_PAGE_TEXT) continue // a scan: no lines to measure
        const segments = await pageSegments(pdf, sheet.page)
        const scale = calibrateSheet({ page: text, segments, stated: statedScale(text) ?? readScale })
        scales.push(scale)
        const { factor } = scale.calibration
        if (factor) measurable.push({ file, page: sheet.page, text, segments, factor })
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
  // A pitch before the edges, which run down a skillion along its pitch.
  const pitched = pitches ? pitchFromElevations(outlined.takeoff, pitches.found, pitches.sheet) : { takeoff: outlined.takeoff, pitched: 0 }
  const { takeoff, derived } = skillionEdges(pitched.takeoff)
  return {
    takeoff: RoofPlanTakeoffSchema.parse(takeoff),
    changed: scale !== null || outlined.measured > 0 || pitched.pitched > 0 || derived > 0,
    sheets: scales.length,
    measured: outlined.measured,
    pitched: pitched.pitched,
    derived,
  }
}
