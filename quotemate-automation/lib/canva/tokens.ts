// Canva Connect — per-tenant token storage + PKCE state (Supabase-backed).
//
// Impure orchestration: persists/refreshes OAuth tokens in `canva_connections`
// and one-time PKCE state in `canva_oauth_states`. The decision logic it leans
// on (expiry, request shaping, response parsing) lives in ./oauth and is unit-
// tested there; this layer only wires those to the DB + token endpoint.

import { marketingSupabase as supabase } from '@/lib/marketing/auth'
import {
  buildTokenRefreshRequest,
  parseTokenResponse,
  isTokenExpired,
  type CanvaTokens,
} from './oauth'
import { readCanvaConfig } from './config'

interface ConnectionRow {
  tenant_id: string
  access_token: string
  refresh_token: string | null
  token_expires_at: string
  scope: string | null
  canva_user_id: string | null
}

export async function getConnection(tenantId: string): Promise<ConnectionRow | null> {
  const { data } = await supabase
    .from('canva_connections')
    .select('tenant_id, access_token, refresh_token, token_expires_at, scope, canva_user_id')
    .eq('tenant_id', tenantId)
    .maybeSingle()
  return (data as ConnectionRow | null) ?? null
}

export async function saveConnection(args: {
  tenantId: string
  tokens: CanvaTokens
  canvaUserId?: string | null
  connectedBy?: string | null
}): Promise<void> {
  await supabase.from('canva_connections').upsert(
    {
      tenant_id: args.tenantId,
      access_token: args.tokens.accessToken,
      refresh_token: args.tokens.refreshToken,
      token_expires_at: new Date(args.tokens.expiresAt).toISOString(),
      scope: args.tokens.scope,
      canva_user_id: args.canvaUserId ?? null,
      connected_by: args.connectedBy ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'tenant_id' },
  )
}

export async function deleteConnection(tenantId: string): Promise<void> {
  await supabase.from('canva_connections').delete().eq('tenant_id', tenantId)
}

/**
 * Return a usable access token for the tenant, refreshing first if it's at/near
 * expiry. Null when the tenant isn't connected or the refresh failed (the UI
 * then re-prompts the connect flow).
 */
export async function getValidAccessToken(tenantId: string, now = Date.now()): Promise<string | null> {
  const conn = await getConnection(tenantId)
  if (!conn) return null

  const expiresAt = Date.parse(conn.token_expires_at)
  if (Number.isFinite(expiresAt) && !isTokenExpired(expiresAt, now)) return conn.access_token

  if (!conn.refresh_token) return null
  const cfg = readCanvaConfig()
  if (!cfg) return null

  const def = buildTokenRefreshRequest({
    clientId: cfg.clientId,
    clientSecret: cfg.clientSecret,
    refreshToken: conn.refresh_token,
  })
  const res = await fetch(def.url, { method: def.method, headers: def.headers, body: def.body })
  if (!res.ok) return null
  const json: unknown = await res.json().catch(() => null)

  let tokens: CanvaTokens
  try {
    tokens = parseTokenResponse(json, now)
  } catch {
    return null
  }
  // Canva doesn't always rotate the refresh token — keep the existing one.
  if (!tokens.refreshToken) tokens.refreshToken = conn.refresh_token
  await saveConnection({ tenantId, tokens, canvaUserId: conn.canva_user_id })
  return tokens.accessToken
}

// ── One-time PKCE state (binds the OAuth callback to one connect attempt) ──

export async function createOauthState(args: {
  state: string
  tenantId: string
  codeVerifier: string
  redirectUri: string
  connectedBy?: string | null
}): Promise<void> {
  await supabase.from('canva_oauth_states').insert({
    state: args.state,
    tenant_id: args.tenantId,
    code_verifier: args.codeVerifier,
    redirect_uri: args.redirectUri,
    connected_by: args.connectedBy ?? null,
  })
}

export interface OauthStateRow {
  tenant_id: string
  code_verifier: string
  redirect_uri: string
  connected_by: string | null
}

interface OauthStateDbRow extends OauthStateRow {
  created_at: string
}

/** Atomically read-and-delete a state row; null if missing or older than 10m. */
export async function consumeOauthState(state: string): Promise<OauthStateRow | null> {
  const { data } = await supabase
    .from('canva_oauth_states')
    .select('tenant_id, code_verifier, redirect_uri, connected_by, created_at')
    .eq('state', state)
    .maybeSingle()
  if (!data) return null
  await supabase.from('canva_oauth_states').delete().eq('state', state)

  const row = data as OauthStateDbRow
  const created = Date.parse(row.created_at)
  if (Number.isFinite(created) && Date.now() - created > 10 * 60_000) return null
  return {
    tenant_id: row.tenant_id,
    code_verifier: row.code_verifier,
    redirect_uri: row.redirect_uri,
    connected_by: row.connected_by ?? null,
  }
}
