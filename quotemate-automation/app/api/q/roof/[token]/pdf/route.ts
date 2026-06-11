// GET /api/q/roof/[token]/pdf — download the roofing quote PDF.
// Token = roofing_measurements.public_token (same trust model as
// /q/roof/[token]). Lazy-generates via Gotenberg on first hit and streams
// from the private quote-pdfs bucket so the SMS'd link is stable.

import { createClient } from '@supabase/supabase-js'
import { ensureRoofQuotePdf, downloadQuotePdf } from '@/lib/quote/pdf'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params

  const { data: row } = await supabase
    .from('roofing_measurements')
    .select('public_token, pdf_path')
    .eq('public_token', token)
    .maybeSingle()

  if (!row) {
    return Response.json({ ok: false, error: 'Invalid or expired link' }, { status: 404 })
  }

  let path = row.pdf_path as string | null
  if (!path) {
    path = await ensureRoofQuotePdf(token)
  }
  if (!path) {
    return Response.json({ ok: false, error: 'PDF unavailable right now — try again shortly' }, { status: 503 })
  }

  let pdf: Buffer
  try {
    pdf = await downloadQuotePdf(path)
  } catch (e) {
    console.error('[q/roof/pdf] storage download failed', e instanceof Error ? e.message : e)
    return Response.json({ ok: false, error: 'PDF unavailable' }, { status: 500 })
  }

  return new Response(new Uint8Array(pdf), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="roof-quote-${token.slice(0, 8)}.pdf"`,
      'Cache-Control': 'private, max-age=300',
    },
  })
}
