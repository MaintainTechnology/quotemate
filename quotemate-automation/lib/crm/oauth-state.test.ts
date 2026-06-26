import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { makeOAuthState, parseOAuthState } from '@/lib/crm/oauth-state'

describe('lib/crm/oauth-state', () => {
  beforeEach(() => {
    process.env.OAUTH_STATE_SECRET = 'state-secret'
  })
  afterEach(() => {
    delete process.env.OAUTH_STATE_SECRET
    delete process.env.ENCRYPTION_KEY
  })

  it('round-trips tenant id + provider', () => {
    const tok = makeOAuthState('tenant-1', 'hubspot')
    expect(parseOAuthState(tok)).toEqual({ tenantId: 'tenant-1', provider: 'hubspot' })
  })

  it('rejects a tampered signature', () => {
    const tok = makeOAuthState('t', 'zoho')
    expect(parseOAuthState(tok.slice(0, -1) + (tok.endsWith('a') ? 'b' : 'a'))).toBeNull()
  })

  it('rejects an expired state (older than the TTL)', () => {
    const tok = makeOAuthState('t', 'hubspot')
    const wayLater = Date.now() + 16 * 60 * 1000
    expect(parseOAuthState(tok, wayLater)).toBeNull()
  })

  it('accepts a state within the TTL window', () => {
    const tok = makeOAuthState('t', 'hubspot')
    const soon = Date.now() + 5 * 60 * 1000
    expect(parseOAuthState(tok, soon)).toEqual({ tenantId: 't', provider: 'hubspot' })
  })

  it('rejects garbage', () => {
    expect(parseOAuthState('')).toBeNull()
    expect(parseOAuthState('nodot')).toBeNull()
  })

  it('throws when no secret is configured', () => {
    delete process.env.OAUTH_STATE_SECRET
    expect(() => makeOAuthState('t', 'hubspot')).toThrow(/not set/)
  })
})
