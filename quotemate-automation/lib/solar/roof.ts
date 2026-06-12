// ════════════════════════════════════════════════════════════════════
// Solar — normalise a parsed buildingInsights result into roof facts.
//
// The reused solar-api parser (parseBuildingInsights) extracts segments,
// area-weighted pitch and imagery only — it was written for the roofing
// pitch override. Solar additionally needs maxArrayPanelsCount,
// panelCapacityWatts and the precomputed solarPanelConfigs. Those live in
// solarPotential on the SAME response body, so this module takes the
// parsed SolarRoofInsight PLUS a `raw` handle to that body and reads the
// extra fields directly. The result is the single SolarRoofFacts shape
// the rest of the engine consumes (manual-fallback.ts produces the same
// shape with source='manual').
//
// PURE — no I/O, fully unit-testable.
// ════════════════════════════════════════════════════════════════════

import type { SolarRoofInsight } from '../roofing/solar-api'
import type {
  SolarCoverageResult,
  SolarRoofFacts,
  SolarRoofPlane,
  SolarOrientation,
  SolarPanelConfig,
  SolarPanelPlacement,
  SolarImageryQuality,
  SolarConfig,
} from './types'

/** The parsed insight plus the raw response body it came from. */
export type SolarRoofInsightWithRaw = SolarRoofInsight & { raw: unknown }

/** Module-level constant; config.default_panel_capacity_watts takes precedence. */
const DEFAULT_PANEL_CAPACITY_WATTS = 400

