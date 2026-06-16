// POST /api/tenant/estimator/price — indicative pricing for a take-off.
//
// Body: { items: Array<{ type: string; count: number }>, extractionId?: string }
// Loads the tenant's electrical assemblies (custom + shared) and pricing book,
// then prices deterministically (grounded — no LLM, no free-form prices).
// Items with no catalogue match come back UNMATCHED, not guessed.
// When extractionId is supplied the computed BOM is persisted onto that run
// (plan_extractions.priced_bom/priced_at, tenant-scoped) so it survives reload.

import { tenantFromBearer, estimatorSupabase as supabase } from '@/lib/estimation/auth'
import { priceTakeoff, type TakeoffItem } from '@/lib/estimation/price'
import { loadElectricalPricingContext } from '@/lib/estimation/pricing-context'
import { provisionSessionStore } from '@/lib/filestore/provision'
import { electricalEstimateSummaryText } from '@/lib/filestore/estimate-summary'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(req: Request) {
  const tenant = await tenantFromBearer(req)
  if (!tenant) return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 })

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return Response.json({ ok: false, error: 'invalid_json' }, { status: 400 })
  }
  const rawItems = (body as Record<string, unknown>)?.items
  if (!Array.isArray(rawItems)) {
    return Response.json({ ok: false, error: 'items must be an array' }, { status: 400 })
  }
  const items: TakeoffItem[] = rawItems
    .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object')
    .map((r): TakeoffItem => {
      const item: TakeoffItem = {
        type: String(r.type ?? r.item ?? r.name ?? '').trim(),
        count: Number(r.count) || 0,
      }
      // Take-off provenance → priced-line audit trace.
      if (r.confidence === 'high' || r.confidence === 'medium' || r.confidence === 'low') {
        item.confidence = r.confidence
      }
      if (r.note != null && String(r.note).trim()) item.note = String(r.note)
      return item
    })
    .filter((i) => i.type)

  // Assemblies + pricing book via the shared loader (also used by the SMS
  // estimator pipeline — one pricing path, no fork).
  const { assemblies, book, bookSource } = await loadElectricalPricingContext(supabase, tenant.id)

  const bom = priceTakeoff(items, assemblies, book)

  // Persist onto the run when the caller names one — derived data, safe to overwrite.
  const rawExtractionId = (body as Record<string, unknown>)?.extractionId
  const extractionId = typeof rawExtractionId === 'string' && rawExtractionId.trim() ? rawExtractionId.trim() : null
  let persisted = false
  if (extractionId) {
    const pricedAt = new Date().toISOString()
    const { data: saved } = await supabase
      .from('plan_extractions')
      .update({ priced_bom: bom, priced_at: pricedAt, updated_at: pricedAt })
      .eq('id', extractionId)
      .eq('tenant_id', tenant.id)
      .select('id')
      .maybeSingle()
    persisted = Boolean(saved)

    // Index the priced result as a readable summary into this run's persistent
    // store so the estimator chatbot can explain the numbers. The dashboard
    // electrical flow renders no result PDF, so this text IS the result doc.
    // Named per pricing pass so a re-price indexes the fresh result.
    if (persisted) {
      provisionSessionStore({
        estimator: 'electrical',
        sessionId: extractionId,
        documents: [
          {
            name: `electrical-estimate-summary-${pricedAt.replace(/[:.]/g, '-')}.txt`,
            bytes: Buffer.from(electricalEstimateSummaryText(bom, { pricedAt }), 'utf8'),
            mime: 'text/plain',
          },
        ],
      })
    }
  }

  return Response.json({ ok: true, bom, catalogueSize: assemblies.length, pricingBookSource: bookSource, persisted })
}
