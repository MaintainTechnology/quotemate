// Gotenberg client — HTML → PDF via the self-hosted Gotenberg instance.
//
// Base URL comes from GOTENBERG_URL (.env.local / Vercel env), never
// hardcoded. Two routes:
//   • HTML  (renderPdfFromHtml)  — POST a self-contained index.html.
//     https://gotenberg.dev/docs/routes#html-file-into-pdf-route
//   • URL   (renderPdfFromUrl)   — Gotenberg's Chromium navigates to a live
//     page and snapshots it. Used to print the ACTUAL redesigned quote pages
//     (app/q/*) so the PDF matches the on-screen design 1:1 without rebuilding
//     a parallel HTML template. The target page must be publicly reachable by
//     the Gotenberg host (the /q/<token> surfaces are token-gated but public).
//     https://gotenberg.dev/docs/routes#url-into-pdf-route

const CONVERT_PATH = '/forms/chromium/convert/html'
const URL_CONVERT_PATH = '/forms/chromium/convert/url'

/** A4 portrait width (inches) and the uniform margin used by the HTML route. */
export const PDF_PAPER_WIDTH_IN = 8.27
export const PDF_MARGIN_IN = 0.5
/**
 * The printable content width (inches). `renderReportDocument` pins the
 * document body to exactly this — see the SINGLE-PAGE note below for why that
 * is a correctness requirement, not styling.
 */
export const PDF_CONTENT_WIDTH_IN = PDF_PAPER_WIDTH_IN - 2 * PDF_MARGIN_IN

export function gotenbergConfigured(): boolean {
  return Boolean(process.env.GOTENBERG_URL?.trim())
}

/**
 * Render a self-contained HTML document to a SINGLE continuous PDF page
 * (one tall page, no A4 pagination).
 *
 * SINGLE-PAGE / WIDTH CONTRACT — read before changing either side.
 * Gotenberg implements `singlePage` by measuring the laid-out document and
 * overriding paperHeight (pkg/modules/chromium/tasks.go):
 *
 *     paperHeight = (cssContentSize.Height / 96) + marginTop + marginBottom
 *
 * That measurement is taken at the BROWSER VIEWPORT width (~836px), while
 * PrintToPDF re-lays-out at the printable width (7.27in ≈ 698px). For any
 * width-sensitive (reflowing / full-bleed) document those two layouts have
 * different heights, so the computed page is too SHORT and the tail of the
 * document is silently CLIPPED. Measured against our own Gotenberg: an
 * 18-page document rendered as a single page only 15 pages tall.
 *
 * The fix is to make the document's layout width independent of the viewport
 * by pinning it to PDF_CONTENT_WIDTH_IN, which `renderReportDocument` does.
 * If you feed this function HTML that does NOT pin its width, expect clipping.
 *
 * paperHeight stays set: `singlePage` overrides it, but it remains the correct
 * A4 fallback on a Gotenberg build that predates the flag (unknown form fields
 * are ignored, not rejected).
 */
export async function renderPdfFromHtml(html: string): Promise<Buffer> {
  const base = process.env.GOTENBERG_URL?.trim().replace(/\/$/, '')
  if (!base) throw new Error('GOTENBERG_URL is not set')

  const form = new FormData()
  form.set('files', new File([html], 'index.html', { type: 'text/html' }))
  // A4 portrait with sane margins (inches).
  form.set('paperWidth', String(PDF_PAPER_WIDTH_IN))
  form.set('paperHeight', '11.7')
  form.set('marginTop', String(PDF_MARGIN_IN))
  form.set('marginBottom', String(PDF_MARGIN_IN))
  form.set('marginLeft', String(PDF_MARGIN_IN))
  form.set('marginRight', String(PDF_MARGIN_IN))
  // One continuous page instead of A4 page-by-page. Safe here because every
  // caller renders through renderReportDocument, which pins the body width.
  form.set('singlePage', 'true')

  const res = await fetch(`${base}${CONVERT_PATH}`, {
    method: 'POST',
    body: form,
    signal: AbortSignal.timeout(60_000),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`Gotenberg ${res.status}: ${detail.slice(0, 300)}`)
  }
  return Buffer.from(await res.arrayBuffer())
}

/**
 * Render a live page (by URL) to PDF. Chromium loads the URL, runs its JS,
 * waits for fonts/images, then snapshots using the PRINT media type — so the
 * quote page's `@media print` rules (hide the fixed chrome, expand the sheet)
 * apply, and `printBackground` keeps the design's fills. A4 portrait.
 *
 * Deliberately does NOT set `singlePage`. The /q/* pages print full-bleed
 * (`@media print { .qm-sheet { max-width: none } }` in app/globals.css), so
 * their height is a function of the layout width — exactly the case where
 * Gotenberg's viewport-measured page height under-shoots and clips the tail
 * (see the SINGLE-PAGE / WIDTH CONTRACT on renderPdfFromHtml). Making this
 * route continuous requires first pinning the print width of the live pages.
 */
export async function renderPdfFromUrl(url: string): Promise<Buffer> {
  const base = process.env.GOTENBERG_URL?.trim().replace(/\/$/, '')
  if (!base) throw new Error('GOTENBERG_URL is not set')

  const form = new FormData()
  form.set('url', url)
  form.set('paperWidth', '8.27')
  form.set('paperHeight', '11.7')
  form.set('marginTop', '0.4')
  form.set('marginBottom', '0.4')
  form.set('marginLeft', '0.4')
  form.set('marginRight', '0.4')
  // Keep the design's backgrounds/fills; render with print media so the quote
  // page's @media print rules strip the fixed header + sticky bar + grain.
  form.set('printBackground', 'true')
  form.set('emulatedMediaType', 'print')
  // Give the Next client component time to hydrate (theme) + web fonts + the
  // Gemini/satellite images to load before the snapshot.
  form.set('waitDelay', '2.5s')

  const res = await fetch(`${base}${URL_CONVERT_PATH}`, {
    method: 'POST',
    body: form,
    signal: AbortSignal.timeout(60_000),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`Gotenberg ${res.status}: ${detail.slice(0, 300)}`)
  }
  return Buffer.from(await res.arrayBuffer())
}