export function normaliseSolarRoofFacts(
  insights: SolarRoofInsightWithRaw,
  coverage: Extract<SolarCoverageResult, { covered: true }>,
  config?: Pick<SolarConfig, 'default_panel_capacity_watts'>,
): SolarRoofFacts {
  // Per-plane sunshine quantiles, aligned with insights.segments by
  // replaying the SAME skip conditions parseBuildingInsights applies
  // (no pitch → skip; no positive area → skip). See readSegmentQuantiles.
  const segmentQuantiles = readSegmentQuantiles(insights.raw)

  const planes: SolarRoofPlane[] = insights.segments.map((s, i) => ({
    pitch_degrees: round1(s.pitchDegrees),
    azimuth_degrees: s.azimuthDegrees,
    // Each plane's area_m2 is rounded for display only. The usable_area_m2
    // total is computed by summing raw segment areas FIRST (see below) and
    // applying a single round1() there — avoiding accumulated per-plane
    // rounding error (quality issue #1). The per-plane round1 here is purely
    // for human-readable output and does NOT feed into the area total.
    area_m2: round1(s.areaMeters2),
    orientation: azimuthToOrientation(s.azimuthDegrees, s.pitchDegrees),
    sunshine_quantiles: segmentQuantiles[i] ?? null,
  }))

  // Sum raw segment areas first; apply a single round1() to avoid
  // double-rounding that accumulates across segments (quality issue #1).
  const rawAreaSum = insights.segments.reduce((acc, s) => acc + s.areaMeters2, 0)
  const usable_area_m2 = round1(rawAreaSum)

  // Primary orientation = the orientation of the single largest plane.
  const largest = planes.reduce<SolarRoofPlane | null>(
    (best, p) => (best === null || p.area_m2 > best.area_m2 ? p : best),
    null,
  )
  const primary_orientation: SolarOrientation = largest?.orientation ?? 'unknown'

  const sp = readSolarPotential(insights.raw)

  // Assign to a local variable to avoid the double parse (quality issue #4).
  const rawMaxPanels = numberOr(sp.maxArrayPanelsCount, 0)
  const max_panels_count = rawMaxPanels > 0 ? Math.floor(rawMaxPanels) : 0

  // Prefer config.default_panel_capacity_watts for reproducibility (quality issue #3).
  const configDefault =
    config?.default_panel_capacity_watts != null &&
    config.default_panel_capacity_watts > 0
      ? config.default_panel_capacity_watts
      : DEFAULT_PANEL_CAPACITY_WATTS

  // Guard: an API panelCapacityWatts that is <= 0 or non-finite (NaN/Infinity)
  // is unusable — it would produce a zero-kW system silently. Fall back to
  // configDefault (which is itself guarded above) so a bad API value never
  // propagates into the estimate (quality issue #5).
  const rawCapacity = numberOr(sp.panelCapacityWatts, configDefault)
  const panel_capacity_watts = rawCapacity > 0 ? rawCapacity : configDefault

  const panel_configs: SolarPanelConfig[] = Array.isArray(sp.solarPanelConfigs)
    ? sp.solarPanelConfigs
        .map((c): SolarPanelConfig | null => {
          if (!c || typeof c !== 'object') return null
          const obj = c as Record<string, unknown>
          const panels = numberOr(obj.panelsCount, NaN)
          const dc = numberOr(obj.yearlyEnergyDcKwh, NaN)
          if (!Number.isFinite(panels) || !Number.isFinite(dc)) return null
          return {
            panels_count: Math.floor(panels),
            yearly_energy_dc_kwh: round1(dc),
          }
        })
        .filter((c): c is SolarPanelConfig => c !== null)
    : []

  // mean_pitch_degrees: apply an explicit isFinite guard before round1 so
  // that an undeterminable pitch (NaN from a degenerate single-segment body)
  // returns null rather than 0 (quality issue #2).
  const rawPitch = insights.weightedMeanPitchDegrees
  const mean_pitch_degrees: number | null = Number.isFinite(rawPitch)
    ? round1(rawPitch)
    : null

  // ── Premium-quote fields (spec 2026-06-12 §4.1) ────────────────────

  // Per-panel placements: solarPotential.solarPanels[] — Google orders by
  // energy, so the first N entries are the N-panel config. Each entry is
  // guarded; malformed entries are dropped rather than zeroed.
  const panels: SolarPanelPlacement[] = Array.isArray(sp.solarPanels)
    ? sp.solarPanels
        .map((p): SolarPanelPlacement | null => {
          if (!p || typeof p !== 'object') return null
          const obj = p as Record<string, unknown>
          const center = obj.center as Record<string, unknown> | undefined
          const lat = numberOr(center?.latitude, NaN)
          const lng = numberOr(center?.longitude, NaN)
          if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
          return {
            center: { lat, lng },
            orientation: obj.orientation === 'PORTRAIT' ? 'PORTRAIT' : 'LANDSCAPE',
            segment_index: Math.max(0, Math.floor(numberOr(obj.segmentIndex, 0))),
            yearly_energy_dc_kwh: round1(numberOr(obj.yearlyEnergyDcKwh, 0)),
          }
        })
        .filter((p): p is SolarPanelPlacement => p !== null)
    : []

  // Per-plane panel distribution, DERIVED by counting solarPanels[] per
  // segment_index. (The real Google API does not put panelsCount on
  // roofSegmentStats — per-config counts live in roofSegmentSummaries —
  // so deriving from the placements keeps the count consistent with the
  // drawn layout by construction.) Null when no geometry exists.
  const planesWithCounts: SolarRoofPlane[] = planes.map((plane, i) => ({
    ...plane,
    panels_count:
      panels.length > 0 ? panels.filter((p) => p.segment_index === i).length : null,
  }))

  // Physical panel dimensions (drive drawn rectangle size). Null when absent.
  const heightM = numberOr(sp.panelHeightMeters, NaN)
  const widthM = numberOr(sp.panelWidthMeters, NaN)
  const panel_size_m =
    Number.isFinite(heightM) && heightM > 0 && Number.isFinite(widthM) && widthM > 0
      ? { height_m: heightM, width_m: widthM }
      : null

  // Grid CO₂ offset factor → environmental section. Null when absent.
  const rawCarbon = numberOr(sp.carbonOffsetFactorKgPerMwh, NaN)
  const carbon_offset_factor_kg_per_mwh =
    Number.isFinite(rawCarbon) && rawCarbon > 0 ? round1(rawCarbon) : null

  // wholeRoofStats.areaMeters2 — validation cross-check only (guardrails
  // checkRoofAreaConsistency reads it; never blocks).
  const wholeStats =
    sp.wholeRoofStats && typeof sp.wholeRoofStats === 'object'
      ? (sp.wholeRoofStats as Record<string, unknown>)
      : {}
  const rawWholeArea = numberOr(wholeStats.areaMeters2, NaN)
  const whole_roof_area_m2 =
    Number.isFinite(rawWholeArea) && rawWholeArea > 0 ? round1(rawWholeArea) : null

  // ── Sun & shade fields (full-exploitation build 2026-06-13) ────────

  const rawSunHours = numberOr(sp.maxSunshineHoursPerYear, NaN)
  const max_sunshine_hours_per_year =
    Number.isFinite(rawSunHours) && rawSunHours > 0 ? round1(rawSunHours) : null

  const rawArrayArea = numberOr(sp.maxArrayAreaMeters2, NaN)
  const max_array_area_m2 =
    Number.isFinite(rawArrayArea) && rawArrayArea > 0 ? round1(rawArrayArea) : null

  const rawLifetime = numberOr(sp.panelLifetimeYears, NaN)
  const panel_lifetime_years =
    Number.isFinite(rawLifetime) && rawLifetime > 0 ? Math.floor(rawLifetime) : null

  const whole_roof_sunshine_quantiles = parseQuantiles(wholeStats.sunshineQuantiles)

  return {
    source: 'google',
    usable_area_m2,
    planes: planesWithCounts,
    segment_count: insights.segmentCount,
    primary_orientation,
    mean_pitch_degrees,
    max_panels_count,
    panel_capacity_watts,
    panel_configs,
    storeys: null,
    polygon_geojson: null,
    imagery_quality: coverage.imagery_quality as SolarImageryQuality,
    imagery_date: coverage.imagery_date,
    panels,
    panel_size_m,
    carbon_offset_factor_kg_per_mwh,
    whole_roof_area_m2,
    max_sunshine_hours_per_year,
    max_array_area_m2,
    panel_lifetime_years,
    whole_roof_sunshine_quantiles,
  }
}

