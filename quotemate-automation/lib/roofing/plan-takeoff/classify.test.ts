// The sheet classifier (P2, TKO-10) on made-up title blocks laid out like the
// fixtures' four drafters: values under labels, a value indented in its cell,
// a big sheet number beside the amendment, a two-line title, an unlabelled
// stamp. classify.fixtures.test.ts runs it on the real plan sets.

import { PDFDocument, StandardFonts } from 'pdf-lib'
import { generateObject } from 'ai'
import { describe, expect, it, vi } from 'vitest'
import {
  classifyFile, isPreliminary, kindOf, needed, readSheetWithModel, readTitleBlock, sheetNumber,
  type PageText, type TextRun,
} from './classify'

vi.mock('ai', () => ({ generateObject: vi.fn() }))

/** A run as the page reader makes it: points from the top left, y the baseline. */
const run = (x: number, y: number, size: number, text: string): TextRun => ({ x, x2: x + text.length * size * 0.55, y, size, text })
const page = (...runs: TextRun[]): PageText => ({ width: 1190, height: 842, chars: 400, runs })

describe('readTitleBlock', () => {
  it('reads values set under their labels', () => {
    expect(readTitleBlock(page(
      run(800, 700, 6, 'DRAWING TITLE'), run(800, 718, 14, 'ROOF PLAN'),
      run(800, 740, 6, 'REVISION'), run(880, 740, 6, 'DRAWING NO.'),
      run(805, 758, 14, 'C'), run(885, 758, 14, 'A201'),
      run(800, 780, 6, 'STATUS'), run(800, 798, 14, 'FOR CONSTRUCTION'),
    ))).toEqual({ number: 'A201', title: 'ROOF PLAN', revision: 'C', status_text: 'FOR CONSTRUCTION' })
  })

  it('takes a value that is indented in its cell and split into runs, up to the next label', () => {
    expect(readTitleBlock(page(
      run(960, 800, 8, 'Drawing No'), run(1135, 800, 8, 'Revision'),
      run(1018, 818, 16, '25AD257/'), run(1100, 818, 16, 'S101'), run(1145, 818, 16, 'A'),
    ))).toMatchObject({ number: 'S101', revision: 'A' })
  })

  it("doesn't take a big sheet number standing beside the amendment label", () => {
    expect(readTitleBlock(page(
      run(1029, 779, 4.4, 'NUMBER'), run(1103, 779, 4.4, 'AMENDMENT'),
      run(1029, 788, 5.9, '119:01 A104'), run(1109, 788, 5.9, 'P3'),
      run(1129, 781, 13.8, 'A104'),
    ))).toMatchObject({ number: 'A104', revision: 'P3' })
  })

  it('reads a title block with hostile runs of dots and dashes in linear time', () => {
    // A trailing-trim regex retries from every start: 40k characters of ". "
    // took 8.7 s. A 0.01 pt font keeps such a run on the page.
    const dots = `${'. '.repeat(20_000)}A201`
    const dashes = `${'- '.repeat(20_000)}FOR CONSTRUCTION`
    const started = performance.now()
    readTitleBlock(page(run(800, 700, 6, 'DRAWING NO.'), run(800, 718, 0.01, dots), run(800, 730, 0.01, dashes)))
    expect(performance.now() - started).toBeLessThan(200)
  })

  it('joins a title that runs over two lines', () => {
    expect(readTitleBlock(page(
      run(1029, 707, 4.4, 'TITLE'), run(1029, 717, 7, 'PROPOSED'), run(1029, 728, 7, 'GROUND & ROOF PLANS'), run(1029, 745, 4.4, 'SCALE'),
    )).title).toBe('PROPOSED GROUND & ROOF PLANS')
  })

  it('leaves a field empty when the next thing in its cell is another label', () => {
    expect(readTitleBlock(page(run(800, 700, 6, 'STATUS'), run(800, 712, 6, 'DATE'), run(800, 724, 10, '01/11/26'))).status_text).toBeNull()
  })

  it('finds an unlabelled stamp before issue-table rows, and ignores a bare word in a note', () => {
    expect(readTitleBlock(page(
      run(60, 768, 8, 'ISSUED FOR COORDINATION'), run(60, 780, 8, 'ISSUED FOR CONSTRUCTION'),
      run(930, 345, 10, 'CONSTRUCTION'), run(1055, 732, 10, 'CONSTRUCTION ISSUE'),
    )).status_text).toBe('CONSTRUCTION ISSUE')
  })

  it('keeps a stamp date and drops its dashes', () => {
    expect(readTitleBlock(page(run(1040, 470, 9, 'PRELIMINARY 21.04.26'), run(1040, 485, 6, '-NOT FOR CONSTRUCTION-'))).status_text)
      .toBe('PRELIMINARY 21.04.26')
    expect(readTitleBlock(page(run(1040, 485, 6, '-NOT FOR CONSTRUCTION-'))).status_text).toBe('NOT FOR CONSTRUCTION')
  })

  it("prefers the title block to a drawing register's header nearer the top", () => {
    expect(readTitleBlock(page(
      run(860, 120, 10, 'NUMBER'), run(855, 134, 10, 'A0000'),
      run(1000, 760, 6, 'DRAWING NO.'), run(1005, 772, 12, 'A1001A'),
    )).number).toBe('A1001A')
  })

  it('copes with small text on the label line that overlaps the label', () => {
    expect(readTitleBlock(page(run(800, 700, 10, 'REVISION'), run(810, 702, 3, '2')))).toMatchObject({ revision: '2' })
  })

  it('reads nothing from a page with no title block', () => {
    expect(readTitleBlock(page(run(100, 100, 18, 'GROUND FLOOR PLAN')))).toEqual({ number: null, title: null, revision: null, status_text: null })
  })
})

