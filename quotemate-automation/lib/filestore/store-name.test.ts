import { describe, expect, it } from 'vitest'
import {
  bareStoreId,
  displayNameMatchesSession,
  sessionStoreDisplayName,
  sessionStoreKey,
} from './store-name'

describe('sessionStoreKey', () => {
  it('is deterministic and namespaced by estimator + session id', () => {
    expect(sessionStoreKey('paint', 'abc-123')).toBe('qm-paint-abc-123')
    expect(sessionStoreKey('electrical', 'abc-123')).toBe('qm-electrical-abc-123')
    // stable across calls
    expect(sessionStoreKey('paint', 'abc-123')).toBe(sessionStoreKey('paint', 'abc-123'))
  })

  it('slugifies ids to a safe lowercase token', () => {
    expect(sessionStoreKey('paint', 'Run_42/Foo!')).toBe('qm-paint-run-42-foo')
  })

  it('caps the key at 128 chars', () => {
    const key = sessionStoreKey('paint', 'x'.repeat(400))
    expect(key.length).toBeLessThanOrEqual(128)
  })

  it('throws on an empty session id', () => {
    expect(() => sessionStoreKey('paint', '   ')).toThrow(/sessionId/)
  })
})

describe('sessionStoreDisplayName', () => {
  it('is just the key when no label is given', () => {
    expect(sessionStoreDisplayName('paint', 'abc')).toBe('qm-paint-abc')
    expect(sessionStoreDisplayName('electrical', 'abc', null)).toBe('qm-electrical-abc')
  })

  it('appends a slugified label after the stable key', () => {
    const dn = sessionStoreDisplayName('paint', 'abc', 'John Smith')
    expect(dn.startsWith('qm-paint-abc ')).toBe(true)
    expect(dn).toBe('qm-paint-abc john-smith')
  })

  it('never exceeds 128 chars even with a long label', () => {
    const dn = sessionStoreDisplayName('paint', 'abc', 'y'.repeat(400))
    expect(dn.length).toBeLessThanOrEqual(128)
    expect(dn.startsWith('qm-paint-abc')).toBe(true)
  })
})

describe('displayNameMatchesSession', () => {
  const key = 'qm-paint-abc'
  it('matches the bare key', () => {
    expect(displayNameMatchesSession(key, 'paint', 'abc')).toBe(true)
  })
  it('matches the key with a label suffix', () => {
    expect(displayNameMatchesSession('qm-paint-abc john-smith', 'paint', 'abc')).toBe(true)
  })
  it('rejects a different session, estimator, or a prefix collision', () => {
    expect(displayNameMatchesSession('qm-paint-abcd', 'paint', 'abc')).toBe(false)
    expect(displayNameMatchesSession('qm-electrical-abc', 'paint', 'abc')).toBe(false)
    expect(displayNameMatchesSession(undefined, 'paint', 'abc')).toBe(false)
    expect(displayNameMatchesSession('', 'paint', 'abc')).toBe(false)
  })
})

describe('bareStoreId', () => {
  it('strips the fileSearchStores/ prefix', () => {
    expect(bareStoreId('fileSearchStores/xyz')).toBe('xyz')
  })
  it('passes a bare id through', () => {
    expect(bareStoreId('xyz')).toBe('xyz')
  })
  it('throws on empty input', () => {
    expect(() => bareStoreId('   ')).toThrow(/store name or id/)
  })
})