/** PURE — coarse 8-point orientation from a compass azimuth. Flat roofs
 *  (pitch < 5°) read as 'flat'; a non-finite or null azimuth reads as
 *  'unknown'. A non-finite pitch also reads as 'unknown' because the roof
 *  tilt is undeterminable — we cannot reliably assign a direction label
 *  (quality issue #7). */
export function azimuthToOrientation(
  azimuth: number | null,
  pitchDegrees: number,
): SolarOrientation {
  // Guard non-finite pitch first — an undeterminable tilt means we cannot
  // reliably classify the orientation (quality issue #7).
  if (!Number.isFinite(pitchDegrees)) return 'unknown'
  if (pitchDegrees < 5) return 'flat'
  if (azimuth === null || !Number.isFinite(azimuth)) return 'unknown'
  const a = ((azimuth % 360) + 360) % 360
  const buckets: SolarOrientation[] = [
    'north', 'north_east', 'east', 'south_east',
    'south', 'south_west', 'west', 'north_west',
  ]
  // 45°-wide sectors centred on each cardinal/intercardinal point.
  const idx = Math.round(a / 45) % 8
  return buckets[idx]
}

// ── helpers ──────────────────────────────────────────────────────────

/**
 * PURE — validate a sunshineQuantiles value: a non-empty array of finite,
 * non-negative numbers (Google sends ascending percentiles). Returns null
 * for anything else so a malformed payload never poisons the estimate.
 */
function parseQuantiles(v: unknown): number[] | null {
  if (!Array.isArray(v) || v.length === 0) return null
  const out: number[] = []
  for (const q of v) {
    const n = numberOr(q, NaN)
    if (!Number.isFinite(n) || n < 0) return null
    out.push(round1(n))
  }
  return out
}

/**
 * PURE — per-segment sunshineQuantiles aligned with the parser's surviving
 * segments. parseBuildingInsights skips raw roofSegmentStats entries with
 * no pitch or no positive area; this replays exactly those conditions so
 * index i here corresponds to insights.segments[i]. If Google ever changes
 * shape, a misaligned read degrades to null quantiles — never a wrong map.
 */
function readSegmentQuantiles(raw: unknown): Array<number[] | null> {
  const sp = readSolarPotential(raw)
  const rawSegments = sp.roofSegmentStats
  if (!Array.isArray(rawSegments)) return []
  const out: Array<number[] | null> = []
  for (const item of rawSegments) {
    if (!item || typeof item !== 'object') continue
    const seg = item as Record<string, unknown>
    const pitch = numberOr(seg.pitchDegrees, NaN)
    if (!Number.isFinite(pitch)) continue
    const stats = (seg.stats ?? {}) as Record<string, unknown>
    const area = numberOr(
      stats.areaMeters2,
      numberOr(stats.groundAreaMeters2, numberOr(seg.areaMeters2, NaN)),
    )
    if (!Number.isFinite(area) || area <= 0) continue
    out.push(parseQuantiles(stats.sunshineQuantiles))
  }
  return out
}

function readSolarPotential(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object') return {}
  let b = raw as Record<string, unknown>
  if (!('solarPotential' in b) && b.data && typeof b.data === 'object') {
    b = b.data as Record<string, unknown>
  }
  const sp = b.solarPotential
  return sp && typeof sp === 'object' ? (sp as Record<string, unknown>) : {}
}

function numberOr(v: unknown, fallback: number): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string') {
    const n = Number.parseFloat(v)
    if (Number.isFinite(n)) return n
  }
  return fallback
}

function round1(n: number): number {
  if (!Number.isFinite(n)) return 0
  return Math.round(n * 10) / 10
}

export const __test_only__ = { azimuthToOrientation, round1, DEFAULT_PANEL_CAPACITY_WATTS }
