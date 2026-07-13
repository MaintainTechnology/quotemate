// ════════════════════════════════════════════════════════════════════
// Roofing — Geoscape × Google Solar measurement fusion.
//
// Geoscape and Google Solar each measure a roof better on different axes
// (see docs discussion 2026-07-13):
//   • Geoscape  — authoritative AU footprint (the border), roof form, storeys,
//                 and MATERIAL (>90% on unobstructed roofs). National coverage.
//   • Google Solar — DSM-MEASURED pitch + sloped roof area, where covered.
//
// The pitch + measured-area fusion happens in solar-api.ts (it owns the network
// call + quality gate). THIS module is the pure, source-agnostic layer that runs
// on EVERY measurement (Solar on or off) to:
//   1. attach per-field provenance (field_sources) — measured > derived > declared,
//   2. suggest the roof material from Geoscape (pre-fill / asbestos flag) WITHOUT
//      silently overriding the tradie's declared material (pricing input),
//   3. record where existing-solar knowledge comes from.
//
// DOCTRINE: never changes the pricing inputs silently. Material stays the
// tradie's declared choice; Geoscape's read is a SUGGESTION + a safety warning
// when it disagrees on asbestos. Pure, no I/O, unit-tested.
// ════════════════════════════════════════════════════════════════════

import type {
  RoofFieldSources,
  RoofMaterial,
  RoofMetrics,
  RoofUserInputs,
} from './types'

/**
 * PURE — map Geoscape's verbatim roof-material string (e.g. "Metal", "Tile",
 * "Fibre cement") onto our RoofMaterial enum. Geoscape classifies coarse
 * CATEGORIES, not Colorbond profiles, so metal maps to the corrugated default.
 * Returns null when the string is empty or unrecognised (no false confidence).
 * Cement/fibro/asbestos is the highest-value read — it drives the asbestos gate.
 */
export function roofMaterialFromGeoscape(
  raw: string | null | undefined,
): RoofMaterial | null {
  if (!raw || typeof raw !== 'string') return null
  const s = raw.toLowerCase()
  // Order matters: check asbestos-suspect + terracotta BEFORE the generic
  // "metal"/"tile" catch-alls.
  if (
    s.includes('cement') ||
    s.includes('fibro') ||
    s.includes('asbestos') ||
    s.includes('fibre')
  ) {
    return 'cement_sheet'
  }
  if (s.includes('terracotta') || s.includes('terra cotta') || s.includes('clay')) {
    return 'terracotta_tile'
  }
  if (s.includes('concrete')) return 'concrete_tile'
  if (
    s.includes('metal') ||
    s.includes('colorbond') ||
    s.includes('colourbond') ||
    s.includes('steel') ||
    s.includes('corrugat') ||
    s.includes('tin') ||
    s.includes('zinc')
  ) {
    return 'colorbond_corrugated'
  }
  // Generic "tile" with no material qualifier → concrete (the AU-common default).
  if (s.includes('tile') || s.includes('slate')) return 'concrete_tile'
  return null
}

export type MergeMeasurementResult = {
  /** Metrics with field_sources + suggested_material attached. */
  metrics: RoofMetrics
  /** Safety / provenance warnings for the tradie review (asbestos mismatch, …). */
  warnings: string[]
}

/**
 * PURE — attach fused provenance + a Geoscape material suggestion to a single
 * structure's metrics. Runs after the Solar pitch/area enrichment (or the
 * declared fallback), reading what's already on `metrics`:
 *   • pitch_source 'measured' → pitch came from Google Solar, else declared
 *   • area_source  'measured' → Google DSM roof area, else derived (cos-pitch)
 *   • building_attributes.roof_material → the material suggestion + asbestos flag
 *
 * Does NOT mutate the pricing inputs — the declared material still drives price;
 * `suggested_material` is surfaced for the tradie to confirm on /m.
 */
export function mergeMeasurement(args: {
  metrics: RoofMetrics
  inputs: RoofUserInputs
}): MergeMeasurementResult {
  const { metrics, inputs } = args
  const attrs = metrics.building_attributes ?? null
  const warnings: string[] = []

  const suggested_material = roofMaterialFromGeoscape(attrs?.roof_material)

  // Safety: Geoscape reading fibre-cement (asbestos-suspect) that the tradie
  // hasn't declared is a route-changing miss — surface it loudly. Never silently
  // re-price; the tradie confirms the material on review.
  if (suggested_material === 'cement_sheet' && inputs.material !== 'cement_sheet') {
    warnings.push(
      `Geoscape classifies this roof as fibre-cement ("${attrs?.roof_material}") — asbestos-suspect. Confirm the material before sending; the declared "${inputs.material}" may under-route the job.`,
    )
  }

  const field_sources: RoofFieldSources = {
    footprint: 'geoscape',
    pitch: metrics.pitch_source === 'measured' ? 'google_solar' : 'declared',
    sloped_area:
      metrics.area_source === 'measured'
        ? 'google_solar' // Google's DSM-measured roof area
        : 'derived', // footprint × pitch correction (measured or declared pitch)
    // Pricing uses the DECLARED material; Geoscape's read is the suggestion.
    material: 'declared',
    // form / storeys come from Geoscape when it could classify them. When it
    // couldn't (form 'unknown', storeys null) the field is simply undetermined —
    // there is NO declared form/storeys input, so we omit the source rather than
    // mislabel an absent measurement as tradie-declared.
    ...(metrics.form !== 'unknown' ? { form: 'geoscape' as const } : {}),
    ...(metrics.storeys != null ? { storeys: 'geoscape' as const } : {}),
    ...(attrs?.solar_panel != null ? { existing_solar: 'geoscape' as const } : {}),
  }

  return {
    metrics: { ...metrics, field_sources, suggested_material: suggested_material ?? null },
    warnings,
  }
}

/**
 * PURE — merge existing-solar knowledge across sources (Geoscape's solar_panel
 * flag + any vision/photo detection) into one boolean + its provenance. Used by
 * the solar-detect path to cross-check the vision read against Geoscape's flag.
 * Either source claiming panels → true (conservative for the detach allowance).
 */
export function fuseExistingSolar(args: {
  geoscapeFlag: boolean | null | undefined
  visionDetected: boolean | null | undefined
}): { hasSolar: boolean; source: 'geoscape' | 'vision' | 'both' | 'none' } {
  const g = args.geoscapeFlag === true
  const v = args.visionDetected === true
  if (g && v) return { hasSolar: true, source: 'both' }
  if (g) return { hasSolar: true, source: 'geoscape' }
  if (v) return { hasSolar: true, source: 'vision' }
  return { hasSolar: false, source: 'none' }
}
