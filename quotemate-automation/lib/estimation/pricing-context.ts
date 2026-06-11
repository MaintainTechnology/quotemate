// Loads the data the grounded plan-take-off pricer needs for one tenant:
// electrical assemblies (tenant-custom first so overrides win on ties, then
// shared) and the pricing book (tenant row → trade default → hardcoded).
//
// Extracted from app/api/tenant/estimator/price/route.ts so the SMS
// estimator pipeline prices through the IDENTICAL path — one pricing
// data-fetch, one priceTakeoff(), no fork.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { AssemblyRow, PricingBook } from './price'

const ASSEMBLY_COLS = 'name, category, default_unit_price_ex_gst, default_labour_hours, default_unit'
const BOOK_COLS = 'hourly_rate, default_markup_pct, min_labour_hours, gst_registered'
const DEFAULT_BOOK: PricingBook = { hourly_rate: 110, default_markup_pct: 28, min_labour_hours: 2, gst_registered: true }

export type PricingContext = {
  assemblies: AssemblyRow[]
  book: PricingBook
  bookSource: 'tenant' | 'default' | 'fallback'
}

export async function loadElectricalPricingContext(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<PricingContext> {
  const [customRes, sharedRes] = await Promise.all([
    supabase
      .from('tenant_custom_assemblies')
      .select(ASSEMBLY_COLS)
      .eq('tenant_id', tenantId)
      .eq('trade', 'electrical')
      .eq('enabled', true),
    supabase.from('shared_assemblies').select(ASSEMBLY_COLS).eq('trade', 'electrical'),
  ])
  const assemblies: AssemblyRow[] = [
    ...((customRes.data ?? []) as AssemblyRow[]),
    ...((sharedRes.data ?? []) as AssemblyRow[]),
  ]

  let book: PricingBook = DEFAULT_BOOK
  let bookSource: PricingContext['bookSource'] = 'fallback'
  const own = await supabase
    .from('pricing_book')
    .select(BOOK_COLS)
    .eq('tenant_id', tenantId)
    .eq('trade', 'electrical')
    .maybeSingle()
  if (own.data) {
    book = own.data as PricingBook
    bookSource = 'tenant'
  } else {
    const def = await supabase
      .from('pricing_book')
      .select(BOOK_COLS)
      .is('tenant_id', null)
      .eq('trade', 'electrical')
      .maybeSingle()
    if (def.data) {
      book = def.data as PricingBook
      bookSource = 'default'
    }
  }

  return { assemblies, book, bookSource }
}
