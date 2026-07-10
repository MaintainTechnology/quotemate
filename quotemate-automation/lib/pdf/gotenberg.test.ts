// Guards the SINGLE-PAGE / WIDTH CONTRACT between gotenberg.ts and
// report-chrome.ts: the HTML route asks Gotenberg for one continuous page,
// and Gotenberg derives that page's height by measuring the document at the
// browser viewport width. If the document's width is not pinned to the
// printable width, the computed page is too short and the tail is CLIPPED
// (verified against a live Gotenberg: an 18-page doc came out 15 pages tall).
//
// These two facts must move together, so they are asserted together.

import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  renderPdfFromHtml,
  PDF_PAPER_WIDTH_IN,
  PDF_MARGIN_IN,
  PDF_CONTENT_WIDTH_IN,
} from './gotenberg'
import { renderReportDocument } from './report-chrome'

/** Capture the multipart form Gotenberg would have received. */
async function captureForm(): Promise<FormData> {
  let captured: FormData | undefined
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: unknown, init?: RequestInit) => {
      captured = init?.body as FormData
      return new Response(new Uint8Array([1, 2, 3]), { status: 200 })
    }),
  )
  vi.stubEnv('GOTENBERG_URL', 'http://gotenberg.test')
  await renderPdfFromHtml('<html><body>hi</body></html>')
  if (!captured) throw new Error('fetch was not called')
  return captured
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('renderPdfFromHtml — continuous single page', () => {
  it('asks Gotenberg for one continuous page', async () => {
    expect((await captureForm()).get('singlePage')).toBe('true')
  })

  it('still sends A4 paper width + margins (the fallback when singlePage is unsupported)', async () => {
    const form = await captureForm()
    expect(form.get('paperWidth')).toBe(String(PDF_PAPER_WIDTH_IN))
    expect(form.get('paperHeight')).toBe('11.7')
    for (const m of ['marginTop', 'marginBottom', 'marginLeft', 'marginRight']) {
      expect(form.get(m)).toBe(String(PDF_MARGIN_IN))
    }
  })

  it('does not pin a page range — Gotenberg sets that itself for singlePage', async () => {
    expect((await captureForm()).get('nativePageRanges')).toBeNull()
  })
})

describe('single-page width contract', () => {
  it('content width is the paper width less both margins', () => {
    expect(PDF_CONTENT_WIDTH_IN).toBeCloseTo(PDF_PAPER_WIDTH_IN - 2 * PDF_MARGIN_IN, 10)
    expect(PDF_CONTENT_WIDTH_IN).toBeCloseTo(7.27, 10)
  })

  it('the shared chrome pins the body to exactly that width, so nothing is clipped', () => {
    const html = renderReportDocument(
      { businessName: 'Atomic Electrical', logoSrc: null },
      { docTitle: 'Test quote', dateLabel: '10 July 2026', bodyHtml: '<p>body</p>' },
    )
    // A viewport-dependent body width is what causes the clipping bug.
    expect(html).toContain(`width:${PDF_CONTENT_WIDTH_IN}in`)
  })
})
