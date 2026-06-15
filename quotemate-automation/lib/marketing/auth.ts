// Shared Bearer-auth + tenant resolution for the dashboard marketing
// endpoints. Same pattern as /api/tenant/me and the invites endpoints,
// extracted here so the qr / slug routes don't each re-declare it.

import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js'

export const marketingSupabase: SupabaseClient = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

export async function userFromBearer(req: Request): Promise<User | null> {
  const auth = req.headers.get('authorization') ?? ''
  if (!auth.toLowerCase().startsWith('bearer ')) return null
  const token = auth.slice(7).trim()
  if (!token) return null
  const { data, error } = await marketingSupabase.auth.getUser(token)
  if (error || !data.user) return null
  return data.user
}

export type TenantRow = {
  id: string
  business_name: string
  slug: string | null
  twilio_sms_number: string | null
}

export async function tenantForUser(userId: string): Promise<TenantRow | null> {
  const { data } = await marketingSupabase
    .from('tenants')
    .select('id, business_name, slug, twilio_sms_number')
    .eq('owner_user_id', userId)
    .maybeSingle()
  return (data as TenantRow | null) ?? null
}
