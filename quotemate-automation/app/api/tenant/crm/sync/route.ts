// POST /api/tenant/crm/sync — re-import the tradie's CRM contacts on demand.
// Body: { provider: 'hubspot' | 'zoho' }. Bearer auth.

import { getServiceClient } from '@/lib/supabase/admin'
import { tenantFromBearer } from '@/lib/tenant/bearer'
import { isSupportedProvider } from '@/lib/crm/provider'
import { syncContactsForConnection } from '@/lib/crm/sync-runner'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(req: Request) {
  const supabase = getServiceClient()
  const tenant = await tenantFromBearer(supabase, req, 'id')
  if (!tenant) return Response.json({ error: 'unauthorized' }, { status: 401 })

  let body: { provider?: string } = {}
  try {
    body = (await req.json()) as { provider?: string }
  } catch {
    /* empty body is allowed if the tenant has exactly one connection */
  }

  let provider = body.provider
  if (!provider) {
    const { data } = await supabase
      .from('crm_connections')
      .select('provider')
      .eq('tenant_id', tenant.id as string)
      .eq('status', 'connected')
      .limit(2)
    if (!data || data.length === 0) {
      return Response.json({ error: 'no_connection' }, { status: 404 })
    }
    if (data.length > 1) {
      return Response.json({ error: 'provider_required' }, { status: 400 })
    }
    provider = data[0].provider as string
  }

  if (!isSupportedProvider(provider)) {
    return Response.json({ error: 'unsupported_provider' }, { status: 400 })
  }

  try {
    const result = await syncContactsForConnection(supabase, tenant.id as string, provider)
    return Response.json({ ok: true, ...result })
  } catch (err) {
    const message = String((err as Error)?.message ?? err)
    if (message === 'no_connection') {
      return Response.json({ error: 'no_connection' }, { status: 404 })
    }
    return Response.json({ error: 'sync_failed', message }, { status: 502 })
  }
}
