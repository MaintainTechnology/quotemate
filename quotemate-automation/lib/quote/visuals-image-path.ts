// PURE — which Google Static Maps proxy path the quote report's property-visuals
// image loads. Extracted from lib/quote/pdf.ts so it's unit-testable without the
// PDF/Supabase runtime. See propertyVisualsImagePath for the roofing
// wrong-building rationale.

/** Trades whose customer page shows property evidence the report mirrors
 *  (spec quote-visual-parity R1). */
export function hasPropertyVisuals(trade: string): boolean {
  return trade === 'roofing' || trade === 'commercial_painting'
}

/** The address-geocoded satellite proxy query the customer page's RoofHeroStrip
 *  falls back to (zoom 20, 640×420). */
export function staticMapQuery(address: string): string {
  const p = new URLSearchParams()
  p.set('address', address)
  p.set('zoom', '20')
  p.set('w', '640')
  p.set('h', '420')
  return p.toString()
}

/**
 * PURE — root-relative path for the report's property-visuals satellite image.
 *
 * Roofing quotes linked to a saved measurement centre on the MEASURED building
 * polygon (`/api/roofing/q/<publicToken>/static-map?b=1`), the same path the
 * customer page's RoofHeroStrip prefers. Geocoding the address text lands on the
 * WRONG building on large/rural parcels — and the roofing intake stores
 * street-only (suburb stripped by splitAddress), so the geocode is doubly
 * ambiguous. Unlinked roofing + commercial painting fall back to the
 * address-geocoded share-token proxy. Null when the trade has no property
 * visuals (or roofing has no address and no linked measurement).
 *
 * Returns a root-relative path: the live HTML preview uses it as-is; the PDF
 * caller prefixes APP_URL before fetching.
 */
export function propertyVisualsImagePath(opts: {
  trade: string
  shareToken: string
  address: string | null
  linkedRoofPublicToken: string | null
}): string | null {
  const { trade, shareToken, address, linkedRoofPublicToken } = opts
  if (!hasPropertyVisuals(trade)) return null
  if (trade === 'roofing' && linkedRoofPublicToken) {
    return `/api/roofing/q/${linkedRoofPublicToken}/static-map?b=1`
  }
  return address ? `/api/q/${shareToken}/static-map?${staticMapQuery(address)}` : null
}
