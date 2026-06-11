// Gotenberg client — HTML → PDF via the self-hosted Gotenberg instance.
//
// Base URL comes from GOTENBERG_URL (.env.local / Vercel env), never
// hardcoded. Uses the Chromium HTML conversion route: POST a multipart
// form with a single `index.html` file; the response body is the PDF.
// https://gotenberg.dev/docs/routes#html-file-into-pdf-route

const CONVERT_PATH = '/forms/chromium/convert/html'

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
