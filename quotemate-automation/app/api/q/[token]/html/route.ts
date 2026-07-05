// GET /api/q/[token]/html — the customer quote report as self-contained HTML.
// Token = quotes.share_token (same trust model as /api/q/[token]/pdf and the
// /q/[token] page). This is the SAME document Gotenberg renders to PDF
// (buildQuoteReportHtml), served as text/html so the dashboard quote viewer can
// embed a live, edit-reactive preview instead of a frozen PDF snapshot.
//
// Read-only + owner-agnostic: it never mutates and never exposes anything the
// PDF doesn't. Editing still flows exclusively through the structured, grounded
// TradieEditor → POST /api/quote/[id]/edit; because this route reads the live
// quotes row every call, the preview reflects a saved edit on the next reload.

import { createClient } from '@supabase/supabase-js'
import { renderQuoteReportHtml } from '@/lib/quote/pdf'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 30

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

/** Minimal styled placeholder for the states that have no priced report yet. */
function placeholder(title: string, body: string, status: number): Response {
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title><style>
    html,body{margin:0;height:100%}
    body{display:grid;place-items:center;font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;background:#f6f5f2;color:#2b2422;padding:32px}
    .card{max-width:32rem;text-align:center}
    h1{font-size:1.05rem;font-weight:800;text-transform:uppercase;letter-spacing:-0.01em;margin:0 0 10px}
    p{font-size:0.9rem;line-height:1.55;color:#5e544e;margin:0}
  </style></head><body><div class="card"><h1>${title}</h1><p>${body}</p></div></body></html>`
  return new Response(html, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'private, no-store' },
  })
}

export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params

  const { data: quote } = await supabase
    .from('quotes')
    .select('id, needs_inspection')
    .eq('share_token', token)
    .maybeSingle()

  if (!quote) {
    return placeholder('Quote not found', 'This quote link is invalid or has expired.', 404)
  }
  if (quote.needs_inspection) {
    return placeholder(
      'Site visit required',
      'This job needs a quick on-site visit before a price can be locked in — there is no priced report to preview yet.',
      200,
    )
  }

  const html = await renderQuoteReportHtml(quote.id as string)
  if (!html) {
    return placeholder(
      'Preview unavailable',
      'We couldn’t build this quote’s report just now. Try again shortly, or use Download PDF.',
      503,
    )
  }

  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      // Always reflect the live quote — the viewer relies on a fresh read after
      // each structured edit save.
      'Cache-Control': 'private, no-store',
    },
  })
}
