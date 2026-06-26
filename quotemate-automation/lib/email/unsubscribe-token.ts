// Signed, stateless unsubscribe tokens. The announcement email embeds one of
// these in its unsubscribe link. The token carries the tenant id + recipient
// email, HMAC-signed so it cannot be forged or pointed at another tenant's
// contact. On click, the public unsubscribe route verifies the signature and
// records the suppression.

import { createHmac, timingSafeEqual } from 'node:crypto'

function secret(): string {
  // A dedicated secret is preferred; fall back to ENCRYPTION_KEY so the feature
  // works with a single configured secret in dev.
  const s = process.env.UNSUBSCRIBE_SECRET || process.env.ENCRYPTION_KEY
  if (!s || s.trim() === '') {
    throw new Error('UNSUBSCRIBE_SECRET (or ENCRYPTION_KEY) is not set')
  }
  return s.trim()
}

function sign(payload: string): string {
  // Domain-separation prefix: binds the signature to the unsubscribe purpose so
  // it can't be reused as another token type even if the signing secret is
  // shared (both this and the OAuth-state signer can fall back to ENCRYPTION_KEY).
  return createHmac('sha256', secret()).update(`unsubscribe:v1:${payload}`).digest('base64url')
}

/** Build a signed unsubscribe token binding the tenant + email together. */
export function makeUnsubscribeToken(tenantId: string, email: string): string {
  const payload = Buffer.from(
    JSON.stringify({ t: tenantId, e: email.trim().toLowerCase() }),
  ).toString('base64url')
  return `${payload}.${sign(payload)}`
}

/**
 * Verify + decode an unsubscribe token. Returns the tenant id and email on a
 * valid signature, or null if the token is malformed or tampered with.
 */
export function parseUnsubscribeToken(
  token: string,
): { tenantId: string; email: string } | null {
  if (typeof token !== 'string') return null
  const dot = token.lastIndexOf('.')
  if (dot <= 0) return null
  const payload = token.slice(0, dot)
  const sig = token.slice(dot + 1)
  if (!payload || !sig) return null

  const expected = sign(payload)
  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null

  try {
    const obj = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
    if (obj && typeof obj.t === 'string' && typeof obj.e === 'string') {
      return { tenantId: obj.t, email: obj.e }
    }
    return null
  } catch {
    return null
  }
}
