// ════════════════════════════════════════════════════════════════════
// Roofing — PropRadar property-context enrichment (best-effort, additive).
//
// PropRadar (https://api.propradar.com.au/v1) supplies property attributes —
// property_type, year_built, floor/land area — for AU properties that are
// on-market or recently sold. Roofing customers are mostly OFF-market, so a
// lookup returns null for most addresses. This module never throws into the
// measurement path and no-ops entirely unless PROPRADAR_ENRICHMENT is on and
// a PROPRADAR_API_KEY is set.
//
// Auth: X-API-Key header. Flow: /properties/search?address=&postcode= →
// property_id → /properties/{id}. `year_built` needs a Hobby+ plan (omitted on
// free), so the asbestos-gate benefit lights up only once the plan is upgraded.
// ════════════════════════════════════════════════════════════════════

import type { MultiRoofQuote, RoofAddressInput, RoofPropertyContext } from './types'

type FetchLike = (
  input: string,
  init?: { headers?: Record<string, string> },
) => Promise<Response>

export type PropRadarOpts = {
  /** Force on/off. Defaults to PROPRADAR_ENRICHMENT === 'true'. */
  enabled?: boolean
  apiKey?: string
  baseUrl?: string
  fetchImpl?: FetchLike
}

const DEFAULT_BASE_URL =
  process.env.PROPRADAR_API_BASE_URL ?? 'https://api.propradar.com.au/v1'

/** Roof-quotable dwelling types — anything else (unit / apartment / flat) is a
 *  strata / shared roof the tradie must confirm access to before quoting. */
const HOUSE_LIKE = ['house', 'duplex', 'townhouse', 'villa', 'terrace', 'semi']

export function propradarEnabled(opts?: PropRadarOpts): boolean {
  const flag = opts?.enabled ?? process.env.PROPRADAR_ENRICHMENT === 'true'
  const key = opts?.apiKey ?? process.env.PROPRADAR_API_KEY
  return Boolean(flag && key)
}

/** Best-effort property-context lookup. Returns null when disabled, when the
 *  address isn't covered (found:false — the common case for off-market homes),
 *  or on any error. Two calls: search → detail. */
export async function fetchPropertyContext(
  address: RoofAddressInput,
  opts?: PropRadarOpts,
): Promise<RoofPropertyContext | null> {
  if (!propradarEnabled(opts)) return null
  const key = opts?.apiKey ?? process.env.PROPRADAR_API_KEY!
  const base = opts?.baseUrl ?? DEFAULT_BASE_URL
  const doFetch: FetchLike = opts?.fetchImpl ?? ((u, i) => fetch(u, i))
  const headers = { 'X-API-Key': key, Accept: 'application/json' }
  try {
    const searchUrl =
      `${base}/properties/search?address=${encodeURIComponent(address.address)}` +
      `&postcode=${encodeURIComponent(address.postcode)}`
    const sRes = await doFetch(searchUrl, { headers })
    if (!sRes.ok) return null
    const propertyId = pickPropertyId(await sRes.json())
    if (!propertyId) return null
    const dRes = await doFetch(
      `${base}/properties/${encodeURIComponent(propertyId)}`,
      { headers },
    )
    if (!dRes.ok) return null
    return toPropertyContext(propertyId, await dRes.json())
  } catch {
    return null
  }
}

/** PURE — pull the property_id from a /properties/search body, or null when
 *  the address isn't covered (found:false / no match). */
export function pickPropertyId(searchBody: unknown): string | null {
  if (!searchBody || typeof searchBody !== 'object') return null
  const b = searchBody as Record<string, unknown>
  if (b.found === false) return null
  if (typeof b.property_id === 'string' && b.property_id) return b.property_id
  const matches = Array.isArray(b.matches) ? b.matches : []
  for (const m of matches) {
    if (m && typeof m === 'object') {
      const id = (m as Record<string, unknown>).property_id
      if (typeof id === 'string' && id) return id
    }
  }
  return null
}

/** PURE — map a /properties/{id} detail body to the roofing-relevant context. */
export function toPropertyContext(
  propertyId: string,
  detail: unknown,
): RoofPropertyContext | null {
  if (!detail || typeof detail !== 'object') return null
  const a = ((detail as Record<string, unknown>).attributes ?? {}) as Record<string, unknown>
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
  const str = (v: unknown) => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null)
  return {
    source: 'propradar',
    property_id: propertyId,
    property_type: str(a.property_type),
    year_built: num(a.year_built),
    floor_area_sqm: num(a.floor_area_sqm),
    land_size_sqm: num(a.land_size_sqm),
    bedrooms: num(a.bedrooms),
    bathrooms: num(a.bathrooms),
    parking: num(a.parking),
  }
}

/** PURE — soft, non-blocking signals derived from the property context: a
 *  non-house dwelling type, and a gross footprint↔floor-area mismatch that
 *  suggests the wrong building was measured. */
export function propertyContextWarnings(
  ctx: RoofPropertyContext,
  quote: MultiRoofQuote,
): string[] {
  const warnings: string[] = []
  const type = ctx.property_type?.toLowerCase() ?? ''
  if (type && !HOUSE_LIKE.some((h) => type.includes(h))) {
    warnings.push(
      `PropRadar lists this as a ${ctx.property_type} — confirm roof access / strata before quoting.`,
    )
  }
  const primary = quote.structures.find((s) => s.role === 'primary') ?? quote.structures[0]
  const footprint = primary?.metrics?.footprint_m2 ?? null
  const storeys = primary?.metrics?.storeys ?? 1
  if (ctx.floor_area_sqm != null && footprint != null && storeys >= 1) {
    const expected = ctx.floor_area_sqm / storeys
    if (expected > 0 && (footprint > expected * 2.2 || footprint < expected * 0.45)) {
      warnings.push(
        `Measured footprint ${Math.round(footprint)} m² differs from PropRadar floor area ` +
          `${Math.round(ctx.floor_area_sqm)} m² over ~${storeys} storey${storeys > 1 ? 's' : ''} — verify the measured building.`,
      )
    }
  }
  return warnings
}
