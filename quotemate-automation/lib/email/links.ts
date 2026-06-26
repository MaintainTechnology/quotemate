// URL builders for the announcement email. Centralised so the QR target, the
// public intake landing, and the unsubscribe link all derive from one base URL
// and stay consistent.

/** The public base URL of the app (no trailing slash). */
export function appBaseUrl(): string {
  const raw = process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL
  if (!raw || raw.trim() === '') {
    throw new Error('APP_URL is not set — cannot build public links')
  }
  return raw.trim().replace(/\/+$/, '')
}

/**
 * The tradie's public "request a quote" landing page. This is the QR-code
 * target: a cold lead scans it and lands on the tenant's branded intake page
 * (business name + Twilio number + start-a-quote CTA).
 */
export function tenantIntakeUrl(tenantId: string, base?: string): string {
  const b = (base ?? appBaseUrl()).replace(/\/+$/, '')
  return `${b}/start/${tenantId}`
}

/** Public unsubscribe endpoint for a signed token. */
export function unsubscribeUrl(token: string, base?: string): string {
  const b = (base ?? appBaseUrl()).replace(/\/+$/, '')
  return `${b}/api/email/unsubscribe/${token}`
}
