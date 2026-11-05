// The calibrate stage's work without the database (TKO-12, TKO-29): each
// chosen plan sheet's scale is checked against its own drawings, the best
// supported scale goes into the reading, and the roofs the drawings don't
// dimension are scaled from their outlines. The stage and the eval share it,
// so the eval scores a reading as the pipeline finishes it.

import { calibrateSheet, chooseScale, pageSegments, type SheetScale } from './calibrate'
import { MIN_PAGE_TEXT, pageText, statedScale, type Sheet } from './classify'
import { measureOutlines, type MeasuredSheet } from './outline'
import { RoofPlanTakeoffSchema, type RoofPlanTakeoff } from './schema'

/** The chosen sheets that are plans, which calibration and measuring use. */
export const planSheets = (sheets: Sheet[]) =>
  sheets.filter((s) => s.used && (s.kind === 'roof_plan' || s.kind === 'site_plan'))

/** `files` holds each plan file's bytes by filename; pdf.js may take them over. */
export async function refineReading(reading: RoofPlanTakeoff, input: { sheets: Sheet[]; files: Map<string, Uint8Array> }) {
  const plans = planSheets(input.sheets)
  // A sheet that states no scale falls back on the scale the model read.
  const read = reading.scale
  const readScale = read.stated && (read.sheet_size && !read.stated.includes(read.sheet_size) ? `${read.stated} @ ${read.sheet_size}` : read.stated)

  const { getDocumentProxy } = await import('unpdf')
  const scales: SheetScale[] = []
  const measurable: MeasuredSheet[] = []
  for (const [file, bytes] of input.files) {
    const mine = plans.filter((s) => s.file === file)
    if (!mine.length) continue
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
    } finally {
      await pdf.destroy()
    }
  }
  const scale = chooseScale(scales)
  const { takeoff, measured } = measureOutlines(scale ? { ...reading, scale } : reading, measurable)
  return {
    takeoff: RoofPlanTakeoffSchema.parse(takeoff),
    changed: scale !== null || measured > 0,
    sheets: scales.length,
    measured,
  }
}
