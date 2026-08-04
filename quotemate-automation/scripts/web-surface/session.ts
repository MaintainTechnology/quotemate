// ─────────────────────────────────────────────────────────────────────────
// Operator session for the web surface. Single password, HMAC-signed
// expiry cookie — no user table, no JWT library.
//
//   cookie qm_web = "<expiryMs>.<hmac-sha256(expiryMs, secret)>"
//
// Secret = WEB_SESSION_SECRET, else derived from WEB_ADMIN_PASSWORD + the
// service name (so the same password still yields per-service cookies).
// No WEB_ADMIN_PASSWORD at all ⇒ login is disabled and every gated page
// says so — fail closed, boot unaffected.
// Canonical copy: quotemate-automation/scripts/web-surface/session.ts
// ─────────────────────────────────────────────────────────────────────────

import { createHmac, createHash, timingSafeEqual } from 'node:crypto'

export const COOKIE = 'qm_web'
const TTL_MS = 24 * 60 * 60 * 1000

function secret(serviceName: string): string | null {
  if (process.env.WEB_SESSION_SECRET) return process.env.WEB_SESSION_SECRET
  const pw = process.env.WEB_ADMIN_PASSWORD
  if (!pw) return null
  return createHash('sha256').update(`${pw}:${serviceName}:qm-web`).digest('hex')
}

export function loginEnabled(): boolean {
  return Boolean(process.env.WEB_ADMIN_PASSWORD)
}

/** Constant-time password check (hash both sides so length never leaks). */
export function passwordOk(supplied: string | undefined): boolean {
  const expected = process.env.WEB_ADMIN_PASSWORD
  if (!expected || !supplied) return false
  const a = createHash('sha256').update(supplied).digest()
  const b = createHash('sha256').update(expected).digest()
  return timingSafeEqual(a, b)
}

export function mintSession(serviceName: string, now = Date.now()): string | null {
  const s = secret(serviceName)
  if (!s) return null
  const exp = String(now + TTL_MS)
  return `${exp}.${createHmac('sha256', s).update(exp).digest('hex')}`
}

export function sessionValid(serviceName: string, cookie: string | undefined, now = Date.now()): boolean {
  const s = secret(serviceName)
  if (!s || !cookie) return false
  const dot = cookie.indexOf('.')
  if (dot < 1) return false
  const exp = Number(cookie.slice(0, dot))
  if (!Number.isFinite(exp) || exp < now) return false
  const want = createHmac('sha256', s).update(cookie.slice(0, dot)).digest('hex')
  const got = cookie.slice(dot + 1)
  if (got.length !== want.length) return false
  return timingSafeEqual(Buffer.from(got), Buffer.from(want))
}

export function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined
  for (const part of header.split(';')) {
    const eq = part.indexOf('=')
    if (eq < 0) continue
    if (part.slice(0, eq).trim() === name) {
      try { return decodeURIComponent(part.slice(eq + 1).trim()) } catch { return part.slice(eq + 1).trim() }
    }
  }
  return undefined
}

export function setCookieHeader(value: string, secure: boolean): string {
  return `${COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400${secure ? '; Secure' : ''}`
}

export function clearCookieHeader(secure: boolean): string {
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`
}
