// HubSpot CRM provider. OAuth2 authorization-code flow + contacts read.
// Docs: https://developers.hubspot.com/docs/api/oauth-quickstart-guide
//       https://developers.hubspot.com/docs/api/crm/contacts

import {
  hasOAuthConfig,
  readOAuthConfig,
  type CrmContact,
  type CrmProvider,
  type TokenSet,
} from '@/lib/crm/provider'
import { codeChallengeS256, deriveCodeVerifier } from '@/lib/crm/pkce'

const AUTHORIZE_URL = 'https://app.hubspot.com/oauth/authorize'
// v3 token endpoint (OAuth 2.1) — HubSpot recommends v3 for all new public apps
// built on the 2026 developer platform; v1 is deprecated-but-operational. Params
// go in the form body (which we already do). Verified 2026-06-30.
const TOKEN_URL = 'https://api.hubapi.com/oauth/v3/token'
const CONTACTS_URL = 'https://api.hubapi.com/crm/v3/objects/contacts'
const SCOPE = 'crm.objects.contacts.read'

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

export class HubspotProvider implements CrmProvider {
  readonly id = 'hubspot' as const

  isConfigured(): boolean {
    return hasOAuthConfig('HUBSPOT')
  }

  authorizeUrl(state: string): string {
    const cfg = readOAuthConfig('HUBSPOT')
    // PKCE (required by HubSpot's new-platform apps): send the S256 challenge of
    // the per-flow verifier derived from this state. The callback re-derives the
    // verifier from the same state for the token exchange.
    const challenge = codeChallengeS256(deriveCodeVerifier(state))
    const params = new URLSearchParams({
      client_id: cfg.clientId,
      redirect_uri: cfg.redirectUri,
      scope: SCOPE,
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
    })
    return `${AUTHORIZE_URL}?${params.toString()}`
  }

  async exchangeCode(code: string, codeVerifier?: string): Promise<TokenSet> {
    const cfg = readOAuthConfig('HUBSPOT')
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      redirect_uri: cfg.redirectUri,
      code,
    })
    // PKCE: prove this is the same client that started the flow.
    if (codeVerifier) body.set('code_verifier', codeVerifier)
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    })
    if (!res.ok) {
      throw new Error(`hubspot token exchange failed (${res.status}): ${await res.text()}`)
    }
    return toTokenSet(await res.json())
  }

  async refresh(refreshToken: string): Promise<TokenSet> {
    const cfg = readOAuthConfig('HUBSPOT')
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      refresh_token: refreshToken,
    })
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    })
    if (!res.ok) {
      throw new Error(`hubspot token refresh failed (${res.status}): ${await res.text()}`)
    }
    const json = await res.json()
    // HubSpot may omit a fresh refresh_token; keep the existing one if so.
    return {
      ...toTokenSet(json),
      refreshToken: json.refresh_token ?? refreshToken,
    }
  }

  async fetchContacts(accessToken: string): Promise<CrmContact[]> {
    const out: CrmContact[] = []
    let after: string | undefined
    // Hard page cap to avoid runaway loops on a pathological response.
    for (let page = 0; page < 1000; page++) {
      const params = new URLSearchParams({
        limit: '100',
        properties: 'email,firstname,lastname',
      })
      if (after) params.set('after', after)

      const res = await fetch(`${CONTACTS_URL}?${params.toString()}`, {
        headers: { authorization: `Bearer ${accessToken}` },
      })
      if (!res.ok) {
        throw new Error(`hubspot contacts fetch failed (${res.status}): ${await res.text()}`)
      }
      const json = (await res.json()) as {
        results?: Array<{ id: string; properties?: Record<string, string | null> }>
        paging?: { next?: { after?: string } }
      }
      for (const r of json.results ?? []) {
        const email = r.properties?.email
        if (!email) continue
        out.push({
          externalId: r.id,
          email,
          firstName: r.properties?.firstname ?? null,
          lastName: r.properties?.lastname ?? null,
        })
      }
      after = json.paging?.next?.after
      if (!after) break
    }
    return out
  }
}
