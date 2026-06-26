// Zoho CRM provider. OAuth2 authorization-code flow + contacts read.
// Docs: https://www.zoho.com/crm/developer/docs/api/v3/
//
// Zoho is region-partitioned (.com, .com.au, .eu, .in …). The accounts + API
// domains are configurable via env so AU tenants can point at the .com.au DC;
// they default to the global .com domains.

import {
  hasOAuthConfig,
  readOAuthConfig,
  type CrmContact,
  type CrmProvider,
  type TokenSet,
} from '@/lib/crm/provider'

const SCOPE = 'ZohoCRM.modules.contacts.READ'

function accountsDomain(): string {
  return (process.env.ZOHO_ACCOUNTS_DOMAIN || 'https://accounts.zoho.com').replace(/\/+$/, '')
}
function apiDomain(): string {
  return (process.env.ZOHO_API_DOMAIN || 'https://www.zohoapis.com').replace(/\/+$/, '')
}

function toTokenSet(json: {
  access_token: string
  refresh_token?: string
  expires_in?: number
}): TokenSet {
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token ?? null,
    expiresAt: json.expires_in ? Date.now() + json.expires_in * 1000 : null,
  }
}

export class ZohoProvider implements CrmProvider {
  readonly id = 'zoho' as const

  isConfigured(): boolean {
    return hasOAuthConfig('ZOHO')
  }

  authorizeUrl(state: string): string {
    const cfg = readOAuthConfig('ZOHO')
    const params = new URLSearchParams({
      scope: SCOPE,
      client_id: cfg.clientId,
      response_type: 'code',
      access_type: 'offline',
      redirect_uri: cfg.redirectUri,
      state,
      // prompt=consent forces Zoho to return a refresh_token on re-auth.
      prompt: 'consent',
    })
    return `${accountsDomain()}/oauth/v2/auth?${params.toString()}`
  }

  async exchangeCode(code: string): Promise<TokenSet> {
    const cfg = readOAuthConfig('ZOHO')
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      redirect_uri: cfg.redirectUri,
      code,
    })
    const res = await fetch(`${accountsDomain()}/oauth/v2/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    })
    if (!res.ok) {
      throw new Error(`zoho token exchange failed (${res.status}): ${await res.text()}`)
    }
    const json = await res.json()
    if (json.error) throw new Error(`zoho token exchange error: ${json.error}`)
    return toTokenSet(json)
  }

  async refresh(refreshToken: string): Promise<TokenSet> {
    const cfg = readOAuthConfig('ZOHO')
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      refresh_token: refreshToken,
    })
    const res = await fetch(`${accountsDomain()}/oauth/v2/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    })
    if (!res.ok) {
      throw new Error(`zoho token refresh failed (${res.status}): ${await res.text()}`)
    }
    const json = await res.json()
    if (json.error) throw new Error(`zoho token refresh error: ${json.error}`)
    // Zoho refresh responses do not include a new refresh_token — reuse it.
    return { ...toTokenSet(json), refreshToken }
  }

  async fetchContacts(accessToken: string): Promise<CrmContact[]> {
    const out: CrmContact[] = []
    let page = 1
    const perPage = 200
    for (let i = 0; i < 1000; i++) {
      const params = new URLSearchParams({
        fields: 'Email,First_Name,Last_Name',
        per_page: String(perPage),
        page: String(page),
      })
      const res = await fetch(`${apiDomain()}/crm/v3/Contacts?${params.toString()}`, {
        headers: { authorization: `Zoho-oauthtoken ${accessToken}` },
      })
      // 204 = no more records.
      if (res.status === 204) break
      if (!res.ok) {
        throw new Error(`zoho contacts fetch failed (${res.status}): ${await res.text()}`)
      }
      const json = (await res.json()) as {
        data?: Array<{ id: string; Email?: string | null; First_Name?: string | null; Last_Name?: string | null }>
        info?: { more_records?: boolean }
      }
      for (const r of json.data ?? []) {
        if (!r.Email) continue
        out.push({
          externalId: r.id,
          email: r.Email,
          firstName: r.First_Name ?? null,
          lastName: r.Last_Name ?? null,
        })
      }
      if (!json.info?.more_records) break
      page++
    }
    return out
  }
}
