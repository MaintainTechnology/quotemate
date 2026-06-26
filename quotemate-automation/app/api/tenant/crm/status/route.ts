// GET /api/tenant/crm/status — the dashboard "Marketing / CRM" panel state:
// which providers are available to connect, the tenant's current connection(s),
// imported contact count, unsubscribe count, and the announcement campaign
// summary. Bearer auth (same pattern as /api/tenant/me).

import { getServiceClient } from '@/lib/supabase/admin'
import { tenantFromBearer } from '@/lib/tenant/bearer'
import { configuredProviders } from '@/lib/crm/registry'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const supabase = getServiceClient()
  const tenant = await tenantFromBearer(supabase, req, 'id, business_name, business_address, twilio_sms_number')
  if (!tenant) return Response.json({ error: 'unauthorized' }, { status: 401 })
  const tenantId = tenant.id as string

  const [connections, contactCount, unsubCount, campaign] = await Promise.all([
    supabase
      .from('crm_connections')
      .select('provider, status, connected_at, last_synced_at')
      .eq('tenant_id', tenantId)
      .order('connected_at', { ascending: false }),
    supabase
      .from('crm_contacts')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId),
    supabase
      .from('email_unsubscribes')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId),
    supabase
      .from('email_campaigns')
      .select('id, status, recipient_count, sent_count, failed_count, last_sent_at')
      .eq('tenant_id', tenantId)
      .eq('type', 'announcement')
      .maybeSingle(),
  ])

  // The announcement email needs a physical address + Twilio number to be
  // compliant + useful; surface whether the profile is ready to send.
  const missingForSend: string[] = []
  if (!tenant.business_address) missingForSend.push('business_address')
  if (!tenant.twilio_sms_number) missingForSend.push('twilio_sms_number')

  return Response.json({
    providers_available: configuredProviders(),
    connections: connections.data ?? [],
    contact_count: contactCount.count ?? 0,
    unsubscribe_count: unsubCount.count ?? 0,
    campaign: campaign.data ?? null,
    ready_to_send: missingForSend.length === 0,
    missing_for_send: missingForSend,
  })
}
