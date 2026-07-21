// The "Your tradie" block, resolved ONCE for every customer surface.
//
// Section 03 of the customer quote page shows who is doing the work. It used
// to live only in the React pages (app/q/[token], app/q/roof/[token]) while the
// downloadable PDF showed no tradie at all. This module is the single source of
// truth both surfaces read, so the photo, the name and the sentence can never
// drift between the web quote and the PDF the customer keeps.
//
// Photo: tenants.photo_url (set by the tradie on the dashboard Account tab).
// Unset → the neutral placeholder avatar below, so the block always renders.
// Pure — no DB, no fetch, unit-tested.

import { tradeLabel } from '@/lib/admin/trades'
import { safeWebsiteUrl } from './tenant-identity'

/**
 * Neutral avatar shown until the tradie uploads their own photo. Inline SVG in
 * a data: URI so it costs no request and embeds straight into the Gotenberg PDF
 * (a PDF render must never depend on the network). Warm-grey on a light tile —
 * legible on the dark customer page AND the light "warm paper" PDF, so one
 * asset serves both surfaces.
 */
const PLACEHOLDER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 160" width="160" height="160"><rect width="160" height="160" fill="#E9E3DC"/><circle cx="80" cy="63" r="26" fill="#B4A99F"/><path d="M24 148c8-30 29-46 56-46s48 16 56 46z" fill="#B4A99F"/></svg>`

export const TRADIE_AVATAR_PLACEHOLDER = `data:image/svg+xml,${encodeURIComponent(PLACEHOLDER_SVG)}`

/** Name used when a tenant row carries no business name (never blank on a customer page). */
const FALLBACK_TRADIE_NAME = 'Your tradie'

export type TradieProfileInput = {
  businessName?: string | null
  /** tenants.photo_url, or a data: URI when the PDF has already embedded it. */
  photoUrl?: string | null
  /** Trade slug ('roofing', 'commercial_painting', …) for the blurb. */
  trade?: string | null
}

export type TradieProfile = {
  name: string
  /** Always renderable — the tradie's photo, else the placeholder avatar. */
  photoSrc: string
  /** False when photoSrc is the placeholder (drives the dashboard nudge). */
  hasPhoto: boolean
  blurb: string
}

/**
 * A photo source safe to put in an <img> on a public customer surface: an
 * embedded image data: URI, or an https URL (Supabase public storage). Anything
 * else — http, javascript:, a typo'd bare string — resolves to null and the
 * caller falls back to the placeholder.
 */
function safePhotoSrc(raw: string | null | undefined): string | null {
  const trimmed = (raw ?? '').trim()
  if (!trimmed) return null
  if (trimmed.startsWith('data:image/')) return trimmed
  return safeWebsiteUrl(trimmed)
}

export function tradieProfile(input: TradieProfileInput): TradieProfile {
  const name = (input.businessName ?? '').trim() || FALLBACK_TRADIE_NAME
  const photo = safePhotoSrc(input.photoUrl)
  const trade = (input.trade ?? '').trim()
  // "… is a licensed local roofing business." — verbatim the sentence the web
  // customer view prints, so the PDF reads identically.
  const tradeWord = trade ? `${tradeLabel(trade).toLowerCase()} ` : ''
  return {
    name,
    photoSrc: photo ?? TRADIE_AVATAR_PLACEHOLDER,
    hasPhoto: photo !== null,
    blurb: `${name} is a licensed local ${tradeWord}business.`,
  }
}
