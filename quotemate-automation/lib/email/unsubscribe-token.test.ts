import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  makeUnsubscribeToken,
  parseUnsubscribeToken,
} from '@/lib/email/unsubscribe-token'

describe('lib/email/unsubscribe-token', () => {
  beforeEach(() => {
    process.env.UNSUBSCRIBE_SECRET = 'test-unsub-secret'
  })
  afterEach(() => {
    delete process.env.UNSUBSCRIBE_SECRET
    delete process.env.ENCRYPTION_KEY
  })

  it('round-trips tenant id + email', () => {
    const tok = makeUnsubscribeToken('tenant-1', 'Lead@Example.com')
    const parsed = parseUnsubscribeToken(tok)
    expect(parsed).toEqual({ tenantId: 'tenant-1', email: 'lead@example.com' })
  })

  it('normalises the email to lowercase + trims', () => {
    const parsed = parseUnsubscribeToken(makeUnsubscribeToken('t', '  MixedCase@X.com '))
    expect(parsed?.email).toBe('mixedcase@x.com')
  })

  it('returns null for a tampered signature', () => {
    const tok = makeUnsubscribeToken('t', 'a@b.com')
    const tampered = tok.slice(0, -2) + (tok.endsWith('AA') ? 'BB' : 'AA')
    expect(parseUnsubscribeToken(tampered)).toBeNull()
  })

  it('returns null when the payload is altered (signature no longer matches)', () => {
    const tok = makeUnsubscribeToken('t', 'a@b.com')
    const [, sig] = tok.split('.')
    const forged = `${Buffer.from(JSON.stringify({ t: 'other', e: 'x@y.com' })).toString('base64url')}.${sig}`
    expect(parseUnsubscribeToken(forged)).toBeNull()
  })

  it('returns null for garbage input', () => {
    expect(parseUnsubscribeToken('')).toBeNull()
    expect(parseUnsubscribeToken('no-dot')).toBeNull()
    expect(parseUnsubscribeToken('.sig')).toBeNull()
  })

  it('falls back to ENCRYPTION_KEY when UNSUBSCRIBE_SECRET is absent', () => {
    delete process.env.UNSUBSCRIBE_SECRET
    process.env.ENCRYPTION_KEY = 'fallback-key'
    const parsed = parseUnsubscribeToken(makeUnsubscribeToken('t', 'a@b.com'))
    expect(parsed).toEqual({ tenantId: 't', email: 'a@b.com' })
  })

  it('throws when no secret is configured', () => {
    delete process.env.UNSUBSCRIBE_SECRET
    delete process.env.ENCRYPTION_KEY
    expect(() => makeUnsubscribeToken('t', 'a@b.com')).toThrow(/not set/)
  })
})
