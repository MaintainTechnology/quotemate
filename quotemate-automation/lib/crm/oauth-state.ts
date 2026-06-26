// Signed OAuth `state` parameter. The CRM redirects back to our callback as a
// plain browser navigation with no Authorization header, so the tenant identity
// must be carried in the OAuth state — signed (HMAC) so it can't be forged or
// replayed for a different tenant, and time-boxed so a leaked URL can't be used
// indefinitely. Doubles as CSRF protection on the OAuth handshake.

import { createHmac, timingSafeEqual } from 'node:crypto'

const TTL_MS = 15 * 60 * 1000 // 15 minutes

function secret(): string {
  const s = process.env.OAUTH_STATE_SECRET || process.env.ENCRYPTION_KEY
  if (!s || s.trim() === '') {
    throw new Error('OAUTH_STATE_SECRET (or ENCRYPTION_KEY) is not set')
  }
  return s.trim()
}

function sign(payload: string): string {
  // Domain-separation prefix: binds the signature to the OAuth-state purpose so
  // it can't be reused as another token type even if the signing secret is
  // shared (both this and the unsubscribe signer can fall back to ENCRYPTION_KEY).
  return createHmac('sha256', secret()).update(`oauth-state:v1:${payload}`).digest('base64url')
}

export function makeOAuthState(tenantId: string, provider: string): string {
  const payload = Buffer.from(
    JSON.stringify({ t: tenantId, p: provider, iat: Date.now() }),
  ).toString('base64url')
  return `${payload}.${sign(payload)}`
}

/**
 * Verify + decode an OAuth state token. Returns null if malformed, tampered, or
 * older than the TTL. `now` is injectable for testing.
 */
export function parseOAuthState(
  token: string,
  now: number = Date.now(),
): { tenantId: string; provider: string } | null {
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
    if (!obj || typeof obj.t !== 'string' || typeof obj.p !== 'string') return null
    if (typeof obj.iat !== 'number' || now - obj.iat > TTL_MS || obj.iat > now + 60_000) {
      return null
    }
    return { tenantId: obj.t, provider: obj.p }
  } catch {
    return null
  }
}
