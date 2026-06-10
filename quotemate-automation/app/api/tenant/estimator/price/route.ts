// POST /api/tenant/estimator/price — indicative pricing for a take-off.
//
// Body: { items: Array<{ type: string; count: number }> }
// Loads the tenant's electrical assemblies (custom + shared) and pricing book,
// then prices deterministically (grounded — no LLM, no free-form prices).
// Items with no catalogue match come back UNMATCHED, not guessed.

import { tenantFromBearer, estimatorSupabase as supabase } from '@/lib/estimation/auth'
import { priceTakeoff, type AssemblyRow, type PricingBook, type TakeoffItem } from '@/lib/estimation/price'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const ASSEMBLY_COLS = 'name, category, default_unit_price_ex_gst, default_labour_hours, default_unit'
const BOOK_COLS = 'hourly_rate, default_markup_pct, min_labour_hours, gst_registered'
const DEFAULT_BOOK: PricingBook = { hourly_rate: 110, default_markup_pct: 28, min_labour_hours: 2, gst_registered: true }

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
    .map((r) => ({
      type: String(r.type ?? r.item ?? r.name ?? '').trim(),
      count: Number(r.count) || 0,
      // Take-off provenance → priced-line audit trace.
      ...(r.confidence === 'high' || r.confidence === 'medium' || r.confidence === 'low'
        ? { confidence: r.confidence }
        : {}),
      ...(r.note != null && String(r.note).trim() ? { note: String(r.note) } : {}),
    }))
    .filter((i) => i.type)

  // Load assemblies: tenant-custom first (so tenant overrides win on ties), then shared.
  const [customRes, sharedRes] = await Promise.all([
    supabase
      .from('tenant_custom_assemblies')
      .select(ASSEMBLY_COLS)
      .eq('tenant_id', tenant.id)
      .eq('trade', 'electrical')
      .eq('enabled', true),
    supabase.from('shared_assemblies').select(ASSEMBLY_COLS).eq('trade', 'electrical'),
  ])
  const assemblies: AssemblyRow[] = [
    ...((customRes.data ?? []) as AssemblyRow[]),
    ...((sharedRes.data ?? []) as AssemblyRow[]),
  ]

  // Pricing book: the tenant's electrical row, else a trade default (tenant_id null), else hardcoded.
  let book: PricingBook = DEFAULT_BOOK
  let bookSource: 'tenant' | 'default' | 'fallback' = 'fallback'
  const own = await supabase.from('pricing_book').select(BOOK_COLS).eq('tenant_id', tenant.id).eq('trade', 'electrical').maybeSingle()
  if (own.data) {
    book = own.data as PricingBook
    bookSource = 'tenant'
  } else {
    const def = await supabase.from('pricing_book').select(BOOK_COLS).is('tenant_id', null).eq('trade', 'electrical').maybeSingle()
    if (def.data) {
      book = def.data as PricingBook
      bookSource = 'default'
    }
  }

  const bom = priceTakeoff(items, assemblies, book)
  return Response.json({ ok: true, bom, catalogueSize: assemblies.length, pricingBookSource: bookSource })
}
