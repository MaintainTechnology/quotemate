import type { estimatorSupabase } from '@/lib/estimation/auth'

type PricingClient = typeof estimatorSupabase

export type CommercialPaintPricingBook = {
  id: string
  gst_registered: boolean
}

async function findBookForTrade(
  db: PricingClient,
  tenantId: string,
  trade: string,
): Promise<CommercialPaintPricingBook | null> {
  const { data } = await db
    .from('pricing_book')
    .select('id, gst_registered')
    .eq('tenant_id', tenantId)
    .eq('trade', trade)
    .maybeSingle()
  return (data as CommercialPaintPricingBook | null) ?? null
}

export async function findCommercialPaintPricingBook(
  db: PricingClient,
  tenant: { id: string; trade?: string | null },
): Promise<CommercialPaintPricingBook | null> {
  const selected = await findBookForTrade(db, tenant.id, 'commercial_painting')
  if (selected) return selected

  if (tenant.trade && tenant.trade !== 'commercial_painting') {
    const primary = await findBookForTrade(db, tenant.id, tenant.trade)
    if (primary) return primary
  }

  const { data } = await db
    .from('pricing_book')
    .select('id, gst_registered')
    .eq('tenant_id', tenant.id)
    .limit(1)
    .maybeSingle()
  return (data as CommercialPaintPricingBook | null) ?? null
}
