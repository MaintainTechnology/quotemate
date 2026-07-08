// GET /api/tenant/crm/callback — OAuth redirect target for HubSpot / Zoho.
//
// This is a plain browser navigation from the CRM with no Authorization header,
// so the tenant identity rides in the signed `state` param (lib/crm/oauth-state).
// We verify state, exchange the code for tokens, store them ENCRYPTED, then
// redirect the tradie back to the dashboard with a status flag.

import { after } from 'next/server'
import { getServiceClient } from '@/lib/supabase/admin'
import { parseOAuthState } from '@/lib/crm/oauth-state'
import { deriveCodeVerifier } from '@/lib/crm/pkce'
import { isSupportedProvider, type ProviderCtx } from '@/lib/crm/provider'
import { getProvider } from '@/lib/crm/registry'
import { resolveZohoDc } from '@/lib/crm/zoho'
import { encryptSecret } from '@/lib/crypto/encrypt'

export const dynamic = 'force-dynamic'

function backTo(req: Request, params: Record<string, string>): Response {
  const url = new URL('/dashboard/crm', req.url)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  return Response.redirect(url, 302)
}

export async function GET(req: Request) {
  // The entire handler is wrapped so a tradie NEVER sees a raw 500 — a missing
  // signing secret, an unconfigured provider, or a provider/network error all
  // degrade to a "couldn't connect" redirect back to the dashboard.
  try {
    const { searchParams } = new URL(req.url)
    const code = searchParams.get('code')
    const stateParam = searchParams.get('state')
    const oauthError = searchParams.get('error')

    if (oauthError) return backTo(req, { crm: 'error', reason: oauthError })
    if (!code || !stateParam) return backTo(req, { crm: 'error', reason: 'missing_code_or_state' })

    const state = parseOAuthState(stateParam)
    if (!state || !isSupportedProvider(state.provider)) {
      return backTo(req, { crm: 'error', reason: 'invalid_state' })
    }

    const provider = getProvider(state.provider)

    // Zoho multi-DC: the code was issued by the tradie's data centre and can
    // ONLY be exchanged against that DC's accounts host. Zoho hands us the DC on
    // the callback (`accounts-server` URL and/or `location` code); resolve it and
    // exchange there. HubSpot is single-DC → these are absent → ctx is empty and
    // the provider ignores it.
    let ctx: ProviderCtx | undefined
    if (state.provider === 'zoho') {
      const dc = resolveZohoDc({
        accountsServer: searchParams.get('accounts-server'),
        location: searchParams.get('location'),
      })
      ctx = { accountsServer: dc.accounts, apiDomain: dc.api }
    }

    // Re-derive the PKCE verifier from the same signed state used to build the
    // authorize URL. HubSpot uses it; providers that don't require PKCE ignore it.
    const tokens = await provider.exchangeCode(code, deriveCodeVerifier(stateParam), ctx)

    // Persist the DC coordinates so later refreshes/syncs hit the right hosts.
    // The token response's api_domain (when present) is authoritative for reads.
    const providerMetadata =
      state.provider === 'zoho'
        ? {
            accounts_server: ctx?.accountsServer ?? null,
            api_domain: tokens.apiDomain ?? ctx?.apiDomain ?? null,
          }
        : {}

    const supabase = getServiceClient()
    const { error } = await supabase.from('crm_connections').upsert(
      {
        tenant_id: state.tenantId,
        provider: state.provider,
        access_token_enc: encryptSecret(tokens.accessToken),
        refresh_token_enc: tokens.refreshToken ? encryptSecret(tokens.refreshToken) : null,
        expires_at: tokens.expiresAt ? new Date(tokens.expiresAt).toISOString() : null,
        provider_metadata: providerMetadata,
        status: 'connected',
        connected_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'tenant_id,provider' },
    )
    if (error) {
      return backTo(req, { crm: 'error', reason: 'store_failed' })
    }

    // Kick off an initial contact import in the background so the dashboard
    // shows contacts without the tradie having to press "Sync".
    after(async () => {
      try {
        const { syncContactsForConnection } = await import('@/lib/crm/sync-runner')
        await syncContactsForConnection(supabase, state.tenantId, state.provider)
      } catch {
        /* best-effort; the tradie can Sync manually */
      }
    })

    return backTo(req, { crm: 'connected', provider: state.provider })
  } catch {
    return backTo(req, { crm: 'error', reason: 'server_error' })
  }
}
