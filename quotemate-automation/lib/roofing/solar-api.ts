// ════════════════════════════════════════════════════════════════════
// Roofing — Google Solar API roof-geometry enrichment (measured pitch).
//
// WHAT THIS ADDS
//   Geoscape gives us a 2-D footprint + a roof-form label, but PITCH is
//   self-declared by the customer (a coarse bucket) and the sloped area is
//   footprint × a bucket multiplier. That declared pitch is the weakest
//   number on the roofing money path. Google's Solar API
//   (buildingInsights:findClosest) returns the MEASURED pitch + area of
//   every roof segment, so we can replace the declared bucket with a real
//   area-weighted mean pitch and a true sloped area = footprint / cos(θ).
//
// DOCTRINE (same as the rest of lib/roofing — see pricing.ts header)
//   • Deterministic money path: all arithmetic here is pure; the network
//     client only fetches. No LLM touches the price.
//   • Fail-safe: ANY miss (no coverage, low imagery quality, network
//     error, missing key, disabled flag) falls back to TODAY's declared-
//     pitch behaviour — never throws, never blocks a quote.
//   • Geoscape stays the canonical AREA source. Solar only supplies the
//     PITCH; we apply it to the Geoscape footprint so the rest of the
//     system keeps one area source of truth.
//   • Measured very-steep (> 35°) routes to inspection (fall-protection
//     cost variance) — a safety win over a customer under-declaring pitch.
//   • Every roofing quote is still tradie-reviewed before send; pitch
//     overrides are surfaced as warnings, not hidden.
//
// COVERAGE / COST
//   Solar API coverage is strong in AU metros, patchy regionally — the
//   imagery-quality gate handles the gaps. It is an enterprise-priced
//   per-address call, so the orchestrator only invokes it when
//   ROOFING_SOLAR_ENRICHMENT=true AND a key is present, and only on the
//   building(s) being measured.
//
// The pure functions are fully unit-testable; the one I/O function takes
// an injectable fetch impl (same pattern as providers/geoscape.ts).
// ════════════════════════════════════════════════════════════════════

import type { PitchBucket, RoofMetrics, RoofUserInputs } from './types'
import { slopedAreaFromFootprint } from './pricing'
import { polygonCentroid } from './map-utils'

export type ImageryQuality = 'HIGH' | 'MEDIUM' | 'LOW'

/** One roof plane as reported by the Solar API. */
export type SolarRoofSegment = {
  /** Slope of the plane in degrees from horizontal. */
  pitchDegrees: number
  /** Compass orientation in degrees (0 = N), when present. */
  azimuthDegrees: number | null
  /** Segment area in m² — used as the weight for the mean pitch. */
  areaMeters2: number
}

/** Parsed, money-path-relevant view of a buildingInsights response. */
export type SolarRoofInsight = {
  segments: SolarRoofSegment[]
  segmentCount: number
  /** Area-weighted mean pitch across all usable segments. */
  weightedMeanPitchDegrees: number
  imageryQuality: ImageryQuality
  /** ISO date (YYYY-MM-DD) the imagery was captured, when present. */
  imageryDate: string | null
}

export type SolarApiResult =
  | { ok: true; insight: SolarRoofInsight }
  | {
      ok: false
      code:
        | 'no_key'
        | 'no_coverage'
        | 'http_error'
        | 'network_error'
        | 'invalid_response'
      detail: string
    }

/** The outcome the orchestrator consumes — final metrics + (possibly
 *  pitch-overridden) inputs, plus whether the measured pitch was applied. */
export type SolarEnrichmentOutcome = {
  metrics: RoofMetrics
  inputs: RoofUserInputs
  warnings: string[]
  /** true → measured pitch drove the result; false → declared fallback. */
  applied: boolean
}

type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>

export type SolarEnrichmentOpts = {
  /** Force on/off. Defaults to ROOFING_SOLAR_ENRICHMENT === 'true'. */
  enabled?: boolean
  /** Defaults to GOOGLE_SOLAR_API_KEY ?? GOOGLE_MAPS_API_KEY. */
  apiKey?: string
  fetchImpl?: FetchLike
  baseUrl?: string
  /** Imagery qualities accepted for the MONEY path. Default HIGH+MEDIUM. */
  acceptQualities?: ImageryQuality[]
}

