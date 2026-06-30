// PKCE (RFC 7636) for the OAuth authorization-code flow. HubSpot's new
// developer-platform apps require PKCE: the authorize request must carry a
// `code_challenge`, and the token exchange must send the matching
// `code_verifier`.
//
// We have no per-flow server session (the OAuth state is a signed, stateless
// token), so rather than store a random verifier we DERIVE it deterministically
// from the signed state + the server secret. Properties:
//   • The verifier never leaves the server — only its SHA-256 challenge is sent
//     to the provider. The callback re-derives the same verifier from the same
//     state to complete the exchange.
//   • It is unique per flow (the state embeds a timestamp) and unpredictable to
//     anyone without OAUTH_STATE_SECRET, so an intercepted auth code is useless.
// No new env var is needed — it reuses the OAuth-state signing secret.

import { createHash, createHmac } from 'node:crypto'

function secret(): string {
  const s = process.env.OAUTH_STATE_SECRET || process.env.ENCRYPTION_KEY
  if (!s || s.trim() === '') {
    throw new Error('OAUTH_STATE_SECRET (or ENCRYPTION_KEY) is not set — cannot derive PKCE verifier')
  }
  return s.trim()
}

/**
 * Derive the per-flow PKCE code_verifier from the signed OAuth state. base64url
 * of a 32-byte HMAC is 43 chars in the PKCE-allowed charset ([A-Za-z0-9-_]),
 * satisfying the 43–128 length requirement.
 */
export function deriveCodeVerifier(state: string): string {
  return createHmac('sha256', secret()).update(`pkce:v1:${state}`).digest('base64url')
}

/** S256 code_challenge = base64url(SHA-256(code_verifier)). */
export function codeChallengeS256(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url')
}
