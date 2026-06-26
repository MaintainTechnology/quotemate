import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { decryptSecret, encryptSecret, isEncryptionConfigured } from '@/lib/crypto/encrypt'

// 32 bytes of base64 — a deterministic test key (do NOT use in production).
const TEST_KEY = Buffer.alloc(32, 7).toString('base64')

describe('lib/crypto/encrypt', () => {
  beforeEach(() => {
    process.env.ENCRYPTION_KEY = TEST_KEY
  })
  afterEach(() => {
    delete process.env.ENCRYPTION_KEY
  })

  it('round-trips a secret through encrypt + decrypt', () => {
    const plain = 'hubspot-access-token-abc123'
    const ct = encryptSecret(plain)
    expect(ct).not.toContain(plain)
    expect(decryptSecret(ct)).toBe(plain)
  })

  it('produces a different ciphertext each time (random IV) but decrypts the same', () => {
    const a = encryptSecret('same input')
    const b = encryptSecret('same input')
    expect(a).not.toBe(b)
    expect(decryptSecret(a)).toBe('same input')
    expect(decryptSecret(b)).toBe('same input')
  })

  it('uses the versioned v1:iv:tag:ct format', () => {
    const parts = encryptSecret('x').split(':')
    expect(parts).toHaveLength(4)
    expect(parts[0]).toBe('v1')
  })

  it('round-trips unicode and empty strings', () => {
    for (const s of ['', 'plumber ⚡ sparky 🔧', 'a'.repeat(5000)]) {
      expect(decryptSecret(encryptSecret(s))).toBe(s)
    }
  })

  it('throws when the auth tag is tampered with', () => {
    const ct = encryptSecret('tamper me')
    const parts = ct.split(':')
    // Flip the ciphertext payload so the GCM tag no longer matches.
    const bad = Buffer.from(parts[3], 'base64')
    bad[0] = bad[0] ^ 0xff
    parts[3] = bad.toString('base64')
    expect(() => decryptSecret(parts.join(':'))).toThrow()
  })

  it('rejects a malformed ciphertext', () => {
    expect(() => decryptSecret('not-a-valid-payload')).toThrow(/invalid ciphertext format/)
    expect(() => decryptSecret('v2:a:b:c')).toThrow(/invalid ciphertext format/)
  })

  it('throws a clear error when the key is missing', () => {
    delete process.env.ENCRYPTION_KEY
    expect(() => encryptSecret('x')).toThrow(/ENCRYPTION_KEY is not set/)
    expect(isEncryptionConfigured()).toBe(false)
  })

  it('throws when the key does not decode to 32 bytes', () => {
    process.env.ENCRYPTION_KEY = Buffer.alloc(16, 1).toString('base64')
    expect(() => encryptSecret('x')).toThrow(/32 bytes/)
  })

  it('accepts a 64-char hex key as well as base64', () => {
    process.env.ENCRYPTION_KEY = Buffer.alloc(32, 9).toString('hex')
    expect(decryptSecret(encryptSecret('hex-key works'))).toBe('hex-key works')
  })

  it('isEncryptionConfigured reports true for a valid key', () => {
    expect(isEncryptionConfigured()).toBe(true)
  })
})
