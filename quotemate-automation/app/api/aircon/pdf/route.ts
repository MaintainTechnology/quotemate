// POST /api/aircon/pdf — render the current aircon recommendation to a PDF
// and stream it back. Aircon is a stateless recommender (no saved row, no
// committable quote — every result routes to "book an assessment"), so the
// PDF is rendered on demand from the recommendation the dashboard already
// holds, rather than persisted + token-served like the quote trades.
//
// Auth: same bearer-token pattern as /api/aircon/recommend. The business
// name on the document comes from the caller's tenant.

import { after } from 'next/server'
import { createHash } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { renderPdfFromHtml, gotenbergConfigured } from '@/lib/pdf/gotenberg'
import { storeQuoteAsset } from '@/lib/quote/pdf'
import { archiveAndIngestQuote } from '@/lib/filestore/ingest-quote'
import { buildAirconReportHtml } from '@/lib/aircon/report-html'
import type { AcRecommendation } from '@/lib/aircon/types'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

async function tenantFromBearer(
  req: Request,
): Promise<{ id: string | null; businessName: string } | null> {
  const auth = req.headers.get('authorization') ?? ''
  if (!auth.toLowerCase().startsWith('bearer ')) return null
  const token = auth.slice(7).trim()
  if (!token) return null
  const { data, error } = await supabase.auth.getUser(token)
  if (error || !data.user) return null
  const { data: tenant } = await supabase
    .from('tenants')
    .select('id, business_name')
    .eq('owner_user_id', data.user.id)
    .maybeSingle()
  return {
    id: (tenant?.id as string | undefined) ?? null,
    businessName: (tenant?.business_name as string | undefined) ?? 'QuoteMax',
  }
}

// PII-minimized markdown summary for the KB (specs/files-tab.md constraints).
// Sizing + product names + climate zone only — never the address or prices
// (aircon always routes to an on-site assessment, so there is no committable
// price to leak anyway).
function buildAirconKbText(rec: AcRecommendation, climateZone: string | null): string {
  const r = rec as unknown as Record<string, unknown>
  const lines: string[] = ['# Air-conditioning recommendation', '']
  if (climateZone) lines.push(`Climate zone: ${climateZone}`, '')
  const sizing = (r.sizing as Record<string, unknown> | undefined) ?? undefined
  if (sizing) {
    if (sizing.capacity_kw != null) lines.push(`Recommended capacity: ${sizing.capacity_kw} kW`)
    if (sizing.room_type) lines.push(`Room type: ${sizing.room_type}`)
    if (sizing.area_sqm != null) lines.push(`Area: ${sizing.area_sqm} m2`)
  }
  const options = Array.isArray(r.options) ? (r.options as Array<Record<string, unknown>>) : []
  if (options.length) {
    lines.push('', '## Options')
    for (const o of options) {
      const product = (o.product as Record<string, unknown> | undefined) ?? {}
      const name = (product.name ?? o.name ?? o.model ?? 'Option') as string
      const brand = (product.brand ?? o.brand ?? '') as string
      const label = [brand, name].filter(Boolean).join(' ').trim()
      if (label) lines.push(`- ${label}`)
    }
  }
  lines.push('', 'Every recommendation routes to an on-site assessment to confirm sizing and installation.')
  return lines.join('\n')
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

  // Land this recommendation in the tradie's Files tab (best-effort, post-
  // response). Aircon is stateless (no saved row/token), so we archive the
  // just-rendered PDF directly under a deterministic id and ingest a PII-
  // minimized summary. Identical recommendations dedupe via that id +
  // archiveAndIngestQuote's (tenant_id, display_name) upsert.
  const renderedPdf = pdf
  const tenantId = tenant.id
  const rec = b.recommendation
  const climateZone = typeof b.climateZone === 'string' ? b.climateZone : null
  const addr = typeof b.address === 'string' ? b.address : ''
  after(async () => {
    if (process.env.TENANT_FILESTORE_ENABLED !== 'true' || !tenantId) return
    try {
      const sourceId = createHash('sha256')
        .update(`${tenantId}|${addr}|${JSON.stringify(rec)}`)
        .digest('hex')
        .slice(0, 32)
      const fullDocPath = await storeQuoteAsset(
        `aircon/${tenantId}/${sourceId}.pdf`,
        renderedPdf,
        'application/pdf',
      )
      const kbText = buildAirconKbText(rec, climateZone)
      const contentHash = createHash('sha256').update(kbText).digest('hex')
      await archiveAndIngestQuote({
        tenantId,
        sourceKind: 'quote',
        sourceId,
        trade: 'aircon',
        fullDocPath,
        kbText,
        contentHash,
      })
    } catch (e) {
      console.error('[aircon/pdf] archive failed (non-fatal)', e instanceof Error ? e.message : e)
    }
  })

  return new Response(new Uint8Array(pdf), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'attachment; filename="aircon-recommendation.pdf"',
      'Cache-Control': 'no-store',
    },
  })
}
