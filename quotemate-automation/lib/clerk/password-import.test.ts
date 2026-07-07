// Rules for importing a Supabase GoTrue bcrypt digest into Clerk verbatim.
// Supabase stores auth.users.encrypted_password as a standard modular-crypt
// bcrypt string ($2a/$2b/$2y$<cost>$<22 salt><31 hash> = 60 chars). Clerk
// accepts it directly via updateUser/createUser { passwordDigest,
// passwordHasher: 'bcrypt' } so the user keeps their exact password.

import { describe, it, expect } from 'vitest'
import { isSupportedBcrypt, toClerkPasswordParams } from './password-import'

// A real 60-char bcrypt digest (classic test vector for "password").
const BCRYPT_2A = '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy'
const BCRYPT_2B = '$2b$12$' + 'a'.repeat(53)
const BCRYPT_2Y = '$2y$08$' + 'b'.repeat(53)

describe('isSupportedBcrypt', () => {
  it('accepts the standard $2a/$2b/$2y modular-crypt bcrypt variants', () => {
    expect(isSupportedBcrypt(BCRYPT_2A)).toBe(true)
    expect(isSupportedBcrypt(BCRYPT_2B)).toBe(true)
    expect(isSupportedBcrypt(BCRYPT_2Y)).toBe(true)
  })

  it('rejects non-bcrypt hashes and junk', () => {
    expect(isSupportedBcrypt('$argon2id$v=19$m=65536,t=3,p=4$abc')).toBe(false)
    expect(isSupportedBcrypt('$pbkdf2-sha256$29000$abc')).toBe(false)
    expect(isSupportedBcrypt('5f4dcc3b5aa765d61d8327deb882cf99')).toBe(false) // md5
    expect(isSupportedBcrypt('$2a$10$tooshort')).toBe(false)
    expect(isSupportedBcrypt('')).toBe(false)
    expect(isSupportedBcrypt(null)).toBe(false)
    expect(isSupportedBcrypt(undefined)).toBe(false)
  })
})

describe('toClerkPasswordParams', () => {
  it('maps a valid bcrypt digest to Clerk params verbatim', () => {
    const r = toClerkPasswordParams(BCRYPT_2A)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.params.passwordDigest).toBe(BCRYPT_2A)
      expect(r.params.passwordHasher).toBe('bcrypt')
    }
  })

  it('refuses an empty/passwordless account with a clear reason', () => {
    const r = toClerkPasswordParams(null)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/no password/i)
  })

  it('refuses an unsupported hash and names the prefix', () => {
    const r = toClerkPasswordParams('$argon2id$v=19$m=65536')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/unsupported|bcrypt/i)
  })
})