export type ResolvedSolarOpts = Required<
  Pick<SolarEnrichmentOpts, 'enabled' | 'acceptQualities'>
> & {
  apiKey: string | undefined
  fetchImpl: FetchLike | undefined
  baseUrl: string | undefined
}

const DEFAULT_BASE_URL =
  process.env.GOOGLE_SOLAR_API_BASE_URL ??
  'https://solar.googleapis.com/v1/buildingInsights:findClosest'

const DEFAULT_ACCEPT_QUALITIES: ImageryQuality[] = ['HIGH', 'MEDIUM']

// ── Config resolution ───────────────────────────────────────────────

/** PURE — resolve opts ← explicit ← env. */
export function resolveSolarOpts(opts: SolarEnrichmentOpts = {}): ResolvedSolarOpts {
  return {
    enabled: opts.enabled ?? process.env.ROOFING_SOLAR_ENRICHMENT === 'true',
    apiKey:
      opts.apiKey ??
      process.env.GOOGLE_SOLAR_API_KEY ??
      process.env.GOOGLE_MAPS_API_KEY,
    fetchImpl: opts.fetchImpl,
    baseUrl: opts.baseUrl,
    acceptQualities: opts.acceptQualities ?? DEFAULT_ACCEPT_QUALITIES,
  }
}

/** PURE — is enrichment both switched on AND able to authenticate? When
 *  false the orchestrator stays on the existing declared-pitch path and
 *  never makes a Solar call. */
export function solarEnabled(opts: SolarEnrichmentOpts = {}): boolean {
  const r = resolveSolarOpts(opts)
  return r.enabled && !!r.apiKey
}

// ── Pure geometry / mapping ─────────────────────────────────────────

/** PURE — true sloped area from a footprint + measured pitch in degrees.
 *  sloped = footprint / cos(θ). Returns null for out-of-range inputs so
 *  the caller routes to inspection rather than emitting a bogus number. */
export function slopedAreaFromPitchDegrees(
  footprint_m2: number,
  pitchDegrees: number,
): number | null {
  if (!Number.isFinite(footprint_m2) || footprint_m2 <= 0) return null
  if (!Number.isFinite(pitchDegrees) || pitchDegrees < 0 || pitchDegrees >= 90) {
    return null
  }
  const c = 1 / Math.cos((pitchDegrees * Math.PI) / 180)
  return round1(footprint_m2 * c)
}

/** PURE — area-weighted mean pitch across segments. Returns null when no
 *  segment carries a usable (finite, ≥0) pitch with positive area. */
export function weightedMeanPitchDegrees(
  segments: SolarRoofSegment[],
): number | null {
  let wSum = 0
  let pSum = 0
  for (const s of segments) {
    if (!Number.isFinite(s.pitchDegrees) || s.pitchDegrees < 0) continue
    const w = Number.isFinite(s.areaMeters2) && s.areaMeters2 > 0 ? s.areaMeters2 : 0
    if (w <= 0) continue
    wSum += w
    pSum += w * s.pitchDegrees
  }
  if (wSum <= 0) return null
  return pSum / wSum
}

/** PURE — map measured degrees onto the existing PitchBucket ranges
 *  (see types.ts): shallow < 20, standard 20–25, steep 26–35, very_steep
 *  > 35. Keeps measured pitch flowing through the same routing logic. */
export function pitchDegreesToBucket(deg: number): PitchBucket {
  if (!Number.isFinite(deg) || deg < 0) return 'unknown'
  if (deg < 20) return 'shallow'
  if (deg <= 25) return 'standard'
  if (deg <= 35) return 'steep'
  return 'very_steep'
}

// ── Pure response parsing ───────────────────────────────────────────

/**
 * PURE — pull the money-path-relevant fields out of a Solar API
 * buildingInsights response. Tolerant of the documented shape and a
 * couple of nesting variants (`{data:{...}}`). Returns null when there
 * are no usable roof segments.
 */
