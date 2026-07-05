// Download-as-PDF for the redesigned customer quote pages (all trades).
//
// GET /api/q/download?path=/q/<token>[&theme=light|dark]
//
// Renders the ACTUAL live quote page (app/q/*) to PDF via Gotenberg's URL
// route, so the download matches the on-screen redesign 1:1 — no parallel
// HTML template to keep in sync. The `path` is validated against a strict
// allow-list (quote surfaces only) so this can never be turned into an
// open proxy / SSRF. `theme` is passed through so the PDF honours the
// viewer's current dark/light choice.
//
// Separate from /api/q/[token]/pdf (which serves the cached SMS/MMS-attach
// PDF from the older report-html template) — this one is the "Download PDF"
// button on the page and always reflects the new design.

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { renderPdfFromUrl, gotenbergConfigured } from '@/lib/pdf/gotenberg'

export const dynamic = 'force-dynamic'
// Gotenberg render can take a few seconds; Vercel Hobby's 10s will time out —
// needs Pro or the Railway/Docker deploy (same constraint as the Opus routes).
export const maxDuration = 60

const APP_URL = (process.env.APP_URL ?? 'https://www.quotemax.com.au').replace(/\/$/, '')

// Allow-list: only the public quote surfaces. Tokens are [A-Za-z0-9_-]; the
// dedicated trades add one path segment (solar/roof/paint/plan/commercial-paint).
const SAFE_PATH = /^\/q\/(?:aircon\/|solar\/|roof\/|paint\/|plan\/|commercial-paint\/)?[A-Za-z0-9_-]{6,}$/

export async function GET(req: NextRequest) {
  if (!gotenbergConfigured()) {
    return NextResponse.json({ error: 'PDF service is not configured' }, { status: 503 })
  }

  const path = req.nextUrl.searchParams.get('path') ?? ''
  if (!SAFE_PATH.test(path)) {
    return NextResponse.json({ error: 'Invalid quote path' }, { status: 400 })
  }

  const themeParam = req.nextUrl.searchParams.get('theme')
  const theme = themeParam === 'light' || themeParam === 'dark' ? themeParam : null

  // Build the target URL from the trusted APP_URL + the validated path only.
  const target = `${APP_URL}${path}?pdf=1${theme ? `&theme=${theme}` : ''}`
  const token = path.split('/').filter(Boolean).pop() ?? 'quote'
  const filename = `quotemax-quote-${token.slice(0, 12)}.pdf`

  try {
    const pdf = await renderPdfFromUrl(target)
    return new NextResponse(new Uint8Array(pdf), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'private, no-store, max-age=0',
      },
    })
  } catch (err) {
    console.error('[q/download] PDF render failed', {
      path,
      error: err instanceof Error ? err.message : String(err),
    })
    return NextResponse.json({ error: 'PDF generation failed' }, { status: 502 })
  }
}
