// ════════════════════════════════════════════════════════════════════
// Painting — Domain.com.au property-attribute enrichment.
//
// Opportunistic: Domain's property database covers most residential AU
// addresses, so this fills beds/baths/car/storeys/year/type/land and — when
// the record carries one — a real internal floor area (high confidence,
// unlike the footprint × storeys derivation the other providers give).
// Cleanly no-ops ({found:false}) when the address doesn't resolve.
//
// CONFIRMED live 2026-08-13:
//   host    https://api.domain.com.au ; header  X-Api-Key: <key>
//   GET /v1/properties/_suggest?terms=<address>&channel=All&pageSize=5
//     → [{ address, id, relativeScore, addressComponents }] — free, no quota.
//     Take the entry with the HIGHEST relativeScore (not array order).
//   GET /v1/properties/{id}                                    — 1 quota unit
//     → { bedrooms, bathrooms, carSpaces, storeys, yearBuilt, propertyType,
//          areaSize (LAND m²), internalArea (floor area m², often ABSENT),
//          photos: [{ imageType, fullUrl }] }
// No-ops without DOMAIN_API_KEY / DOMAIN_API. The trial key has a 20/day
// quota — every test in domain-enrich.test.ts injects fetchImpl.
// ════════════════════════════════════════════════════════════════════

import type { PaintAddressInput, PropertyFacts } from '../types'

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

export type DomainEnrichOpts = {
  apiKey?: string
  baseUrl?: string
  fetchImpl?: FetchLike
}

/** The subset of PropertyFacts a Domain match can fill. */
export type DomainPaintPatch = Partial<
  Pick<
    PropertyFacts,
    | 'bedrooms'
    | 'bathrooms'
    | 'car_spaces'
    | 'storeys'
    | 'year_built'
    | 'property_type'
    | 'land_size_m2'
    | 'floor_area_m2'
    | 'floor_area_source'
    | 'has_floor_plan'
    | 'floor_plan_urls'
  >
>

export type DomainEnrichResult = {
  patch: DomainPaintPatch
  notes: string[]
  found: boolean
}

const EMPTY: DomainEnrichResult = { patch: {}, notes: [], found: false }

export async function enrichFromDomain(
  input: PaintAddressInput,
  opts: DomainEnrichOpts = {},
): Promise<DomainEnrichResult> {
  const apiKey = opts.apiKey ?? process.env.DOMAIN_API_KEY ?? process.env.DOMAIN_API
  if (!apiKey || !input?.address?.trim()) return EMPTY
  const base = opts.baseUrl ?? process.env.DOMAIN_API_BASE_URL ?? 'https://api.domain.com.au'
  const fetchImpl = opts.fetchImpl ?? ((u, i) => fetch(u, i))
  const headers = { 'X-Api-Key': apiKey, Accept: 'application/json' }

  const getJson = async (url: string): Promise<unknown> => {
    try {
      const res = await fetchImpl(url, { method: 'GET', headers })
      // 429 (rate limited) / any non-2xx → treat as "no data", never throw.
      if (res.status === 429 || !res.ok) return null
      return await res.json()
    } catch {
      return null
    }
  }

  const suggest = await getJson(
    `${base}/v1/properties/_suggest?terms=${encodeURIComponent(input.address)}&channel=All&pageSize=5`,
  )
  const match = pickBestSuggestion(suggest)
  if (!match) return EMPTY

  const detail = await getJson(`${base}/v1/properties/${encodeURIComponent(match.id)}`)
  if (!detail || typeof detail !== 'object') return EMPTY
  const d = detail as Record<string, unknown>

  const patch: DomainPaintPatch = {}
  const bedrooms = num(d.bedrooms)
  const bathrooms = num(d.bathrooms)
  const carSpaces = num(d.carSpaces)
  const storeys = num(d.storeys)
  const yearBuilt = num(d.yearBuilt)
  const propertyType = str(d.propertyType)
  const landSize = num(d.areaSize)
  const internalArea = num(d.internalArea)

  if (bedrooms != null) patch.bedrooms = bedrooms
  if (bathrooms != null) patch.bathrooms = bathrooms
  if (carSpaces != null) patch.car_spaces = carSpaces
  if (storeys != null) patch.storeys = storeys
  if (yearBuilt != null) patch.year_built = yearBuilt
  if (propertyType != null) patch.property_type = propertyType
  if (landSize != null) patch.land_size_m2 = landSize
  if (internalArea != null) {
    patch.floor_area_m2 = internalArea
    patch.floor_area_source = 'listing'
  }

  const floorPlanUrls = pickFloorPlanUrls(d.photos)
  patch.floor_plan_urls = floorPlanUrls
  patch.has_floor_plan = floorPlanUrls.length > 0

  const notes = [`Property attributes from Domain (matched "${match.address}").`]
  if (internalArea != null) notes.push(`Internal area ${internalArea} m² from the Domain listing.`)

  return { patch, notes, found: true }
}

/** PURE — the {id, address} of the highest-relativeScore suggest hit. */
export function pickBestSuggestion(body: unknown): { id: string; address: string } | null {
  if (!Array.isArray(body) || body.length === 0) return null
  let best: { id: string; address: string; score: number } | null = null
  for (const it of body) {
    if (!it || typeof it !== 'object') continue
    const r = it as Record<string, unknown>
    if (typeof r.id !== 'string' || !r.id) continue
    const score = typeof r.relativeScore === 'number' && Number.isFinite(r.relativeScore) ? r.relativeScore : -Infinity
    if (!best || score > best.score) {
      best = { id: r.id, address: typeof r.address === 'string' ? r.address : '', score }
    }
  }
  return best ? { id: best.id, address: best.address } : null
}

/** PURE — non-empty FloorPlan photo URLs from a Domain `photos` array. */
function pickFloorPlanUrls(photos: unknown): string[] {
  if (!Array.isArray(photos)) return []
  const urls: string[] = []
  for (const p of photos) {
    if (!p || typeof p !== 'object') continue
    const r = p as Record<string, unknown>
    if (r.imageType !== 'FloorPlan') continue
    const url = str(r.fullUrl)
    if (url != null) urls.push(url)
  }
  return urls
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
