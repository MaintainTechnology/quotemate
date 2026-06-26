// Flyer Designer — server-only tenant lookup.
//
// The shared tenantForUser (lib/marketing/auth) selects only the 4 fields the
// QR routes need; flyers also need the brand fields used to auto-fill
// templates. Server-only (imports the service-role client), so it is never
// imported by vitest.

import { marketingSupabase } from '@/lib/marketing/auth'
import type { FlyerTenantBrand } from './document'

export type FlyerTenant = FlyerTenantBrand & {
  id: string
  slug: string | null
  twilio_sms_number: string | null
}

export async function tenantBrandForUser(userId: string): Promise<FlyerTenant | null> {
  const { data } = await marketingSupabase
    .from('tenants')
    .select('id, business_name, logo_url, owner_email, owner_mobile, trade, slug, twilio_sms_number')
    .eq('owner_user_id', userId)
    .maybeSingle()
  return (data as FlyerTenant | null) ?? null
}
