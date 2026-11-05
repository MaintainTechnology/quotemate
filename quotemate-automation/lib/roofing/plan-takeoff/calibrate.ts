// Scale calibration (TKO-12, P2 Reading §5). The scale a sheet states is
// checked against its own drawing: each written dimension (5310) is paired
// with the dimension line beneath it, measured between the tick marks that
// cross it, giving millimetres per PDF point. Two that
// agree within 1% calibrate the sheet. Where no written dimension pairs (text
// drawn as outlines, as on Whittaker), the stated scale stands, corrected for
// the size it was printed at: an A1 sheet printed on A3 is half size.

import type { PageText } from './classify'
import type { RoofPlanTakeoff } from './schema'

/** A straight stroke as printed, in points from the page's top-left. */
export type Segment = [x1: number, y1: number, x2: number, y2: number]
export type Calibration = RoofPlanTakeoff['scale']['calibration']
export type Scale = RoofPlanTakeoff['scale']
export type SheetScale = Scale & { support: number }

type PdfDocument = Awaited<ReturnType<typeof import('unpdf').getDocumentProxy>>
type Matrix = [number, number, number, number, number, number]

const multiply = (m: Matrix, n: number[]): Matrix => [
  m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
]
const apply = (m: Matrix, x: number, y: number) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]

/** The page's stroked straight lines as printed; curves are skipped. Reads
 *  pdf.js 5's operator list, where a path is codes (0 move, 1 line, 2 curve,
 *  3 quadratic, 4 close) under the transform in force. */
export async function pageSegments(pdf: PdfDocument, pageNumber: number): Promise<Segment[]> {
  const { getResolvedPDFJS } = await import('unpdf')
  const { OPS } = await getResolvedPDFJS()
  const stroked = new Set([OPS.stroke, OPS.closeStroke, OPS.fillStroke, OPS.eoFillStroke, OPS.closeFillStroke, OPS.closeEOFillStroke])
  const page = await pdf.getPage(pageNumber)
  try {
    const { fnArray, argsArray } = await page.getOperatorList()
    let ctm = page.getViewport({ scale: 1 }).transform as Matrix
    const saved: Matrix[] = []
    const segments: Segment[] = []
    for (let i = 0; i < fnArray.length; i++) {
      const fn = fnArray[i]
      const args = argsArray[i]
      if (fn === OPS.save) saved.push(ctm)
      else if (fn === OPS.restore || fn === OPS.paintFormXObjectEnd) ctm = saved.pop() ?? ctm
      else if (fn === OPS.transform) ctm = multiply(ctm, args)
      else if (fn === OPS.paintFormXObjectBegin) {
        saved.push(ctm)
        if (args?.[0]) ctm = multiply(ctm, args[0])
      } else if (fn === OPS.constructPath && stroked.has(args[0]) && args[1]?.[0]?.length) {
        const path: ArrayLike<number> = args[1][0]
        let at: number[] | null = null
        let start: number[] | null = null
        for (let k = 0; k < path.length;) {
          const code = path[k++]
          if (code === 0) {
            at = start = apply(ctm, path[k], path[k + 1])
            k += 2
          } else if (code === 1) {
            const to = apply(ctm, path[k], path[k + 1])
            if (at) segments.push([at[0], at[1], to[0], to[1]])
            at = to
            k += 2
          } else if (code === 2) {
            at = apply(ctm, path[k + 4], path[k + 5])
            k += 6
          } else if (code === 3) {
            at = apply(ctm, path[k + 2], path[k + 3])
            k += 4
          } else if (code === 4) {
            if (at && start) segments.push([at[0], at[1], start[0], start[1]])
            at = start
          } else break
        }
      }
    }
    return segments
  } finally {
    page.cleanup()
  }
}

const MM_PER_PT = 25.4 / 72
// ISO A sheets, long side in millimetres.
const SHEET_MM: Record<string, number> = { A0: 1189, A1: 841, A2: 594, A3: 420, A4: 297 }

/** A stated scale such as "1:50 @ A1", "1 : 100" or "@ A1 1 : 50". */
export function parseScale(text: string | null): { denominator: number; sheet: string | null } | null {
  const ratio = text?.match(/\b1\s*:\s*(\d{1,4})\b/)
  if (!ratio) return null
  return { denominator: Number(ratio[1]), sheet: text?.toUpperCase().match(/\bA[0-4]\b/)?.[0] ?? null }
}

/** How big the page is against the sheet it was drawn on: 0.5 for an A1
 *  sheet printed on A3, 1 when no sheet size is stated. */
export function printRatio(sheet: string | null, page: [number, number]): number {
  const drawn = sheet ? SHEET_MM[sheet] : undefined
  return drawn ? (Math.max(...page) * MM_PER_PT) / drawn : 1
}

const DIMENSION = /^\d{3,5}$/
// At most this many dimension strings a page. A real sheet has tens; a page
// drawn to stall the stage has thousands (TKO-28).
const MAX_DIMENSIONS = 400
// A tick is a stroke shorter than this, in points.
const TICK_MAX = 20

/** The first index of `sorted` (ascending by `key`) whose key is at least `min`. */
function firstFrom<T>(sorted: T[], key: (item: T) => number, min: number): number {
  let lo = 0
  let hi = sorted.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (key(sorted[mid]) < min) lo = mid + 1
    else hi = mid
  }
  return lo
}