export function parseBuildingInsights(body: unknown): SolarRoofInsight | null {
  if (!body || typeof body !== 'object') return null
  let b = body as Record<string, unknown>
  // Tolerate a { data: {...} } envelope.
  if (
    !('solarPotential' in b) &&
    b.data &&
    typeof b.data === 'object' &&
    'solarPotential' in (b.data as Record<string, unknown>)
  ) {
    b = b.data as Record<string, unknown>
  }

  const potential = b.solarPotential
  if (!potential || typeof potential !== 'object') return null
  const rawSegments = (potential as Record<string, unknown>).roofSegmentStats
  if (!Array.isArray(rawSegments)) return null

  const segments: SolarRoofSegment[] = []
  for (const item of rawSegments) {
    if (!item || typeof item !== 'object') continue
    const seg = item as Record<string, unknown>
    const pitch = numberOrNull(seg.pitchDegrees)
    if (pitch === null) continue
    const stats = (seg.stats ?? {}) as Record<string, unknown>
    const area =
      numberOrNull(stats.areaMeters2) ??
      numberOrNull(stats.groundAreaMeters2) ??
      numberOrNull(seg.areaMeters2)
    if (area === null || area <= 0) continue
    segments.push({
      pitchDegrees: pitch,
      azimuthDegrees: numberOrNull(seg.azimuthDegrees),
      areaMeters2: area,
    })
  }

  if (segments.length === 0) return null
  const mean = weightedMeanPitchDegrees(segments)
  if (mean === null) return null

  return {
    segments,
    segmentCount: segments.length,
    weightedMeanPitchDegrees: mean,
    imageryQuality: normaliseQuality(b.imageryQuality),
    imageryDate: formatImageryDate(b.imageryDate),
  }
}

/** PURE — Solar API returns imageryDate as {year, month, day}. */
export function formatImageryDate(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object') return null
  const d = raw as Record<string, unknown>
  const y = numberOrNull(d.year)
  const m = numberOrNull(d.month)
  const day = numberOrNull(d.day)
  if (y === null) return null
  const mm = String(m ?? 1).padStart(2, '0')
  const dd = String(day ?? 1).padStart(2, '0')
  return `${y}-${mm}-${dd}`
}

/** PURE — coerce the imageryQuality enum; unknown values degrade to LOW
 *  so they fail the money-path quality gate rather than being trusted. */
export function normaliseQuality(raw: unknown): ImageryQuality {
  if (raw === 'HIGH' || raw === 'MEDIUM' || raw === 'LOW') return raw
  return 'LOW'
}

// ── Pure enrichment (the core money-path transform) ─────────────────

/**
 * PURE — apply a measured Solar insight to the metrics + inputs.
 *
 * Geoscape footprint stays canonical; we swap the sloped area to use the
 * measured pitch and override the declared pitch bucket. A measured
 * very-steep roof nulls the sloped area + flips the input pitch to
 * 'very_steep' so the existing inspection routing fires. Always emits a
 * warning when the measured bucket differs from what the customer
 * declared (tradie confirms on review).
 */
export function applySolarInsight(
  metrics: RoofMetrics,
  inputs: RoofUserInputs,
  insight: SolarRoofInsight,
): SolarEnrichmentOutcome {
  const deg = round1(insight.weightedMeanPitchDegrees)
  const bucket = pitchDegreesToBucket(deg)
  const warnings: string[] = []

  const enriched: RoofMetrics = {
    ...metrics,
    pitch_degrees: deg,
    pitch_source: 'measured',
    roof_segment_count: insight.segmentCount,
    imagery_quality: insight.imageryQuality,
    imagery_date: insight.imageryDate,
  }

  if (bucket === 'very_steep') {
    // Don't price a steep roof off imagery — fall protection cost varies
    // too much. Null the area + set the input so requiresInspection fires.
    enriched.sloped_area_m2 = null
    warnings.push(
      `Measured roof pitch ≈ ${deg}° (very steep) from Google Solar imagery — routing to inspection so fall-protection access can be priced on site.`,
    )
  } else {
    enriched.sloped_area_m2 = slopedAreaFromPitchDegrees(metrics.footprint_m2, deg)
  }

  if (bucket !== inputs.pitch) {
    warnings.push(
      `Measured pitch ≈ ${deg}° (${bucket}) from Google Solar imagery — overrides the declared "${inputs.pitch}" pitch. Confirm before sending.`,
    )
  }

  return {
    metrics: enriched,
    inputs: { ...inputs, pitch: bucket },
    warnings,
    applied: true,
  }
}

// ── I/O — the one network call ──────────────────────────────────────

/**
 * Fetch buildingInsights for a coordinate. Best-effort surface: returns a
 * discriminated union, never throws on operational failure. requiredQuality
 * is LOW so we receive whatever imagery exists and gate the quality
 * ourselves for the money path.
 */
