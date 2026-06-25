// GET /api/q/[token]/pdf — download the customer quote PDF (electrical +
// plumbing G/B/B quotes). Token = quotes.share_token, same trust model as
// the /q/[token] page. Lazy-generates via Gotenberg on first hit (covers
// quotes sent before the PDF feature, or a Gotenberg blip at send time)
// and streams from the private quote-pdfs bucket so the link is stable.

import { after } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { ensureQuotePdf, downloadQuotePdf } from '@/lib/quote/pdf'
import { archiveQuoteOnDownload } from '@/lib/filestore/archive-on-download'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60 // lazy Gotenberg render on a cold link

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

export async function GET(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params
  // The dashboard viewer embeds the PDF with ?disposition=inline so it renders
  // in an <iframe> instead of forcing a download. Default stays `attachment`
  // (the Download button + every existing link/SMS keep their behaviour).
  const inline = new URL(req.url).searchParams.get('disposition') === 'inline'

  const { data: quote } = await supabase
    .from('quotes')
    .select('id, intake_id, pdf_path, needs_inspection')
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

  // Mig 146 — always run the self-healing generator: it serves the cached PDF
  // when the signature still matches the tenant's current tier mode + template,
  // and regenerates when the tradie has since changed the Pricing-settings tier
  // mode (or the template was bumped). Falls back to the last-known cached PDF
  // if generation is unavailable (e.g. Gotenberg down) so the link never breaks.
  let path = await ensureQuotePdf(quote.id as string)
  if (!path) path = quote.pdf_path as string | null
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

  // Land this document in the tradie's Files tab (best-effort, post-response).
  // The quote's trade lives on its intake (electrical | plumbing); default to
  // electrical when unavailable. archiveQuoteOnDownload no-ops when the flag is
  // off or the quote is orphaned, so this never affects the download.
  after(async () => {
    if (process.env.TENANT_FILESTORE_ENABLED !== 'true') return
    let trade = 'electrical'
    try {
      if (quote.intake_id) {
        const { data: intake } = await supabase
          .from('intakes')
          .select('trade')
          .eq('id', quote.intake_id as string)
          .maybeSingle()
        if (intake?.trade) trade = String(intake.trade)
      }
    } catch {
      /* fall back to electrical */
    }
    await archiveQuoteOnDownload({ sourceKind: 'quote', sourceId: quote.id as string, trade })
  })

  return new Response(new Uint8Array(pdf), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="quote-${token.slice(0, 8)}.pdf"`,
      'Cache-Control': 'private, max-age=300',
    },
  })
}
