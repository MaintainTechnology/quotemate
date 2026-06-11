// GET /api/q/[token]/pdf — download the customer quote PDF (electrical +
// plumbing G/B/B quotes). Token = quotes.share_token, same trust model as
// the /q/[token] page. Lazy-generates via Gotenberg on first hit (covers
// quotes sent before the PDF feature, or a Gotenberg blip at send time)
// and streams from the private quote-pdfs bucket so the link is stable.

import { createClient } from '@supabase/supabase-js'
import { ensureQuotePdf, downloadQuotePdf } from '@/lib/quote/pdf'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60 // lazy Gotenberg render on a cold link

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params

  const { data: quote } = await supabase
    .from('quotes')
    .select('id, pdf_path, needs_inspection')
    .eq('share_token', token)
    .maybeSingle()

  if (!quote) {
    return Response.json({ ok: false, error: 'Invalid or expired link' }, { status: 404 })
  }
  if (quote.needs_inspection) {
    return Response.json(
      { ok: false, error: 'This quote needs a site visit first — no PDF until the price is real' },
      { status: 404 },
    )
  }

  let path = quote.pdf_path as string | null
  if (!path) {
    path = await ensureQuotePdf(quote.id as string)
  }
  if (!path) {
    return Response.json({ ok: false, error: 'PDF unavailable right now — try again shortly' }, { status: 503 })
  }

  let pdf: Buffer
  try {
    pdf = await downloadQuotePdf(path)
  } catch (e) {
    console.error('[q/pdf] storage download failed', e instanceof Error ? e.message : e)
    return Response.json({ ok: false, error: 'PDF unavailable' }, { status: 500 })
  }

  return new Response(new Uint8Array(pdf), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="quote-${token.slice(0, 8)}.pdf"`,
      'Cache-Control': 'private, max-age=300',
    },
  })
}
