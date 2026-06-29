// Canva Connect — OAuth 2.0 (Authorization Code + PKCE, S256) primitives.
//
// Pure, server-only helpers that BUILD the requests and DECODE the responses
// for Canva's OAuth flow. No network, no DB — so vitest (node env) unit-tests
// every URL and request shape without secrets or a live Canva account.
// Endpoints + flow per https://www.canva.dev/docs/connect/authentication/.
//
// Server-only (imports node:crypto). Never import from a 'use client' module.

import { createHash, randomBytes } from 'node:crypto'

export const CANVA_AUTHORIZE_URL = 'https://www.canva.com/api/oauth/authorize'
export const CANVA_TOKEN_URL = 'https://api.canva.com/rest/v1/oauth/token'
export const CANVA_API_BASE = 'https://api.canva.com/rest/v1'

/** Scopes the flyer integration needs: read/write designs + assets + profile. */
export const CANVA_DEFAULT_SCOPES = [
  'design:content:read',
  'design:content:write',
  'design:meta:read',
  'asset:read',
  'asset:write',
  'profile:read',
] as const

/** Base64url (RFC 4648 §5) — base64 with +/ → -_ and no padding. */
export function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** A high-entropy PKCE `code_verifier` (43–128 chars of the unreserved set). */
export function generateCodeVerifier(byteLength = 64): string {
  return base64url(randomBytes(byteLength)).slice(0, 128)
}

/** `code_challenge` = base64url(SHA-256(code_verifier)). */
export function codeChallengeFromVerifier(verifier: string): string {
  return base64url(createHash('sha256').update(verifier).digest())
}

/** An unguessable `state` value that binds the callback to one connect attempt. */
export function generateState(byteLength = 32): string {
  return base64url(randomBytes(byteLength))
}

/** HTTP Basic credential for the token endpoint: `Basic base64(id:secret)`. */
export function basicAuthHeader(clientId: string, clientSecret: string): string {
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`
}

export interface AuthorizeUrlParams {
  clientId: string
  redirectUri: string
  scopes: readonly string[]
  state: string
  codeChallenge: string
}

/** Build the Canva consent URL the user is sent to (popup/redirect). */
export function buildAuthorizeUrl(p: AuthorizeUrlParams): string {
  const q = new URLSearchParams({
    response_type: 'code',
    client_id: p.clientId,
    redirect_uri: p.redirectUri,
    scope: p.scopes.join(' '),
    code_challenge: p.codeChallenge,
    code_challenge_method: 'S256',
    state: p.state,
  })
  return `${CANVA_AUTHORIZE_URL}?${q.toString()}`
}

export interface TokenHttpRequest {
  url: string
  method: 'POST'
  headers: Record<string, string>
  body: string
}

/** Exchange an authorization `code` (+ PKCE verifier) for tokens. */
export function buildTokenExchangeRequest(args: {
  clientId: string
  clientSecret: string
  code: string
  codeVerifier: string
  redirectUri: string
}): TokenHttpRequest {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: args.code,
    code_verifier: args.codeVerifier,
    redirect_uri: args.redirectUri,
  })
  return {
    url: CANVA_TOKEN_URL,
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: basicAuthHeader(args.clientId, args.clientSecret),
    },
    body: body.toString(),
  }
}

/** Renew an access token from a (rotating) refresh token. */
export function buildTokenRefreshRequest(args: {
  clientId: string
  clientSecret: string
  refreshToken: string
}): TokenHttpRequest {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: args.refreshToken,
  })
  return {
    url: CANVA_TOKEN_URL,
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: basicAuthHeader(args.clientId, args.clientSecret),
    },
    body: body.toString(),
  }
}

export interface CanvaTokens {
  accessToken: string
  refreshToken: string | null
  expiresAt: number
  scope: string | null
}

/** Normalize Canva's token response into absolute-expiry tokens. */
export function parseTokenResponse(json: unknown, nowMs: number): CanvaTokens {
  const o = (json ?? {}) as Record<string, unknown>
  const accessToken = typeof o.access_token === 'string' ? o.access_token : ''
  if (!accessToken) throw new Error('canva_token_missing_access_token')
  const refreshToken = typeof o.refresh_token === 'string' ? o.refresh_token : null
  const expiresInSec = typeof o.expires_in === 'number' && o.expires_in > 0 ? o.expires_in : 14400
  const scope = typeof o.scope === 'string' ? o.scope : null
  return { accessToken, refreshToken, expiresAt: nowMs + expiresInSec * 1000, scope }
}

/** True when the access token is at/near expiry (default 60s clock skew). */
export function isTokenExpired(expiresAtMs: number, nowMs: number, skewMs = 60_000): boolean {
  return nowMs + skewMs >= expiresAtMs
}
