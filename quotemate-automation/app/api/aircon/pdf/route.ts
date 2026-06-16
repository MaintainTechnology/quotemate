// POST /api/aircon/pdf — render the current aircon recommendation to a PDF
// and stream it back. Aircon is a stateless recommender (no saved row, no
// committable quote — every result routes to "book an assessment"), so the
// PDF is rendered on demand from the recommendation the dashboard already
// holds, rather than persisted + token-served like the quote trades.
//
// Auth: same bearer-token pattern as /api/aircon/recommend. The business
// name on the document comes from the caller's tenant.

import { createClient } from '@supabase/supabase-js'
import { renderPdfFromHtml, gotenbergConfigured } from '@/lib/pdf/gotenberg'
import { buildAirconReportHtml } from '@/lib/aircon/report-html'
import type { AcRecommendation } from '@/lib/aircon/types'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

async function tenantFromBearer(req: Request): Promise<{ businessName: string } | null> {
  const auth = req.headers.get('authorization') ?? ''
  if (!auth.toLowerCase().startsWith('bearer ')) return null
  const token = auth.slice(7).trim()
  if (!token) return null
  const { data, error } = await supabase.auth.getUser(token)
  if (error || !data.user) return null
  const { data: tenant } = await supabase
    .from('tenants')
    .select('business_name')
    .eq('owner_user_id', data.user.id)
    .maybeSingle()
  return { businessName: (tenant?.business_name as string | undefined) ?? 'QuoteMate' }
}

/** Light structural guard — enough to avoid rendering garbage, without a
 *  full zod schema for the deep AcRecommendation shape. */
function looksLikeRecommendation(v: unknown): v is AcRecommendation {
  if (!v || typeof v !== 'object') return false
  const r = v as Record<string, unknown>
  return (
    !!r.sizing &&
    typeof r.sizing === 'object' &&
    Array.isArray(r.options) &&
    r.options.length > 0 &&
    !!r.routing &&
    typeof r.routing === 'object'
  )
}

export async function POST(req: Request) {
  const tenant = await tenantFromBearer(req)
  if (!tenant) {
    return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  if (!gotenbergConfigured()) {
    return Response.json({ ok: false, error: 'PDF service not configured' }, { status: 503 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return Response.json({ ok: false, error: 'invalid_json' }, { status: 400 })
  }
  const b = (body ?? {}) as { address?: unknown; recommendation?: unknown; climateZone?: unknown }
  if (!looksLikeRecommendation(b.recommendation)) {
    return Response.json({ ok: false, error: 'invalid_recommendation' }, { status: 400 })
  }

  let pdf: Buffer
  try {
    const html = buildAirconReportHtml({
      businessName: tenant.businessName,
      address: typeof b.address === 'string' ? b.address : '',
      recommendation: b.recommendation,
      climateZone: typeof b.climateZone === 'string' ? b.climateZone : null,
    })
    pdf = await renderPdfFromHtml(html)
  } catch (e) {
    console.error('[aircon/pdf] render failed', e instanceof Error ? e.message : e)
    return Response.json({ ok: false, error: 'PDF unavailable right now — try again shortly' }, { status: 503 })
  }

  return new Response(new Uint8Array(pdf), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'attachment; filename="aircon-recommendation.pdf"',
      'Cache-Control': 'no-store',
    },
  })
}
