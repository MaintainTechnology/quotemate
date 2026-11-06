// TKO-12's done-when: the scale factor is within 1% on Grange, and on the
// Whittaker deck dimension. No model: calibration reads the drawings' own text
// and lines. It skips where the PDFs (client documents, kept out of git) are
// not on disk.

import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { calibrateSheet, chooseScale, pageSegments, type SheetScale } from './calibrate'
import { pageText, statedScale, type Sheet } from './classify'

const MM_PER_PT = 25.4 / 72
const GRANGE = 'J14997-59-Grange-Rd'
const WHITTAKER = 'J14945-5-Whittaker-St'
const WHITTAKER_PLAN = 'Floor plan - 5 Whittaker street north Ipswich .pdf'
const pdfPath = (folder: string, file: string) => `docs/tag-roofing-requests/${folder}/${file}`

/** The run scale the calibrate stage would choose from the fixture's chosen plan sheets. */
async function calibrateFixture(fixture: string, folder: string) {
  const { getDocumentProxy } = await import('unpdf')
  const sheets: Sheet[] = JSON.parse(readFileSync(`eval/roof-takeoff/${fixture}/sheets.json`, 'utf8')).sheets
  const plans = sheets.filter((s) => s.used && (s.kind === 'roof_plan' || s.kind === 'site_plan'))
  const results: SheetScale[] = []
  for (const file of new Set(plans.map((s) => s.file))) {
    const pdf = await getDocumentProxy(new Uint8Array(readFileSync(pdfPath(folder, file))))
    for (const sheet of plans.filter((s) => s.file === file)) {
      const text = await pageText(pdf, sheet.page)
      results.push(calibrateSheet({ page: text, segments: await pageSegments(pdf, sheet.page), stated: statedScale(text) }))
    }
    await pdf.destroy()
  }
  return chooseScale(results)
}

describe.skipIf(!existsSync(pdfPath(GRANGE, 'Architectural - 59 Grange Rd, Eastern Heights (4) Compressed.pdf')))('Grange calibration', () => {
  it('is confirmed by its written dimensions within 1% of 1:100 at A1', async () => {
    const scale = await calibrateFixture('grange', GRANGE)
    expect(scale).toMatchObject({ stated: '1:100 @ A1', calibration: { method: 'dimension_string' } })
    expect(Math.abs(scale!.calibration.factor! / (100 * MM_PER_PT) - 1)).toBeLessThan(0.01)
  }, 120_000)
})

// TAG's resend carries the same drawings with Hall's /Rotate lost: read the
// way it reads, it calibrates as the original, its lines where they were.
describe.each([
  ['Whittaker calibration', WHITTAKER],
  ["Whittaker calibration, as TAG's resend carries it", `${WHITTAKER}-resend`],
])('%s', (_name, folder) => {
  it.skipIf(!existsSync(pdfPath(folder, WHITTAKER_PLAN)))('takes 1:50 at A1 printed on A3, and the deck dimension bears it out within 1%', async () => {
    const scale = await calibrateFixture('whittaker', folder)
    expect(scale).toMatchObject({ stated: '1:50 @ A1', sheet_size: 'A1', calibration: { method: 'title_block' } })

    // The deck's west side is dimensioned 6907, drawn as outlines, so no text
    // pairs with it. Read off a render of A104: its extension lines cross the
    // dimension line (x 47.04 pt) at y 238.9 and 434.6.
    const { getDocumentProxy } = await import('unpdf')
    const pdf = await getDocumentProxy(new Uint8Array(readFileSync(pdfPath(folder, WHITTAKER_PLAN))))
    const crossings = (await pageSegments(pdf, 1))
      .filter(([x1, y1, x2, y2]) => Math.abs(y1 - y2) < 0.3 && Math.min(x1, x2) <= 47.54 && Math.max(x1, x2) >= 46.54)
      .map(([, y1, , y2]) => (y1 + y2) / 2)
    await pdf.destroy()
    const top = crossings.find((y) => Math.abs(y - 238.9) < 0.5)
    const bottom = crossings.find((y) => Math.abs(y - 434.6) < 0.5)
    expect(top && bottom).toBeTruthy()
    expect(Math.abs(6907 / (bottom! - top!) / scale!.calibration.factor! - 1)).toBeLessThan(0.01)
  }, 120_000)
})
