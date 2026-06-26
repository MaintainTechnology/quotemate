// POST /api/tenant/crm/disconnect — drop a CRM connection. Clears the stored
// (encrypted) tokens and marks the connection disconnected. Optionally deletes
// the imported contacts too. Body: { provider, deleteContacts?: boolean }.

import { getServiceClient } from '@/lib/supabase/admin'
import { tenantFromBearer } from '@/lib/tenant/bearer'
import { isSupportedProvider } from '@/lib/crm/provider'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const supabase = getServiceClient()
  const tenant = await tenantFromBearer(supabase, req, 'id')
  if (!tenant) return Response.json({ error: 'unauthorized' }, { status: 401 })
  const tenantId = tenant.id as string

  let body: { provider?: string; deleteContacts?: boolean } = {}
  try {
    body = (await req.json()) as { provider?: string; deleteContacts?: boolean }
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 })
  }

  const provider = body.provider
  if (!provider || !isSupportedProvider(provider)) {
    return Response.json({ error: 'unsupported_provider' }, { status: 400 })
  }

  const { data: conn } = await supabase
    .from('crm_connections')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('provider', provider)
    .maybeSingle()

  const { error } = await supabase
    .from('crm_connections')
    .update({
      status: 'disconnected',
      access_token_enc: null,
      refresh_token_enc: null,
      updated_at: new Date().toISOString(),
    })
    .eq('tenant_id', tenantId)
    .eq('provider', provider)
  if (error) return Response.json({ error: error.message }, { status: 500 })

  let contactsDeleted = 0
  if (body.deleteContacts && conn?.id) {
    const { count } = await supabase
      .from('crm_contacts')
      .delete({ count: 'exact' })
      .eq('tenant_id', tenantId)
      .eq('connection_id', conn.id as string)
    contactsDeleted = count ?? 0
  }

  return Response.json({ ok: true, contacts_deleted: contactsDeleted })
}
