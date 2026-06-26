// Shared Bearer-token → tenant resolution, mirroring the inline pattern in
// app/api/tenant/* routes. Validates the Supabase access token and loads the
// caller's tenant row. Returns null on any auth failure so callers can answer
// 401 uniformly.

import type { SupabaseClient } from '@supabase/supabase-js'

export async function tenantFromBearer(
  supabase: SupabaseClient,
  req: Request,
  columns = 'id',
): Promise<Record<string, unknown> | null> {
  const auth = req.headers.get('authorization') ?? ''
  if (!auth.toLowerCase().startsWith('bearer ')) return null
  const token = auth.slice(7).trim()
  if (!token) return null

  const { data, error } = await supabase.auth.getUser(token)
  if (error || !data.user) return null

  const { data: tenant } = await supabase
    .from('tenants')
    .select(columns)
    .eq('owner_user_id', data.user.id)
    .maybeSingle()

  return (tenant as Record<string, unknown> | null) ?? null
}
