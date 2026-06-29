import { describe, it, expect } from 'vitest'
import {
  CANVA_AUTHORIZE_URL,
  CANVA_TOKEN_URL,
  CANVA_DEFAULT_SCOPES,
  base64url,
  generateCodeVerifier,
  codeChallengeFromVerifier,
  generateState,
  basicAuthHeader,
  buildAuthorizeUrl,
  buildTokenExchangeRequest,
  buildTokenRefreshRequest,
  parseTokenResponse,
  isTokenExpired,
} from './oauth'

describe('PKCE', () => {
  it('matches the RFC 7636 Appendix B test vector', () => {
    // verifier → S256 challenge, the canonical OAuth PKCE example.
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'
    expect(codeChallengeFromVerifier(verifier)).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM')
  })

  it('generates verifiers in the legal length + charset (43–128, unreserved)', () => {
    for (let i = 0; i < 25; i++) {
      const v = generateCodeVerifier()
      expect(v.length).toBeGreaterThanOrEqual(43)
      expect(v.length).toBeLessThanOrEqual(128)
      expect(v).toMatch(/^[A-Za-z0-9\-._~]+$/)
    }
  })

  it('base64url has no +, / or = padding', () => {
    const s = base64url(Buffer.from([251, 255, 191, 0, 1, 2, 3, 4]))
    expect(s).not.toMatch(/[+/=]/)
  })

  it('generateState is non-empty and url-safe', () => {
    const s = generateState()
    expect(s.length).toBeGreaterThan(10)
    expect(s).toMatch(/^[A-Za-z0-9\-_]+$/)
  })
})

describe('basicAuthHeader', () => {
  it('base64-encodes id:secret with a Basic prefix', () => {
    const h = basicAuthHeader('OC-abc', 's3cr3t')
    expect(h.startsWith('Basic ')).toBe(true)
    expect(Buffer.from(h.slice(6), 'base64').toString('utf8')).toBe('OC-abc:s3cr3t')
  })
})

describe('buildAuthorizeUrl', () => {
  it('builds the consent URL with PKCE S256 and all required params', () => {
    const url = buildAuthorizeUrl({
      clientId: 'OC-123',
      redirectUri: 'https://app.example/api/dashboard/flyer/canva/callback',
      scopes: CANVA_DEFAULT_SCOPES,
      state: 'st-1',
      codeChallenge: 'chal-1',
    })
    expect(url.startsWith(`${CANVA_AUTHORIZE_URL}?`)).toBe(true)
    const q = new URL(url).searchParams
    expect(q.get('response_type')).toBe('code')
    expect(q.get('client_id')).toBe('OC-123')
    expect(q.get('redirect_uri')).toBe('https://app.example/api/dashboard/flyer/canva/callback')
    expect(q.get('code_challenge')).toBe('chal-1')
    expect(q.get('code_challenge_method')).toBe('S256')
    expect(q.get('state')).toBe('st-1')
    // scope is space-delimited and includes the write scope.
    expect(q.get('scope')).toContain('design:content:write')
    expect(q.get('scope')?.split(' ').length).toBe(CANVA_DEFAULT_SCOPES.length)
  })
})

describe('token requests', () => {
  it('authorization_code exchange carries verifier + Basic auth + form body', () => {
    const r = buildTokenExchangeRequest({
      clientId: 'OC-1',
      clientSecret: 'sec',
      code: 'auth-code',
      codeVerifier: 'ver-1',
      redirectUri: 'https://app.example/cb',
    })
    expect(r.url).toBe(CANVA_TOKEN_URL)
    expect(r.method).toBe('POST')
    expect(r.headers['Content-Type']).toBe('application/x-www-form-urlencoded')
    expect(r.headers.Authorization).toBe(basicAuthHeader('OC-1', 'sec'))
    const body = new URLSearchParams(r.body)
    expect(body.get('grant_type')).toBe('authorization_code')
    expect(body.get('code')).toBe('auth-code')
    expect(body.get('code_verifier')).toBe('ver-1')
    expect(body.get('redirect_uri')).toBe('https://app.example/cb')
  })

  it('refresh_token grant carries the refresh token + Basic auth', () => {
    const r = buildTokenRefreshRequest({ clientId: 'OC-1', clientSecret: 'sec', refreshToken: 'rt-9' })
    expect(r.url).toBe(CANVA_TOKEN_URL)
    const body = new URLSearchParams(r.body)
    expect(body.get('grant_type')).toBe('refresh_token')
    expect(body.get('refresh_token')).toBe('rt-9')
    expect(r.headers.Authorization).toBe(basicAuthHeader('OC-1', 'sec'))
  })
})

describe('parseTokenResponse', () => {
  it('converts expires_in into an absolute expiry', () => {
    const now = 1_000_000
    const t = parseTokenResponse(
      { access_token: 'AT', refresh_token: 'RT', expires_in: 3600, scope: 'design:content:write' },
      now,
    )
    expect(t.accessToken).toBe('AT')
    expect(t.refreshToken).toBe('RT')
    expect(t.expiresAt).toBe(now + 3600 * 1000)
    expect(t.scope).toBe('design:content:write')
  })

  it('falls back to a 4h lifetime and null refresh when fields are absent', () => {
    const now = 0
    const t = parseTokenResponse({ access_token: 'AT' }, now)
    expect(t.refreshToken).toBeNull()
    expect(t.expiresAt).toBe(14400 * 1000)
  })

  it('throws when no access token is present', () => {
    expect(() => parseTokenResponse({ token_type: 'bearer' }, 0)).toThrow()
  })
})

describe('isTokenExpired', () => {
  it('is true at/after expiry and within the skew window', () => {
    expect(isTokenExpired(1000, 1000)).toBe(true) // exactly at expiry
    expect(isTokenExpired(1000, 2000)).toBe(true) // past expiry
    expect(isTokenExpired(100_000, 50_000, 60_000)).toBe(true) // inside 60s skew
  })

  it('is false when comfortably valid', () => {
    expect(isTokenExpired(100_000, 1_000, 60_000)).toBe(false)
  })
})