export async function fetchBuildingInsights(
  loc: { lat: number; lng: number },
  opts: ResolvedSolarOpts,
): Promise<SolarApiResult> {
  if (!opts.apiKey) {
    return { ok: false, code: 'no_key', detail: 'Solar API key is not set.' }
  }
  const base = opts.baseUrl ?? DEFAULT_BASE_URL
  const url =
    `${base}?location.latitude=${encodeURIComponent(loc.lat.toFixed(7))}` +
    `&location.longitude=${encodeURIComponent(loc.lng.toFixed(7))}` +
    `&requiredQuality=LOW&key=${encodeURIComponent(opts.apiKey)}`
  const fetchImpl = opts.fetchImpl ?? ((u, init) => fetch(u, init))

  let res: Response
  try {
    res = await fetchImpl(url, { method: 'GET', headers: { Accept: 'application/json' } })
  } catch (e) {
    return {
      ok: false,
      code: 'network_error',
      detail: e instanceof Error ? e.message : String(e),
    }
  }
  if (res.status === 404) {
    // findClosest 404 = no building / no imagery near this coordinate.
    return {
      ok: false,
      code: 'no_coverage',
      detail: 'Google Solar API has no building coverage at this location.',
    }
  }
  if (!res.ok) {
    return { ok: false, code: 'http_error', detail: `Solar API HTTP ${res.status}.` }
  }
  let body: unknown
  try {
    body = await res.json()
  } catch {
    return { ok: false, code: 'invalid_response', detail: 'Solar API returned non-JSON.' }
  }
  const insight = parseBuildingInsights(body)
  if (!insight) {
    return {
      ok: false,
      code: 'invalid_response',
      detail: 'Solar API response had no usable roof segments.',
    }
  }
  return { ok: true, insight }
}

/**
 * Enrich one building's metrics with a measured pitch from the Solar API.
 *
 * ALWAYS returns a usable outcome:
 *   • applied=true  → measured pitch drove sloped area + pitch bucket.
 *   • applied=false → declared-pitch fallback (today's behaviour), with a
 *     warning explaining why (no polygon, no coverage, low quality,
 *     network error, …). Never throws.
 */
export async function enrichMetricsWithSolar(
  metrics: RoofMetrics,
  inputs: RoofUserInputs,
  opts: ResolvedSolarOpts,
): Promise<SolarEnrichmentOutcome> {
  const centroid = polygonCentroid(metrics.polygon_geojson)
  if (!centroid) {
    return declaredFallback(
      metrics,
      inputs,
      'Solar pitch skipped: no building polygon to locate; used declared pitch.',
    )
  }
  const [lng, lat] = centroid

  const res = await fetchBuildingInsights({ lat, lng }, opts)
  if (!res.ok) {
    return declaredFallback(
      metrics,
      inputs,
      `Solar pitch unavailable (${res.code}); used declared pitch. ${res.detail}`,
    )
  }

  if (!opts.acceptQualities.includes(res.insight.imageryQuality)) {
    return declaredFallback(
      metrics,
      inputs,
      `Solar imagery quality ${res.insight.imageryQuality} is below the threshold for pricing; used declared pitch.`,
    )
  }

  return applySolarInsight(metrics, inputs, res.insight)
}

/** PURE — the declared-pitch result, identical to the pre-Solar path. The
 *  metrics get pitch_source='declared' so the UI can show provenance. */
export function declaredFallback(
  metrics: RoofMetrics,
  inputs: RoofUserInputs,
  reason: string,
): SolarEnrichmentOutcome {
  return {
    metrics: {
      ...metrics,
      sloped_area_m2: slopedAreaFromFootprint(metrics.footprint_m2, inputs.pitch),
      pitch_source: 'declared',
    },
    inputs,
    warnings: [reason],
    applied: false,
  }
}

// ── tiny helpers ─────────────────────────────────────────────────────

function numberOrNull(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string') {
    const n = Number.parseFloat(v)
    if (Number.isFinite(n)) return n
  }
  return null
}

function round1(n: number): number {
  if (!Number.isFinite(n)) return 0
  return Math.round(n * 10) / 10
}

export const __test_only__ = { round1, numberOrNull, DEFAULT_BASE_URL }
