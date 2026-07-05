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

export function gotenbergConfigured(): boolean {
  return Boolean(process.env.GOTENBERG_URL?.trim())
}

export async function renderPdfFromHtml(html: string): Promise<Buffer> {
  const base = process.env.GOTENBERG_URL?.trim().replace(/\/$/, '')
  if (!base) throw new Error('GOTENBERG_URL is not set')

  const form = new FormData()
  form.set('files', new File([html], 'index.html', { type: 'text/html' }))
  // A4 portrait with sane margins (inches).
  form.set('paperWidth', '8.27')
  form.set('paperHeight', '11.7')
  form.set('marginTop', '0.5')
  form.set('marginBottom', '0.5')
  form.set('marginLeft', '0.5')
  form.set('marginRight', '0.5')

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
