// CRM provider abstraction. v1 ships HubSpot + Zoho; the interface + registry
// let further CRMs be added without touching the routes. OAuth credentials come
// from env per provider, read at call time so a missing provider config never
// breaks module import or an unrelated provider.

export type CrmProviderId = 'hubspot' | 'zoho'

export const SUPPORTED_PROVIDERS: CrmProviderId[] = ['hubspot', 'zoho']

export function isSupportedProvider(id: string): id is CrmProviderId {
  return (SUPPORTED_PROVIDERS as string[]).includes(id)
}

export type CrmContact = {
  externalId: string
  email: string
  firstName: string | null
  lastName: string | null
}

export type TokenSet = {
  accessToken: string
  refreshToken: string | null
  /** Epoch ms when the access token expires, or null if unknown. */
  expiresAt: number | null
}

export type OAuthConfig = {
  clientId: string
  clientSecret: string
  redirectUri: string
}

export interface CrmProvider {
  readonly id: CrmProviderId
  /** True when this provider's OAuth env is configured. */
  isConfigured(): boolean
  /** The provider authorize URL the tradie is redirected to. */
  authorizeUrl(state: string): string
  /** Exchange an authorization code for tokens. */
  exchangeCode(code: string): Promise<TokenSet>
  /** Refresh an access token. */
  refresh(refreshToken: string): Promise<TokenSet>
  /** Fetch all contacts (email + name), paginating as needed. */
  fetchContacts(accessToken: string): Promise<CrmContact[]>
}

/** Read + validate a provider's OAuth config from env. Throws if incomplete. */
export function readOAuthConfig(prefix: 'HUBSPOT' | 'ZOHO'): OAuthConfig {
  const clientId = process.env[`${prefix}_CLIENT_ID`]
  const clientSecret = process.env[`${prefix}_CLIENT_SECRET`]
  const redirectUri = process.env[`${prefix}_REDIRECT_URI`]
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error(
      `${prefix} OAuth is not configured (need ${prefix}_CLIENT_ID, ${prefix}_CLIENT_SECRET, ${prefix}_REDIRECT_URI)`,
    )
  }
  return { clientId, clientSecret, redirectUri }
}

export function hasOAuthConfig(prefix: 'HUBSPOT' | 'ZOHO'): boolean {
  return Boolean(
    process.env[`${prefix}_CLIENT_ID`] &&
      process.env[`${prefix}_CLIENT_SECRET`] &&
      process.env[`${prefix}_REDIRECT_URI`],
  )
}

// The concrete-provider factory lives in '@/lib/crm/registry' to avoid an import
// cycle (the providers import the types/helpers from this module).
