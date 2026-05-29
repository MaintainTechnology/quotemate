// ════════════════════════════════════════════════════════════════════
// Roofing trade — shared types (Phase 1).
//
// The roofing pipeline runs as a self-contained slice that does NOT
// touch lib/intake/structure.ts. The IntakeSchema enum stays at
// ['electrical', 'plumbing'] — see docs/strategy.md v10 for rationale.
//
// PURE TYPES — no I/O, no SDK, no dependencies. Used by:
//   • lib/roofing/providers/* (measurement adapters)
//   • lib/roofing/measure.ts (orchestrator)
//   • lib/roofing/pricing.ts (rate × area calculation)
//   • app/api/roofing/measure/route.ts (HTTP boundary)
//   • app/dashboard/roofing/* (UI)
// ════════════════════════════════════════════════════════════════════

/** Roofing materials we price for. Phase 1 — adds-only. */
export type RoofMaterial =
  | 'colorbond_trimdek'
  | 'colorbond_kliplok'
  | 'concrete_tile'
  | 'terracotta_tile'
  | 'cement_sheet' // asbestos-suspect on pre-1990 builds → forced inspection
  | 'unknown'

/** Customer-declared pitch bucket. Phase 1 — no LiDAR-derived pitch yet. */
export type PitchBucket =
  | 'shallow' // < 20°
  | 'standard' // 20–25° (the AU residential default)
  | 'steep' // 26–35°
  | 'very_steep' // > 35° → forced inspection (fall-protection cost variance)
  | 'unknown'

/** Roof form, as classified by Geoscape Buildings (or, later, by LiDAR). */
export type RoofForm =
  | 'gable' // simple A-frame
  | 'hip' // sloped on all four sides
  | 'skillion' // single mono-pitch
  | 'gable_hip' // mixed
  | 'complex' // L-shape / multi-volume / irregular — usually → inspection
  | 'unknown'

/** Job intent — what the customer wants done. */
export type RoofJobIntent =
  | 'full_reroof'
  | 'patch_repair'
  | 'leak_trace'
  | 'gutter_replace'
  | 'ridge_cap'
  | 'flashing_repair'
  | 'unknown'

/** Property-side inputs the customer / lead form provides. */
export type RoofAddressInput = {
  /** Free-text street address as entered by the customer. */
  address: string
  /** AU postcode — used for tenant coverage gating. */
  postcode: string
  state: 'NSW' | 'VIC' | 'QLD' | 'SA' | 'WA' | 'TAS' | 'ACT' | 'NT'
}

/** Inputs the customer / tradie provides on top of the measurement. */
export type RoofUserInputs = {
  material: RoofMaterial
  pitch: PitchBucket
  /** Year built — pre-1990 triggers asbestos-risk inspection routing. */
  building_year_built?: number | null
  intent: RoofJobIntent
}

/**
 * The structured measurement output. Provider-agnostic: Geoscape, LiDAR
 * and a hand-entered fallback all return this shape. Nullable fields
 * mean the provider couldn't determine that metric — the orchestrator
 * decides whether to inspect or accept lower precision.
 */
export type RoofMetrics = {
  /** Top-down footprint area in m². Always present when the provider succeeded. */
  footprint_m2: number
  /**
   * Sloped (true) roof area in m². Derived from footprint × pitch correction.
   * Null when pitch is unknown and the provider can't infer it.
   */
  sloped_area_m2: number | null
  /** Storeys above ground level. */
  storeys: number | null
  /** Roof form classification. */
  form: RoofForm
  /** Estimated count of hip ridges (sloping ridges). */
  hips: number | null
  /** Estimated count of valley ridges (inward-folding). */
  valleys: number | null
  /** Estimated total ridge length in linear metres (horizontal + hip ridges). */
  ridge_lm: number | null
  /** GeoJSON polygon of the building footprint, EPSG:4326. */
  polygon_geojson: GeoJSONPolygon | null
  /** ISO date of the source-data capture (LiDAR survey, Geoscape refresh). */
  capture_date: string | null
}

/** Minimal GeoJSON polygon for the building outline. */
export type GeoJSONPolygon = {
  type: 'Polygon'
  /** [ [ [lng, lat], ... ] ] — first ring is the outer boundary. */
  coordinates: number[][][]
}

/** Why a measurement failed — operator-actionable codes. */
export type RoofingMeasurementFailureCode =
  | 'address_not_resolved'
  | 'outside_coverage'
  | 'no_building_at_address'
  | 'complex_form_requires_inspection'
  | 'provider_unavailable'
  | 'provider_rate_limited'
  | 'provider_invalid_response'

export type RoofingMeasurementFailure = {
  ok: false
  code: RoofingMeasurementFailureCode
  detail: string
}

export type RoofingMeasurementSuccess = {
  ok: true
  metrics: RoofMetrics
  provider: 'geoscape' | 'lidar' | 'mock' | 'manual'
  /** Soft warnings the orchestrator may surface in UI but do not block. */
  warnings: string[]
}

export type RoofingMeasurementResult =
  | RoofingMeasurementSuccess
  | RoofingMeasurementFailure

/** Routing outcome from the deterministic decider. */
export type RoofingRoutingDecision =
  | { decision: 'auto_quote'; reason: string }
  | { decision: 'tradie_review'; reason: string }
  | { decision: 'inspection_required'; reason: string }

/** Pricing inputs — the tenant's $/m² rate and loadings. */
export type RoofingRateCard = {
  /** Base full-reroof rate per sloped m² of the chosen material. */
  reroof_rate_per_m2: Record<RoofMaterial, number>
  /** Multi-storey loading as a fraction (0.20 = +20% on 2-storey jobs). */
  multi_storey_loading_pct: number
  /** Asbestos handling loading as a fraction (0.35 = +35%). */
  asbestos_loading_pct: number
  /** Per-tier ceiling — Good = patch, Better = same material, Best = upgrade material. */
  upgrade_material: RoofMaterial
  /** Tenant's GST registration status. */
  gst_registered: boolean
}

/** A single price tier on the customer quote. */
export type RoofingPriceTier = {
  tier: 'good' | 'better' | 'best'
  label: string
  ex_gst: number
  inc_gst: number
  /** Single-line scope of works, sentence case. */
  scope: string
}

/** The full price breakdown returned to the dashboard / customer page. */
export type RoofingQuotePrice = {
  /** The sloped area that pricing was applied to. */
  area_m2: number
  /** Display rate for the customer ("$X/m² applied to Y m²"). */
  effective_rate_per_m2: number
  /** Tier prices, always returned in good / better / best order. */
  tiers: [RoofingPriceTier, RoofingPriceTier, RoofingPriceTier]
  /** Total active loadings that were stacked on the base rate. */
  loadings_applied: Array<{
    code: 'multi_storey' | 'asbestos'
    pct: number
    detail: string
  }>
  /** Routing decision derived from the measurement + inputs. */
  routing: RoofingRoutingDecision
}
