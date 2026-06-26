// GET /api/tenant/crm/connect/[provider] — start the CRM OAuth handshake.
//
// Returns the provider authorize URL (the client then sets window.location to
// it). We return JSON rather than issuing a server redirect because the call is
// made with the tradie's Bearer token from the dashboard; the subsequent
// top-level navigation to the CRM carries our signed `state` for the callback.
//
// Next 16: params is a Promise (await it).

import { getServiceClient } from '@/lib/supabase/admin'
import { tenantFromBearer } from '@/lib/tenant/bearer'
import { isSupportedProvider } from '@/lib/crm/provider'
import { getProvider } from '@/lib/crm/registry'
import { makeOAuthState } from '@/lib/crm/oauth-state'

export const dynamic = 'force-dynamic'

export async function GET(
  req: Request,
  ctx: { params: Promise<{ provider: string }> },
) {
  const { provider } = await ctx.params
  if (!isSupportedProvider(provider)) {
    return Response.json({ error: 'unsupported_provider' }, { status: 400 })
  }

  const supabase = getServiceClient()
  const tenant = await tenantFromBearer(supabase, req, 'id')
  if (!tenant) return Response.json({ error: 'unauthorized' }, { status: 401 })

  const impl = getProvider(provider)
  if (!impl.isConfigured()) {
    return Response.json(
      { error: 'provider_not_configured', message: `${provider} OAuth credentials are not set on the server` },
      { status: 503 },
    )
  }

  const state = makeOAuthState(tenant.id as string, provider)
  return Response.json({ url: impl.authorizeUrl(state) })
}
