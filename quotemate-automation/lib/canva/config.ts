// Canva Connect — environment configuration (pure-ish; reads env).
//
// CANVA_CLIENT_ID / CANVA_CLIENT_SECRET are required to talk to Canva.
// CANVA_REDIRECT_URI is optional: when unset we derive the callback URL from
// the incoming request origin so dev (ngrok/localhost) and prod each work.
// The redirect URI used here MUST be registered in the Canva Developer Portal.
// env is injectable so vitest can exercise this without real secrets.

export interface CanvaConfig {
  clientId: string
  clientSecret: string
  /** Explicit redirect URI override; null → derive from request origin. */
  redirectUri: string | null
}

const CALLBACK_PATH = '/api/dashboard/flyer/canva/callback'

/** Read Canva creds from env; null when the integration isn't configured. */
export function readCanvaConfig(
  env: Record<string, string | undefined> = process.env,
): CanvaConfig | null {
  const clientId = env.CANVA_CLIENT_ID
  const clientSecret = env.CANVA_CLIENT_SECRET
  if (!clientId || !clientSecret) return null
  return {
    clientId,
    clientSecret,
    redirectUri: env.CANVA_REDIRECT_URI && env.CANVA_REDIRECT_URI.trim() ? env.CANVA_REDIRECT_URI.trim() : null,
  }
}

/**
 * Canva forbids `localhost` as a redirect host — for local dev it only accepts
 * `http://127.0.0.1:<port>`. Normalize the origin so the derived callback is a
 * value Canva will actually accept (and that the dev can register verbatim).
 */
function normalizeOrigin(origin: string): string {
  try {
    const u = new URL(origin)
    if (u.hostname === 'localhost') u.hostname = '127.0.0.1'
    return u.origin
  } catch {
    return origin.replace(/\/+$/, '').replace('//localhost', '//127.0.0.1')
  }
}

/** The OAuth callback URL: explicit override, else `<origin><CALLBACK_PATH>`. */
export function resolveRedirectUri(cfg: CanvaConfig, requestOrigin: string): string {
  if (cfg.redirectUri) return cfg.redirectUri
  return `${normalizeOrigin(requestOrigin)}${CALLBACK_PATH}`
}

export const CANVA_CALLBACK_PATH = CALLBACK_PATH
