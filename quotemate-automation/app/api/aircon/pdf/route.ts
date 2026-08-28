// POST /api/aircon/pdf — render a saved, tenant-owned priced aircon
// recommendation to a PDF and stream it back. The client supplies only the
// server-owned recommendation id; money is always reloaded from the tenant-
// scoped database row.
//
// Auth: same bearer-token pattern as /api/aircon/recommend. The business
// name on the document comes from the caller's tenant.

import { after } from 'next/server'
import { createHash } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { resolveTenantRequest } from '@/lib/tenant/from-request'
import { renderPdfFromHtml, gotenbergConfigured } from '@/lib/pdf/gotenberg'
import { storeQuoteAsset } from '@/lib/quote/pdf'
import { archiveAndIngestQuote } from '@/lib/filestore/ingest-quote'
import { buildAirconReportHtml } from '@/lib/aircon/report-html'
import { parseStoredPricedRecommendation } from '@/lib/aircon/recommendation-schema'
import { climateZoneForPostcode } from '@/lib/aircon/climate'
import { loadTenantBranding } from '@/lib/pdf/branding'
import type { AcPricedRecommendation, AusState } from '@/lib/aircon/types'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

// PII-minimized markdown summary for the KB (specs/files-tab.md constraints).
// Sizing + product names + climate zone only — never the address or prices
// (aircon always routes to an on-site assessment, so there is no committable
// price to leak anyway).
function buildAirconKbText(rec: AcPricedRecommendation, climateZone: string | null): string {
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

export async function POST(req: Request) {
  // Dual-auth: Clerk session token OR legacy Supabase token. A tenant is
  // mandatory because the recommendation id is scoped to its owner.
  const resolved = await resolveTenantRequest(supabase, req, 'id, business_name')
  if (!resolved) {
    return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }
  const tenantRow = resolved.tenant as { id?: string; business_name?: string } | null
  const tenantId = (tenantRow?.id as string | undefined) ?? null
  if (!tenantId) {
    return Response.json({ ok: false, error: 'tenant_pricing_required' }, { status: 422 })
  }
  const businessName = (tenantRow?.business_name as string | undefined) ?? 'Your installer'

  if (!gotenbergConfigured()) {
    return Response.json({ ok: false, error: 'PDF service not configured' }, { status: 503 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return Response.json({ ok: false, error: 'invalid_json' }, { status: 400 })
  }
  const recommendationId =
    body && typeof body === 'object' && typeof (body as { recommendationId?: unknown }).recommendationId === 'string'
      ? (body as { recommendationId: string }).recommendationId.trim()
      : ''
  if (!recommendationId) {
    return Response.json({ ok: false, error: 'invalid_recommendation_id' }, { status: 400 })
  }

  const { data: stored, error: loadError } = await supabase
    .from('aircon_recommendations')
    .select('id, tenant_id, address, postcode, state, recommendation')
    .eq('id', recommendationId)
    .eq('tenant_id', tenantId)
    .maybeSingle()
  if (loadError) {
    return Response.json({ ok: false, error: 'recommendation_load_failed' }, { status: 500 })
  }
  if (!stored) {
    return Response.json({ ok: false, error: 'recommendation_not_found' }, { status: 404 })
  }
  const recommendation = parseStoredPricedRecommendation(stored.recommendation)
  if (!recommendation) {
    return Response.json({ ok: false, error: 'tenant_pricing_required' }, { status: 422 })
  }
  const address = typeof stored.address === 'string' ? stored.address : ''
  const postcode = typeof stored.postcode === 'string' ? stored.postcode : ''
  const state = typeof stored.state === 'string' ? stored.state : ''
  const climateZone = /^\d{4}$/.test(postcode) && ['NSW', 'VIC', 'QLD', 'SA', 'WA', 'TAS', 'ACT', 'NT'].includes(state)
    ? climateZoneForPostcode(postcode, state as AusState).zone
    : null

  let pdf: Buffer
  try {
    const branding = await loadTenantBranding(supabase, tenantId, 'aircon')
    const html = buildAirconReportHtml({
      businessName: branding?.businessName ?? businessName,
      branding,
      address,
      recommendation,
      climateZone,
    })
    pdf = await renderPdfFromHtml(html)
  } catch (e) {
    console.error('[aircon/pdf] render failed', e instanceof Error ? e.message : e)
    return Response.json({ ok: false, error: 'PDF unavailable right now — try again shortly' }, { status: 503 })
  }

  // Land this server-owned recommendation in the tradie's Files tab
  // (best-effort, post-response). The database id is the stable archive key.
  const renderedPdf = pdf
  after(async () => {
    if (process.env.TENANT_FILESTORE_ENABLED !== 'true') return
    try {
      const sourceId = recommendationId
      const fullDocPath = await storeQuoteAsset(
        `aircon/${tenantId}/${sourceId}.pdf`,
        renderedPdf,
        'application/pdf',
      )
      const kbText = buildAirconKbText(recommendation, climateZone)
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
