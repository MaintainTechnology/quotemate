// QR marketing lib — short codes, slugs, destination resolution, and
// QR image rendering. Shared by the dashboard APIs, the /s/<code>
// redirect, and the QR image route. Mirrors the helper style of
// lib/onboard/invitation-codes.ts.

import { randomBytes } from 'node:crypto'
import QRCode from 'qrcode'

/** Unambiguous short-code alphabet — no 0/O/1/I/l. */
export const SHORT_CODE_ALPHABET = '23456789abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ'

/** URL-safe short code for /s/<code>. ~6 chars ≈ 56^6 space. */
export function generateShortCode(len = 6): string {
  const bytes = randomBytes(len)
  let out = ''
  for (let i = 0; i < len; i++) out += SHORT_CODE_ALPHABET[bytes[i] % SHORT_CODE_ALPHABET.length]
  return out
}

/** Business name → url-safe base slug (caller adds a uniqueness suffix). */
export function slugifyBusinessName(name: string): string {
  const slug = (name ?? '')
    .trim()
    .toLowerCase()
    // Strip apostrophes/quotes first so "Pepper's" → "peppers", not "pepper-s".
    .replace(/['’"`]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '')
  return slug || 'tradie'
}

export type QrRow = {
  short_code: string
  destination_type: 'sms' | 'landing'
  destination_config: { prefill_body?: string } | Record<string, unknown>
}
export type TenantDest = { slug: string | null; twilio_sms_number: string | null }

export type ResolvedDestination =
  | { kind: 'landing'; url: string }
  | { kind: 'sms'; number: string; smsUri: string }

/**
 * Resolve a QR to where a scan should go.
 *   landing → an https /t/<slug> URL (302 target), with ?qr= attribution.
 *             Falls back to appUrl home when the tenant has no slug.
 *   sms     → an sms: URI for the interstitial to auto-launch.
 */
export function resolveDestination(
  qr: QrRow,
  tenant: TenantDest,
  appUrl: string,
): ResolvedDestination {
  if (qr.destination_type === 'sms') {
    const number = tenant.twilio_sms_number ?? ''
    const prefill = (qr.destination_config as { prefill_body?: string }).prefill_body
    const smsUri = prefill
      ? `sms:${number}?&body=${encodeURIComponent(prefill)}`
      : `sms:${number}`
    return { kind: 'sms', number, smsUri }
  }
  // landing
  if (!tenant.slug) return { kind: 'landing', url: appUrl }
  return { kind: 'landing', url: `${appUrl}/t/${tenant.slug}?qr=${qr.short_code}` }
}

/** Render the QR for a /s/<code> link as an SVG string. */
export function renderQrSvg(url: string): Promise<string> {
  return QRCode.toString(url, { type: 'svg', margin: 1, width: 512 })
}

/** Render the QR for a /s/<code> link as a PNG data URL (print quality). */
export function renderQrPngDataUrl(url: string): Promise<string> {
  return QRCode.toDataURL(url, { margin: 2, width: 1024, errorCorrectionLevel: 'M' })
}

/** Render the QR as a raw PNG Buffer (for an image response). */
export function renderQrPngBuffer(url: string): Promise<Buffer> {
  return QRCode.toBuffer(url, { margin: 2, width: 1024, errorCorrectionLevel: 'M' })
}
