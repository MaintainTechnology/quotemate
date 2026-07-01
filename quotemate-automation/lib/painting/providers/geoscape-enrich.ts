// ════════════════════════════════════════════════════════════════════
// Painting — Geoscape building-attribute enrichment.
//
// Layers Geoscape's per-address building attributes onto the Solar
// footprint facts. Reuses the roofing Geoscape client's PURE parsers
// (address→id, buildings summary, storeys, area) and adds painting
// extractors for eave height + zoning/use.
//
// CONFIRMED 2026-07-01 via scripts/probe-geoscape-building-attrs.mjs on a
// premium key — the live API exposes these sub-resources per building:
//   estimatedLevels   → storeys
//   averageEaveHeight → ground-to-eave wall height (m)   [exterior area]
//   zonings           → building use e.g. "Residential"  [property_type]
//   area              → planar footprint (m²)             [Solar fallback]
// There is NO total_floor_area and NO facade-material field on this API,
// so this enricher intentionally does not attempt them.
//
// Host + auth match the roofing adapter: https://api.psma.com.au/v1 with a
// raw `Authorization: <key>` header (no Bearer). No-ops without a key.
// ════════════════════════════════════════════════════════════════════

import type { PaintAddressInput, PropertyFacts } from '../types'
import {
  pickAddressId,
  pickBuildingSummaries,
  pickBestSummary,
  extractStoreys,
  extractArea,
} from '@/lib/roofing/providers/geoscape'

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

export type GeoscapeEnrichOpts = {
  apiKey?: string
  baseUrl?: string
  fetchImpl?: FetchLike
}

/** The subset of PropertyFacts a Geoscape lookup can fill. */
export type GeoscapePaintPatch = Partial<
  Pick<PropertyFacts, 'storeys' | 'eave_height_m' | 'property_type' | 'footprint_m2'>
>

export type GeoscapeEnrichResult = { patch: GeoscapePaintPatch; notes: string[] }

const EMPTY: GeoscapeEnrichResult = { patch: {}, notes: [] }

export async function enrichFromGeoscape(
  input: PaintAddressInput,
  opts: GeoscapeEnrichOpts = {},
): Promise<GeoscapeEnrichResult> {
  const apiKey = opts.apiKey ?? process.env.GEOSCAPE_API_KEY
  if (!apiKey || !input?.address?.trim()) return EMPTY
  const base = opts.baseUrl ?? process.env.GEOSCAPE_API_BASE_URL ?? 'https://api.psma.com.au/v1'
  const fetchImpl = opts.fetchImpl ?? ((u, i) => fetch(u, i))
  const headers = { Authorization: apiKey, Accept: 'application/json' }

  const get = async (url: string): Promise<unknown> => {
    try {
      const res = await fetchImpl(url, { method: 'GET', headers })
      if (!res.ok) return null
      return await res.json()
    } catch {
      return null
    }
  }

  // 1. address → addressId
  const addrBody = await get(
    `${base}/addresses?addressString=${encodeURIComponent(input.address)}` +
      `&state=${encodeURIComponent(input.state)}&perPage=1`,
  )
  const addressId = pickAddressId(addrBody)
  if (!addressId) return EMPTY

  // 2. addressId → best building summary (carries the sub-resource links)
  const listBody = await get(`${base}/buildings?addressId=${encodeURIComponent(addressId)}`)
  const best = pickBestSummary(pickBuildingSummaries(listBody))
  if (!best) return EMPTY

  const link = (key: string, fallback: string) =>
    absoluteLink(
      base,
      best.links[key] ?? `/v1/buildings/${encodeURIComponent(best.buildingId)}/${fallback}`,
    )

  // 3. fetch the painting-relevant sub-resources in parallel
  const [levelsBody, eaveBody, zoneBody, areaBody] = await Promise.all([
    get(link('estimatedLevels', 'estimatedLevels')),
    get(link('averageEaveHeight', 'averageEaveHeight')),
    get(link('zonings', 'zonings')),
    get(link('area', 'area')),
  ])

  const patch: GeoscapePaintPatch = {}
  const notes: string[] = []

  const storeys = extractStoreys(levelsBody)
  if (storeys != null) {
    patch.storeys = storeys
    notes.push(`Storeys (${storeys}) from Geoscape.`)
  }
  const eave = extractEaveHeight(eaveBody)
  if (eave != null) {
    patch.eave_height_m = eave
    notes.push(`Eave height (${eave.toFixed(1)} m) from Geoscape.`)
  }
  const use = extractZoning(zoneBody)
  if (use != null) patch.property_type = use
  const footprint = extractArea(areaBody)
  if (footprint != null) patch.footprint_m2 = Math.round(footprint * 10) / 10

  return { patch, notes }
}

/** PURE — turn a relative /v1/… link into an absolute URL on baseUrl's host. */
export function absoluteLink(base: string, relative: string): string {
  try {
    const b = new URL(base)
    return new URL(relative, `${b.protocol}//${b.host}`).toString()
  } catch {
    return base.replace(/\/v1\/?$/, '') + relative
  }
}

/** PURE — positive eave height (m) from an averageEaveHeight sub-resource. */
export function extractEaveHeight(body: unknown): number | null {
  if (body == null) return null
  if (typeof body === 'number') return Number.isFinite(body) && body > 0 ? body : null
  if (typeof body !== 'object') return null
  const b = body as Record<string, unknown>
  for (const k of ['averageEaveHeight', 'eaveHeight', 'eave_height', 'value']) {
    const v = b[k]
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) return v
    if (typeof v === 'string') {
      const n = parseFloat(v)
      if (Number.isFinite(n) && n > 0) return n
    }
  }
  if (b.data && typeof b.data === 'object') return extractEaveHeight(b.data)
  return null
}

/** PURE — first zoning/use label from a zonings sub-resource → property type. */
export function extractZoning(body: unknown): string | null {
  if (body == null) return null
  if (typeof body === 'string') return body.trim() || null
  if (typeof body !== 'object') return null
  const b = body as Record<string, unknown>
  const z = b.zonings ?? b.zoning ?? b.buildingUse ?? b.building_use ?? b.use
  if (Array.isArray(z)) {
    const first = z.find((x) => typeof x === 'string' && x.trim())
    return typeof first === 'string' ? first.trim() : null
  }
  if (typeof z === 'string' && z.trim()) return z.trim()
  if (b.data && typeof b.data === 'object') return extractZoning(b.data)
  return null
}
