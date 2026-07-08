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
  type ProviderCtx,
  type TokenSet,
} from '@/lib/crm/provider'

const SCOPE = 'ZohoCRM.modules.contacts.READ'

// Zoho is region-partitioned across data centres. The authorisation code is
// issued by the USER's DC and can only be exchanged against that DC's accounts
// host; API reads must hit that DC's api host. Zoho returns the user's DC on the
// OAuth callback (`accounts-server` full URL and/or `location` code) and the
// token response carries `api_domain`. This table lets us resolve a `location`
// code to both hosts when only the code is present.
// Ref: https://www.zoho.com/accounts/protocol/oauth/multi-dc.html
const ZOHO_DC: Record<string, { accounts: string; api: string }> = {
  us: { accounts: 'https://accounts.zoho.com', api: 'https://www.zohoapis.com' },
  eu: { accounts: 'https://accounts.zoho.eu', api: 'https://www.zohoapis.eu' },
  in: { accounts: 'https://accounts.zoho.in', api: 'https://www.zohoapis.in' },
  au: { accounts: 'https://accounts.zoho.com.au', api: 'https://www.zohoapis.com.au' },
  jp: { accounts: 'https://accounts.zoho.jp', api: 'https://www.zohoapis.jp' },
  ca: { accounts: 'https://accounts.zohocloud.ca', api: 'https://www.zohoapis.ca' },
  sa: { accounts: 'https://accounts.zoho.sa', api: 'https://www.zohoapis.sa' },
  uk: { accounts: 'https://accounts.zoho.uk', api: 'https://www.zohoapis.uk' },
}

const strip = (s: string) => s.replace(/\/+$/, '')

/**
 * Resolve the accounts + api hosts for a Zoho OAuth callback. Prefers the
 * authoritative values Zoho hands us (`accounts-server` URL, `location` code),
 * falling back to the env-configured / global default. Exported for the
 * callback route + tests. `apiHint` is the token response's `api_domain` when
 * already known.
 */
export function resolveZohoDc(opts?: {
  accountsServer?: string | null
  location?: string | null
  apiHint?: string | null
}): { accounts: string; api: string } {
  const loc = opts?.location?.toLowerCase().trim()
  const byLoc = loc ? ZOHO_DC[loc] : undefined
  const accounts = strip(
    opts?.accountsServer?.trim() ||
      byLoc?.accounts ||
      process.env.ZOHO_ACCOUNTS_DOMAIN ||
      'https://accounts.zoho.com',
  )
  const api = strip(
    opts?.apiHint?.trim() ||
      byLoc?.api ||
      process.env.ZOHO_API_DOMAIN ||
      'https://www.zohoapis.com',
  )
  return { accounts, api }
}

/** Accounts host for a call: per-connection ctx wins, else env, else global. */
function accountsDomain(ctx?: ProviderCtx): string {
  return strip(
    ctx?.accountsServer?.trim() || process.env.ZOHO_ACCOUNTS_DOMAIN || 'https://accounts.zoho.com',
  )
}
/** API host for a call: per-connection ctx wins, else env, else global. */
function apiDomain(ctx?: ProviderCtx): string {
  return strip(ctx?.apiDomain?.trim() || process.env.ZOHO_API_DOMAIN || 'https://www.zohoapis.com')
}

function toTokenSet(json: {
  access_token: string
  refresh_token?: string
  expires_in?: number
  api_domain?: string
}): TokenSet {
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token ?? null,
    expiresAt: json.expires_in ? Date.now() + json.expires_in * 1000 : null,
    // Zoho reports the DC-correct API host on every token response; persist it
    // so later syncs read from the right data centre.
    apiDomain: json.api_domain ? strip(json.api_domain) : null,
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

  // Zoho doesn't require PKCE; the codeVerifier param is accepted (to satisfy
  // the shared interface) but unused. `ctx.accountsServer` targets the user's
  // DC — the code can ONLY be exchanged there (exchanging an AU code against
  // the global .com host fails), so this is what fixes non-US connects.
  async exchangeCode(code: string, _codeVerifier?: string, ctx?: ProviderCtx): Promise<TokenSet> {
    const cfg = readOAuthConfig('ZOHO')
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      redirect_uri: cfg.redirectUri,
      code,
    })
    const res = await fetch(`${accountsDomain(ctx)}/oauth/v2/token`, {
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

  async refresh(refreshToken: string, ctx?: ProviderCtx): Promise<TokenSet> {
    const cfg = readOAuthConfig('ZOHO')
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      refresh_token: refreshToken,
    })
    const res = await fetch(`${accountsDomain(ctx)}/oauth/v2/token`, {
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

  async fetchContacts(accessToken: string, ctx?: ProviderCtx): Promise<CrmContact[]> {
    const out: CrmContact[] = []
    let page = 1
    const perPage = 200
    for (let i = 0; i < 1000; i++) {
      const params = new URLSearchParams({
        fields: 'Email,First_Name,Last_Name',
        per_page: String(perPage),
        page: String(page),
      })
      const res = await fetch(`${apiDomain(ctx)}/crm/v3/Contacts?${params.toString()}`, {
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