/** Millimetres per point from each written dimension with its dimension line
 *  beneath it, measured between the nearest tick marks either side. Ticks are
 *  short strokes across the line; a long line crossing it is the drawing.
 *  Lines and strokes are sorted by height once, so each string searches only
 *  its own band of the page: a page drawn to stall the stage costs a sort. */
export function dimensionRatios(page: PageText, segments: Segment[]): Array<{ mm: number; ratio: number }> {
  const flat = segments
    .filter(([x1, y1, x2, y2]) => Math.abs(y1 - y2) < 0.3 && Math.abs(x2 - x1) > 2)
    .map(([x1, y1, x2, y2]) => ({ x1: Math.min(x1, x2), x2: Math.max(x1, x2), y: (y1 + y2) / 2 }))
    .sort((a, b) => a.y - b.y)
  const strokes = segments
    .filter(([x1, y1, x2, y2]) => Math.abs(y2 - y1) > 1 && Math.hypot(x2 - x1, y2 - y1) < TICK_MAX)
    .map(([x1, y1, x2, y2]) => ({ x1, y1, x2, y2, low: Math.min(y1, y2), high: Math.max(y1, y2) }))
    .sort((a, b) => a.low - b.low)
  const ratios: Array<{ mm: number; ratio: number }> = []
  for (const run of page.runs.filter((r) => DIMENSION.test(r.text)).slice(0, MAX_DIMENSIONS)) {
    const centre = (run.x + run.x2) / 2
    // The highest line in the band under the text that spans it.
    let line: (typeof flat)[number] | undefined
    for (let i = firstFrom(flat, (s) => s.y, run.y - 0.5); i < flat.length && flat[i].y <= run.y + 1.5 * run.size; i++) {
      const s = flat[i]
      if (s.x1 <= centre && s.x2 >= centre && s.x2 - s.x1 > run.x2 - run.x) {
        line = s
        break
      }
    }
    if (!line) continue
    // The nearest tick either side of the text. A stroke crossing the line
    // starts at most TICK_MAX below it.
    let left = -Infinity
    let right = Infinity
    for (let i = firstFrom(strokes, (s) => s.low, line.y - 0.5 - TICK_MAX); i < strokes.length && strokes[i].low <= line.y + 0.5; i++) {
      const { x1, y1, x2, y2, high } = strokes[i]
      if (high < line.y - 0.5) continue
      const x = x1 + ((line.y - y1) * (x2 - x1)) / (y2 - y1)
      if (x < centre - 1 && x >= line.x1 - 1) left = Math.max(left, x)
      if (x > centre + 1 && x <= line.x2 + 1) right = Math.min(right, x)
    }
    if (Number.isFinite(left) && Number.isFinite(right)) ratios.push({ mm: Number(run.text), ratio: Number(run.text) / (right - left) })
  }
  return ratios
}

const round = (n: number, places: number) => Math.round(n * 10 ** places) / 10 ** places || 0 // never -0

/** One sheet's scale: confirmed by its written dimensions where two agree
 *  within 1%, otherwise as stated and corrected for print size. `support` is
 *  how many dimensions agreed. */
export function calibrateSheet(input: { page: PageText; segments: Segment[]; stated: string | null }): SheetScale {
  const pdfPage: [number, number] = [round(input.page.width, 2), round(input.page.height, 2)]
  const stated = parseScale(input.stated)
  const expected = stated ? (stated.denominator * MM_PER_PT) / printRatio(stated.sheet, pdfPage) : null
  const scale = (calibration: Calibration, support = 0): SheetScale =>
    ({ stated: input.stated, sheet_size: stated?.sheet ?? null, pdf_page: pdfPage, calibration, support })

  const ratios = dimensionRatios(input.page, input.segments)
  const agreeing = (r: number) => ratios.filter((o) => Math.abs(o.ratio / r - 1) <= 0.01)
  const best = ratios
    .map((r) => ({ r, cluster: agreeing(r.ratio) }))
    .sort((a, b) => b.cluster.length - a.cluster.length || (expected ? Math.abs(a.r.ratio - expected) - Math.abs(b.r.ratio - expected) : 0))[0]
  // A single pairing proves nothing: a postcode over a title-block line pairs too.
  if (best && best.cluster.length >= 2) {
    const sorted = best.cluster.map((c) => c.ratio).sort((a, b) => a - b)
    const factor = sorted[Math.floor(sorted.length / 2)]
    const reference = best.cluster.reduce((a, b) => (Math.abs(b.ratio - factor) < Math.abs(a.ratio - factor) ? b : a))
    return scale({
      method: 'dimension_string',
      reference_mm: reference.mm,
      factor: round(factor, 4),
      delta_pct: expected ? round((factor / expected - 1) * 100, 2) : null,
    }, best.cluster.length)
  }
  if (expected) return scale({ method: 'title_block', reference_mm: null, factor: round(expected, 4), delta_pct: null })
  return scale({ method: 'none', reference_mm: null, factor: null, delta_pct: null })
}

/** The run's scale, from the best-supported of its plan sheets: one its
 *  written dimensions confirm, else one with a stated scale. */
export function chooseScale(sheets: SheetScale[]): Scale | null {
  const rank = (s: SheetScale) => (s.calibration.method === 'dimension_string' ? 2 : s.calibration.method === 'title_block' ? 1 : 0)
  const best = [...sheets].sort((a, b) => rank(b) - rank(a) || b.support - a.support)[0]
  return best ? { stated: best.stated, sheet_size: best.sheet_size, pdf_page: best.pdf_page, calibration: best.calibration } : null
}
