// GET /api/q/pylon/[token]/pdf — download the customer Pylon proposal PDF.
// Token = pylon_proposals.public_token, same trust model as the
// /q/pylon/[token] page. Lazy-generates via Gotenberg on first hit and
// streams from the private quote-pdfs bucket so the link is stable.
// Pre-confirm there is no PDF — the document carries the full quote table.

import { createClient } from '@supabase/supabase-js'
import { ensurePylonProposalPdf, downloadQuotePdf } from '@/lib/quote/pdf'

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
    .from('pylon_proposals')
    .select('public_token, pdf_path, confirmed_at')
    .eq('public_token', token)
    .maybeSingle()

  if (!row) {
    return Response.json({ ok: false, error: 'Invalid or expired link' }, { status: 404 })
  }
  if (!row.confirmed_at) {
    return Response.json(
      { ok: false, error: 'This proposal is still being reviewed — the PDF unlocks once released' },
      { status: 404 },
    )
  }

  let path = row.pdf_path as string | null
  if (!path) {
    path = await ensurePylonProposalPdf(token)
  }
  if (!path) {
    return Response.json({ ok: false, error: 'PDF unavailable right now — try again shortly' }, { status: 503 })
  }

  let pdf: Buffer
  try {
    pdf = await downloadQuotePdf(path)
  } catch (e) {
    console.error('[q/pylon/pdf] storage download failed', e instanceof Error ? e.message : e)
    return Response.json({ ok: false, error: 'PDF unavailable' }, { status: 500 })
  }

  return new Response(new Uint8Array(pdf), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="solar-proposal-${token.slice(0, 8)}.pdf"`,
      'Cache-Control': 'private, max-age=300',
    },
  })
}
