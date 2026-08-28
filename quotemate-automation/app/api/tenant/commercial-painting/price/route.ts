// POST /api/tenant/commercial-painting/price — tenant-scoped (Bearer).
//
// Prices a CONFIRMED takeoff deterministically: paint_rates (shared
// defaults + tenant overrides) → resolvePaintRates → pricePaintTakeoff.
// No LLM anywhere on this path; unmatched lines come back unpriced.
// Persists priced_bom + priced_at on the extraction and advances the
// run to 'priced'.
//
// Body: { paintRunId: string, extractionId: string }
// (Prices the extraction's corrected_items when present, else items —
// the confirm step is the source of truth, same as electrical.)

import { tenantFromBearer, estimatorSupabase } from '@/lib/estimation/auth'
import { loadPaintRates, resolvePaintRates, applyLabourRateOverride } from '@/lib/commercial-painting/rates'
import { assessPaintPricingAuthority, pricePaintTakeoff } from '@/lib/commercial-painting/price'
import { findCommercialPaintPricingBook } from '@/lib/commercial-painting/pricing-context'
import { MAX_LABOUR_RATE_PER_HR, type PaintTakeoffItem } from '@/lib/commercial-painting/types'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(req: Request) {
  const tenant = await tenantFromBearer(req)
  if (!tenant) return Response.json({ ok: false, error: 'unauthorised' }, { status: 401 })

  let body: { paintRunId?: string; extractionId?: string; labourRatePerHr?: number }
  try {
    body = await req.json()
  } catch {
    return Response.json({ ok: false, error: 'invalid_json' }, { status: 400 })
  }
  const paintRunId = body.paintRunId?.trim()
  const extractionId = body.extractionId?.trim()
  if (!paintRunId || !extractionId) {
    return Response.json({ ok: false, error: 'missing_ids' }, { status: 400 })
  }

  // Optional per-quote labour-rate override (tradie-set). Out-of-range or
  // non-numeric values are ignored — the seeded/tenant rate is used instead.
  const rawRate = body.labourRatePerHr
  const labourRateOverride =
    typeof rawRate === 'number' && Number.isFinite(rawRate) && rawRate > 0 && rawRate <= MAX_LABOUR_RATE_PER_HR
      ? rawRate
      : null

  const { data: ext } = await estimatorSupabase
    .from('plan_extractions')
    .select('id, items, corrected_items')
    .eq('id', extractionId)
    .eq('paint_run_id', paintRunId)
    .eq('tenant_id', tenant.id)
    .maybeSingle()
  if (!ext) return Response.json({ ok: false, error: 'extraction_not_found' }, { status: 404 })

  const items = (Array.isArray(ext.corrected_items) && ext.corrected_items.length > 0
    ? ext.corrected_items
    : ext.items) as PaintTakeoffItem[]
  if (!Array.isArray(items) || items.length === 0) {
    return Response.json({ ok: false, error: 'no_items' }, { status: 422 })
  }

  let rows
  try {
    rows = await loadPaintRates(estimatorSupabase, tenant.id)
  } catch (e) {
    return Response.json(
      { ok: false, error: 'rates_load_failed', detail: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    )
  }
  const pricingBook = await findCommercialPaintPricingBook(estimatorSupabase, tenant)
  const book = applyLabourRateOverride(resolvePaintRates(rows), labourRateOverride)
  const gstRegistered = pricingBook?.gst_registered === true
  const bom = pricePaintTakeoff(items, book, { gstRegistered })
  const authority = assessPaintPricingAuthority(bom, book, pricingBook != null)

  if (!authority.ok) {
    await Promise.all([
      estimatorSupabase
        .from('plan_extractions')
        .update({ priced_bom: null, priced_at: null, updated_at: new Date().toISOString() })
        .eq('id', extractionId),
      estimatorSupabase
        .from('paint_runs')
        .update({ status: 'ready', updated_at: new Date().toISOString() })
        .eq('id', paintRunId)
        .eq('tenant_id', tenant.id),
    ])
    return Response.json(authority, { status: 422 })
  }

  const { error: upErr } = await estimatorSupabase
    .from('plan_extractions')
    .update({ priced_bom: bom, priced_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', extractionId)
  if (upErr) {
    return Response.json({ ok: false, error: 'persist_failed', detail: upErr.message }, { status: 500 })
  }
  await estimatorSupabase
    .from('paint_runs')
    .update({ status: 'priced', updated_at: new Date().toISOString() })
    .eq('id', paintRunId)
    .eq('tenant_id', tenant.id)

  return Response.json({
    ok: true,
    bom,
    gst_registered: gstRegistered,
    rateRows: rows.length,
    usesSeedDefaults: book.usesSeedDefaults,
  })
}
