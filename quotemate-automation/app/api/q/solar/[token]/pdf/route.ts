// GET /api/q/solar/[token]/pdf — download the customer solar quote PDF.
// Token = solar_estimates.public_token, same trust model as the
// /q/solar/[token] page. Lazy-generates via Gotenberg on first hit (covers
// estimates created before the PDF feature, or a Gotenberg blip at confirm
// time) and streams from the private quote-pdfs bucket so the link is stable.

import { after } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { ensureSolarQuotePdf, downloadQuotePdf } from '@/lib/quote/pdf'
import { archiveQuoteOnDownload } from '@/lib/filestore/archive-on-download'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60 // lazy Gotenberg render on a cold link

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params

  const { data: row } = await supabase
    .from('solar_estimates')
    .select('public_token, pdf_path, routing')
    .eq('public_token', token)
    .maybeSingle()

  if (!row) {
    return Response.json({ ok: false, error: 'Invalid or expired link' }, { status: 404 })
  }
  if (row.routing === 'inspection_required') {
    return Response.json(
      { ok: false, error: 'This estimate needs a site visit first — no PDF until the price is confirmed' },
      { status: 404 },
    )
  }

  let path = row.pdf_path as string | null
  if (!path) {
    path = await ensureSolarQuotePdf(token)
  }
  if (!path) {
    return Response.json({ ok: false, error: 'PDF unavailable right now — try again shortly' }, { status: 503 })
  }

  let pdf: Buffer
  try {
    pdf = await downloadQuotePdf(path)
  } catch (e) {
    console.error('[q/solar/pdf] storage download failed', e instanceof Error ? e.message : e)
    return Response.json({ ok: false, error: 'PDF unavailable' }, { status: 500 })
  }

  // Land this document in the tradie's Files tab (best-effort, post-response).
  after(() => archiveQuoteOnDownload({ sourceKind: 'quote', sourceId: token, trade: 'solar' }))

  return new Response(new Uint8Array(pdf), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="solar-quote-${token.slice(0, 8)}.pdf"`,
      'Cache-Control': 'private, max-age=300',
    },
  })
}
