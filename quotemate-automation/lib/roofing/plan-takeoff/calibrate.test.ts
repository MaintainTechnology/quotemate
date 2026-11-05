// Scale calibration (P2, TKO-12) on made-up sheets laid out like the
// fixtures': ticked dimension lines that run past their ticks, a drawing line
// crossing one, a postcode over a title-block line, and an A1 sheet printed on
// A3. calibrate.fixtures.test.ts runs it on the real plan sheets.

import { describe, expect, it } from 'vitest'
import { calibrateSheet, chooseScale, parseScale, printRatio, type Segment } from './calibrate'
import { statedScale, type PageText, type TextRun } from './classify'

const A1: [number, number] = [2383.94, 1683.78]
const A3: [number, number] = [1190.52, 841.92]
const run = (x: number, y: number, size: number, text: string): TextRun => ({ x, x2: x + text.length * size * 0.55, y, size, text })
const page = (size: [number, number], ...runs: TextRun[]): PageText => ({ width: size[0], height: size[1], chars: 500, runs })

/** A dimension line from `from` to `to` at height y, running 3 points past
 *  its ticks, as Grange's do; each tick is a short slash across it. */
const dimension = (from: number, to: number, y: number): Segment[] => [
  [from - 3, y, to + 3, y],
  [from - 2, y + 2, from + 2, y - 2],
  [to - 2, y + 2, to + 2, y - 2],
]
const PT_AT_1_100 = 72 / 25.4 / 100 // points per millimetre at 1:100

it.each([
  ['1:50 @ A1', { denominator: 50, sheet: 'A1' }],
  ['1 : 100', { denominator: 100, sheet: null }],
  ['@ A1 1 : 50', { denominator: 50, sheet: 'A1' }],
  ['As indicated', null],
  ['NTS', null],
])('parseScale(%j)', (text, expected) => {
  expect(parseScale(text)).toEqual(expected)
})

it('knows an A1 sheet printed on A3 is half size', () => {
  expect(printRatio('A1', A3)).toBeCloseTo(0.4994, 4)
  expect(printRatio('A1', A1)).toBeCloseTo(1, 3)
  expect(printRatio(null, A3)).toBe(1)
})

it('bounds its work on a page drawn to stall it', () => {
  // 3,000 dimension strings over 30,000 lines and 30,000 short strokes:
  // unbounded, every string scans every segment for its line, and again for
  // its ticks.
  const texts = Array.from({ length: 3000 }, (_, i) => run(100 + (i % 50) * 40, 100 + Math.floor(i / 50) * 20, 6, '1000'))
  const strokes: Segment[] = [
    ...Array.from({ length: 30_000 }, (_, i): Segment => [0, i * 0.05, 2400, i * 0.05]),
    ...Array.from({ length: 30_000 }, (_, i): Segment => [i % 2000, (i * 7) % 1600, (i % 2000) + 1, ((i * 7) % 1600) + 3]),
  ]
  const started = performance.now()
  calibrateSheet({ page: page(A1, ...texts), segments: strokes, stated: '1:100 @ A1' })
  expect(performance.now() - started).toBeLessThan(1000)
})

describe('calibrateSheet', () => {
  const sixMetres = 6000 * PT_AT_1_100
  const threeMetres = 3000 * PT_AT_1_100
  const segments: Segment[] = [
    ...dimension(100, 100 + sixMetres, 500),
    ...dimension(400, 400 + threeMetres, 600),
    [180, 300, 180, 900], // a wall crossing the 6000 dimension line near its text: not a tick
    [50, 702, 2000, 702], [1000, 704, 1004, 700], [1050, 704, 1054, 700], // a title-block line under a postcode
  ]
  const texts = [run(170, 497, 12, '6000'), run(430, 597, 12, '3000'), run(1010, 699, 12, '4305')]

  it('confirms the stated scale where two written dimensions agree', () => {
    const scale = calibrateSheet({ page: page(A1, ...texts), segments, stated: '1:100 @ A1' })
    expect(scale).toMatchObject({
      stated: '1:100 @ A1', sheet_size: 'A1', pdf_page: A1, support: 2,
      calibration: { method: 'dimension_string', factor: 35.2778, delta_pct: 0 },
    })
    expect([6000, 3000]).toContain(scale.calibration.reference_mm)
  })

  it('needs two dimensions to agree: one alone falls back on the stated scale', () => {
    // 2383.94 points is 841.001 mm, a hair over A1's 841: hence 35.2777, not 35.2778.
    expect(calibrateSheet({ page: page(A1, texts[0], texts[2]), segments, stated: '1:100 @ A1' }).calibration)
      .toEqual({ method: 'title_block', reference_mm: null, factor: 35.2777, delta_pct: null })
  })

  it('corrects the stated scale for an A1 sheet printed on A3', () => {
    expect(calibrateSheet({ page: page(A3), segments: [], stated: '1:50 @ A1' }).calibration)
      .toEqual({ method: 'title_block', reference_mm: null, factor: 35.3207, delta_pct: null })
  })

  it('has nothing to go on without dimensions or a stated scale', () => {
    expect(calibrateSheet({ page: page(A1), segments: [], stated: null }).calibration)
      .toEqual({ method: 'none', reference_mm: null, factor: null, delta_pct: null })
  })
})

it('takes the run scale from the best-supported sheet', () => {
  const sheet = (method: 'dimension_string' | 'title_block' | 'none', support: number) => ({
    stated: '1:100 @ A1', sheet_size: 'A1', pdf_page: A1, support,
    calibration: { method, reference_mm: null, factor: method === 'none' ? null : 35.28, delta_pct: null },
  })
  expect(chooseScale([sheet('title_block', 0), sheet('dimension_string', 2), sheet('dimension_string', 3)])?.calibration.method).toBe('dimension_string')
  expect(chooseScale([sheet('none', 0), sheet('title_block', 0)])?.calibration.method).toBe('title_block')
  expect(chooseScale([])).toBeNull()
})

describe('statedScale', () => {
  it("reads the title block's SCALE field", () => {
    expect(statedScale(page(A3, run(1029, 755, 3.1, 'SCALE'), run(1029, 762, 5.9, '1:50 @ A1')))).toBe('1:50 @ A1')
  })

  it('takes the one scale the views are marked at when the field says "As indicated"', () => {
    expect(statedScale(page(A1, run(2019, 1490, 12, 'SCALE @ A1'), run(2153, 1495, 20, 'As indicated'), run(900, 1200, 14, '1 : 100'))))
      .toBe('1:100 @ A1')
  })

  it('gives none when the views are at different scales', () => {
    expect(statedScale(page(A1, run(900, 1200, 14, '1 : 100'), run(1500, 1200, 14, '1 : 20')))).toBeNull()
  })
})
