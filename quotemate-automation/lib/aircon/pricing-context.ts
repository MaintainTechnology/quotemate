import type { SupabaseClient } from '@supabase/supabase-js'
import { parseTenantAcRateCard } from './recommend'
import type { AcRateCard } from './types'

/** Load only a complete tenant-authored card; malformed or missing overlays are unpriced. */
export async function loadTenantAcRateCard(
  db: SupabaseClient,
  tenantId: string,
  primaryTrade: string | null,
): Promise<AcRateCard | null> {
  try {
    let query = db.from('pricing_book').select('overlays').eq('tenant_id', tenantId)
    if (primaryTrade) query = query.eq('trade', primaryTrade)
    const { data } = await query.limit(1).maybeSingle()
    const overlays = (data?.overlays as Record<string, unknown> | null | undefined) ?? null
    return parseTenantAcRateCard(overlays?.aircon_rate_card)
  } catch {
    return null
  }
}
