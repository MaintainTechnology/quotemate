// ════════════════════════════════════════════════════════════════════
// Painting — PropRadar property-attribute enrichment.
//
// Opportunistic: PropRadar covers on-market + recently-sold properties, so
// this fills beds/baths/car/type/land/floor-area/year for the minority of
// addresses in the dataset and cleanly no-ops ({found:false}) otherwise.
//
// CONFIRMED 2026-07-01 via scripts/probe-propradar-apis.mjs:
//   host   https://api.propradar.com.au/v1 ; header  X-API-Key: pr_live_…
//   GET /properties/search?address=<street+suburb>&postcode=<4-digit>
//     → { property_id, found, matches, hint }
//   GET /properties/{id}
//     → { attributes: { bedrooms, bathrooms, parking, property_type,
//          land_size_sqm, floor_area_sqm }, listing, valuation, … }
//   `year_built` is defined in the schema but sparsely populated — mapped
//   only when present.
// No-ops without PROPRADAR_API.
// ════════════════════════════════════════════════════════════════════

import type { PaintAddressInput, PropertyFacts } from '../types'

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

export type PropRadarEnrichOpts = {
  apiKey?: string
  baseUrl?: string
  fetchImpl?: FetchLike
}

/** The subset of PropertyFacts a PropRadar match can fill. */
export type PropRadarPaintPatch = Partial<
  Pick<
    PropertyFacts,
    | 'bedrooms'
    | 'bathrooms'
    | 'car_spaces'
    | 'property_type'
    | 'land_size_m2'
    | 'floor_area_m2'
    | 'floor_area_source'
    | 'year_built'
  >
>

export type PropRadarEnrichResult = {
  patch: PropRadarPaintPatch
  notes: string[]
  found: boolean
}

const EMPTY: PropRadarEnrichResult = { patch: {}, notes: [], found: false }

export async function enrichFromPropRadar(
  input: PaintAddressInput,
  opts: PropRadarEnrichOpts = {},
): Promise<PropRadarEnrichResult> {
  const apiKey = opts.apiKey ?? process.env.PROPRADAR_API
  if (!apiKey || !input?.address?.trim() || !/^\d{4}$/.test(input.postcode ?? '')) return EMPTY
  const base =
    opts.baseUrl ?? process.env.PROPRADAR_API_BASE_URL ?? 'https://api.propradar.com.au/v1'
  const fetchImpl = opts.fetchImpl ?? ((u, i) => fetch(u, i))
  const headers = { 'X-API-Key': apiKey, Accept: 'application/json' }

  const getJson = async (url: string): Promise<Record<string, unknown> | null> => {
    try {
      const res = await fetchImpl(url, { method: 'GET', headers })
      // 429 (rate limited) / any non-2xx → treat as "no data", never throw.
      if (res.status === 429 || !res.ok) return null
      const j = await res.json()
      return j && typeof j === 'object' ? (j as Record<string, unknown>) : null
    } catch {
      return null
    }
  }

  // The search `address` line is the street+suburb; the 4-digit postcode is a
  // separate required param. Strip a trailing postcode from the address line.
  const addressLine =
    input.address.replace(/\b\d{4}\b\s*$/, '').trim().replace(/,\s*$/, '') || input.address
  const search = await getJson(
    `${base}/properties/search?address=${encodeURIComponent(addressLine)}` +
      `&postcode=${encodeURIComponent(input.postcode)}`,
  )
  if (!search) return EMPTY

  const id = pickPropertyId(search)
  if (search.found !== true || !id) return EMPTY

  const detail = await getJson(`${base}/properties/${encodeURIComponent(id)}`)
  if (!detail) return EMPTY

  const attrs =
    detail.attributes && typeof detail.attributes === 'object'
      ? (detail.attributes as Record<string, unknown>)
      : detail

  const patch: PropRadarPaintPatch = {}
  const bedrooms = num(attrs.bedrooms)
  const bathrooms = num(attrs.bathrooms)
  const parking = num(attrs.parking ?? attrs.car_spaces)
  const propertyType = str(attrs.property_type ?? attrs.propertyType)
  const land = num(attrs.land_size_sqm ?? attrs.land_size)
  const floor = num(attrs.floor_area_sqm ?? attrs.floor_area)
  const year = num(attrs.year_built ?? attrs.yearBuilt)

  if (bedrooms != null) patch.bedrooms = bedrooms
  if (bathrooms != null) patch.bathrooms = bathrooms
  if (parking != null) patch.car_spaces = parking
  if (propertyType != null) patch.property_type = propertyType
  if (land != null) patch.land_size_m2 = land
  if (floor != null) {
    patch.floor_area_m2 = floor
    patch.floor_area_source = 'listing'
  }
  if (year != null) patch.year_built = year

  const listing =
    detail.listing && typeof detail.listing === 'object'
      ? (detail.listing as Record<string, unknown>)
      : null
  const kind = listing?.on_market === true ? 'live listing' : 'recent sold record'
  return { patch, notes: [`Property attributes from a PropRadar ${kind}.`], found: true }
}

/** PURE — a PropRadar property id from a search body. */
export function pickPropertyId(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null
  const b = body as Record<string, unknown>
  if (typeof b.property_id === 'string' && b.property_id) return b.property_id
  for (const key of ['matches', 'results', 'data']) {
    const arr = b[key]
    if (Array.isArray(arr)) {
      for (const it of arr) {
        if (it && typeof it === 'object') {
          const r = it as Record<string, unknown>
          const pid = r.property_id ?? r.id
          if (typeof pid === 'string' && pid) return pid
        }
      }
    }
  }
  return null
}

/** PURE — positive finite number (or numeric string), else null. */
function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v) && v > 0) return v
  if (typeof v === 'string') {
    const n = parseFloat(v)
    if (Number.isFinite(n) && n > 0) return n
  }
  return null
}

/** PURE — non-empty trimmed string, else null. */
function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}
