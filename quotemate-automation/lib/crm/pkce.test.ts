import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { codeChallengeS256, deriveCodeVerifier } from '@/lib/crm/pkce'

describe('lib/crm/pkce', () => {
  beforeEach(() => {
    process.env.OAUTH_STATE_SECRET = 'pkce-test-secret'
  })
  afterEach(() => {
    delete process.env.OAUTH_STATE_SECRET
    delete process.env.ENCRYPTION_KEY
  })

  it('derives a deterministic verifier from the same state', () => {
    const a = deriveCodeVerifier('state-abc')
    const b = deriveCodeVerifier('state-abc')
    expect(a).toBe(b)
  })

  it('derives different verifiers for different states', () => {
    expect(deriveCodeVerifier('state-1')).not.toBe(deriveCodeVerifier('state-2'))
  })

  it('produces a verifier in the PKCE-allowed charset and length (43–128)', () => {
    const v = deriveCodeVerifier('some-state')
    expect(v).toMatch(/^[A-Za-z0-9\-_]+$/)
    expect(v.length).toBeGreaterThanOrEqual(43)
    expect(v.length).toBeLessThanOrEqual(128)
  })

  it('the verifier is secret-dependent (unpredictable without the secret)', () => {
    const v1 = deriveCodeVerifier('state-x')
    process.env.OAUTH_STATE_SECRET = 'different-secret'
    expect(deriveCodeVerifier('state-x')).not.toBe(v1)
  })

  it('computes the S256 challenge per the RFC 7636 known-answer vector', () => {
    // RFC 7636 Appendix B.
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'
    expect(codeChallengeS256(verifier)).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM')
  })

  it('throws a clear error when no secret is configured', () => {
    delete process.env.OAUTH_STATE_SECRET
    expect(() => deriveCodeVerifier('s')).toThrow(/not set/)
  })

  it('falls back to ENCRYPTION_KEY when OAUTH_STATE_SECRET is absent', () => {
    delete process.env.OAUTH_STATE_SECRET
    process.env.ENCRYPTION_KEY = 'fallback'
    expect(deriveCodeVerifier('s')).toBeTruthy()
  })
})
