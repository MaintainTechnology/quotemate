// AES-256-GCM encryption for secrets stored at rest (e.g. CRM OAuth tokens).
//
// There was no existing encryption helper in the codebase — sensitive values
// were only ever hashed. CRM access/refresh tokens must be *recoverable* (we
// call the CRM with them later), so they need reversible encryption, not a
// one-way hash. AES-256-GCM gives us confidentiality + an auth tag that detects
// tampering on decrypt.
//
// Key material comes from the ENCRYPTION_KEY env var, decoded to exactly 32
// bytes. Generate one with:  openssl rand -base64 32
//
// Ciphertext format (single string, ':'-delimited, base64 parts):
//   v1:<iv>:<authTag>:<ciphertext>
// The base64 standard alphabet never contains ':', so splitting is unambiguous.

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

const ALGORITHM = 'aes-256-gcm'
const VERSION = 'v1'
const IV_BYTES = 12 // GCM standard nonce length

/**
 * Resolve the 32-byte symmetric key from ENCRYPTION_KEY. Accepts either a
 * base64 (preferred, from `openssl rand -base64 32`) or 64-char hex encoding.
 * Read at call time (not module load) so tests can set the env per-case and so
 * importing this module never throws on a misconfigured environment.
 */
function loadKey(): Buffer {
  const raw = process.env.ENCRYPTION_KEY
  if (!raw || raw.trim() === '') {
    throw new Error('ENCRYPTION_KEY is not set — cannot encrypt/decrypt secrets')
  }
  const trimmed = raw.trim()
  const key = /^[0-9a-fA-F]{64}$/.test(trimmed)
    ? Buffer.from(trimmed, 'hex')
    : Buffer.from(trimmed, 'base64')
  if (key.length !== 32) {
    throw new Error(
      `ENCRYPTION_KEY must decode to 32 bytes (got ${key.length}). Generate one with: openssl rand -base64 32`,
    )
  }
  return key
}

/** True when ENCRYPTION_KEY is present and valid — for preflight/health checks. */
export function isEncryptionConfigured(): boolean {
  try {
    loadKey()
    return true
  } catch {
    return false
  }
}

/** Encrypt a UTF-8 string. Returns the versioned ':'-delimited ciphertext. */
export function encryptSecret(plaintext: string): string {
  const key = loadKey()
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv(ALGORITHM, key, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  return [
    VERSION,
    iv.toString('base64'),
    authTag.toString('base64'),
    ciphertext.toString('base64'),
  ].join(':')
}

/**
 * Decrypt a string produced by {@link encryptSecret}. Throws if the format is
 * wrong, the version is unknown, or the auth tag fails (tampered ciphertext).
 */
export function decryptSecret(payload: string): string {
  const key = loadKey()
  const parts = payload.split(':')
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new Error('invalid ciphertext format')
  }
  const iv = Buffer.from(parts[1], 'base64')
  const authTag = Buffer.from(parts[2], 'base64')
  const ciphertext = Buffer.from(parts[3], 'base64')
  const decipher = createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(authTag)
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()])
  return plaintext.toString('utf8')
}