it.each([
  ['S15741-S011', 'S011'], ['S15741 - S011', 'S011'], ['25AD257/ S001', 'S001'], ['119:01 A104', 'A104'],
  ['A1000A', 'A1000A'], ['A-101', 'A-101'], ['6 . Appointed competent person details', null],
])('sheetNumber(%j) is %j', (value, expected) => {
  expect(sheetNumber(value)).toBe(expected)
})

it('names the kind of sheet from its title', () => {
  expect([
    'ROOF FRAMING PLAN', 'PROPOSED GROUND & ROOF PLANS', 'SITE PLAN STAGE 2 - PROPOSED', 'ELEVATIONS - HOUSE 1',
    'BUILDING SECTIONS', 'FLOOR AND DECK FRAMING PLAN', null,
  ].map(kindOf)).toEqual(['roof_framing', 'roof_plan', 'site_plan', 'elevation', 'section', 'other', 'other'])
})

it('chooses the sheets the reader needs', () => {
  const roofs = page(run(400, 300, 8, 'COLORBOND ROOF @ 2°'))
  const site = (title: string) => ({ kind: 'site_plan' as const, title })
  expect(needed(site('SITE PLAN - PROPOSED'), roofs)).toBe(true)
  expect(needed(site('SITE PLAN - EXISTING & DEMOLITION'), roofs)).toBe(false)
  expect(needed(site('SITE PLAN - PROPOSED'), page(run(400, 300, 8, 'DRIVEWAY')))).toBe(false)
  expect(needed(site('SITE PLAN'), null)).toBe(true) // read by the model, no text to check
  expect(needed({ kind: 'elevation', title: 'ELEVATIONS' }, null)).toBe(true)
  expect(needed({ kind: 'other', title: 'DOOR SCHEDULE' }, null)).toBe(false)
})

it('knows a preliminary status', () => {
  expect(['PRELIMINARY 21.04.26', 'NOT FOR CONSTRUCTION', 'FOR CONSTRUCTION', 'BUILDING APPROVAL', null].map(isPreliminary))
    .toEqual([true, true, false, false, false])
})

/** A three-page set: a roof plan with no status, a page with no text layer,
 *  and a door schedule. pdf-lib measures from the bottom left. */
async function planSet() {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const titled = (title: string, number: string) => {
    const p = doc.addPage([842, 595])
    const text = (s: string, x: number, fromTop: number, size: number) => p.drawText(s, { x, y: 595 - fromTop, size, font })
    text('DRAWING TITLE', 600, 500, 6); text(title, 600, 514, 12)
    text('DRAWING NO.', 720, 500, 6); text(number, 720, 514, 12)
    text('REVISION', 600, 540, 6); text('C', 600, 554, 12)
  }
  titled('ROOF PLAN', 'A201')
  doc.addPage([842, 595])
  titled('DOOR SCHEDULE', 'A401')
  return doc.save()
}

describe('classifyFile', () => {
  it('reads title blocks from the text, and sends the model one page at a time only for a scan or a chosen sheet with no status', async () => {
    const sent: number[] = []
    const readSheet = vi.fn(async (pagePdf: Uint8Array) => {
      sent.push((await PDFDocument.load(pagePdf)).getPageCount())
      return sent.length === 1
        ? { number: 'A201', title: 'ROOF PLAN', revision: 'D', status_text: 'PRELIMINARY', kind: 'roof_plan' as const }
        : { number: 'A301', title: 'SECTIONS', revision: 'C', status_text: null, kind: 'section' as const }
    })
    const { sheets, modelPages } = await classifyFile('plans.pdf', await planSet(), readSheet)

    expect(modelPages).toBe(2)
    expect(sent).toEqual([1, 1])
    expect(sheets).toEqual([
      // What the text says stands (revision C, not the model's D); the model adds the status.
      { file: 'plans.pdf', page: 1, number: 'A201', title: 'ROOF PLAN', revision: 'C', status_text: 'PRELIMINARY', kind: 'roof_plan', used: true },
      { file: 'plans.pdf', page: 2, number: 'A301', title: 'SECTIONS', revision: 'C', status_text: null, kind: 'section', used: true },
      { file: 'plans.pdf', page: 3, number: 'A401', title: 'DOOR SCHEDULE', revision: 'C', status_text: null, kind: 'other', used: false },
    ])
  })
})

describe('readSheetWithModel', () => {
  it('sends the page as a PDF part and keeps only the sheet number', async () => {
    vi.mocked(generateObject).mockResolvedValueOnce({
      object: { number: 'S15741-S200', title: 'ROOF FRAMING PLAN', revision: '0', status_text: null, kind: 'roof_framing' },
    } as never)
    const pagePdf = new TextEncoder().encode('%PDF-1.4')
    await expect(readSheetWithModel(pagePdf)).resolves.toEqual({
      number: 'S200', title: 'ROOF FRAMING PLAN', revision: '0', status_text: null, kind: 'roof_framing',
      usage: { inputTokens: 0, outputTokens: 0 },
    })
    const [call] = vi.mocked(generateObject).mock.calls[0] as unknown as [{ messages: Array<{ content: unknown[] }>; maxOutputTokens: number }]
    expect(call.messages[0].content[0]).toEqual({ type: 'file', data: pagePdf, mediaType: 'application/pdf' })
    expect(call.maxOutputTokens).toBe(400)
  })
})
