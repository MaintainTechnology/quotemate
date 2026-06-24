// GET /api/q/roof/[token]/pdf — download the roofing quote PDF.
// Token = roofing_measurements.public_token (same trust model as
// /q/roof/[token]). Lazy-generates via Gotenberg on first hit and streams
// from the private quote-pdfs bucket so the SMS'd link is stable.

import { after } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { ensureRoofQuotePdf, downloadQuotePdf } from '@/lib/quote/pdf'
import { archiveQuoteOnDownload } from '@/lib/filestore/archive-on-download'
import { partitionRoofQuote, resolveEffectiveIndices, structureCount } from '@/lib/roofing/selection'
import type { MultiRoofQuote } from '@/lib/roofing/types'

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
    .select('public_token, pdf_path, routing, quote, included_indices, confirmed_structure')
    .eq('public_token', token)
    .maybeSingle()

  if (!row) {
    return Response.json({ ok: false, error: 'Invalid or expired link' }, { status: 404 })
  }
  if (row.routing === 'inspection_required') {
    return Response.json(
      { ok: false, error: 'This roof needs a site visit first — no PDF until the price is confirmed' },
      { status: 404 },
    )
  }

  let path = row.pdf_path as string | null
  if (!path) {
    // Render the PDF from the tradie's persisted structure selection
    // (included_indices), not the full quote — this is the fix for the PDF
    // summing ALL detected structures regardless of what was checked. The
    // headline total covers the INCLUDED quotable structures only; excluded
    // and inspection-routed structures are LISTED (displayRows) but never
    // priced into the total. The selection-update route nulls pdf_path on
    // change, so this regenerates.
    const fullQuote = (row.quote ?? null) as MultiRoofQuote | null
    const effective = resolveEffectiveIndices(
      {
        included: row.included_indices as number[] | null,
        confirmedStructure: row.confirmed_structure as number | null,
      },
      structureCount(fullQuote),
    )
    const partition = fullQuote ? partitionRoofQuote(fullQuote, effective) : null
    path = await ensureRoofQuotePdf(
      token,
      partition ? { quote: partition.narrowed, displayRows: partition.rows } : {},
    )
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

  // Land this document in the tradie's Files tab (best-effort, post-response).
  after(() => archiveQuoteOnDownload({ sourceKind: 'quote', sourceId: token, trade: 'roofing' }))

  return new Response(new Uint8Array(pdf), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="roof-quote-${token.slice(0, 8)}.pdf"`,
      'Cache-Control': 'private, max-age=300',
    },
  })
}
