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

// Type-only import — erased at compile time, so the types.ts ↔ solar.ts
// cycle is purely structural and never a runtime dependency.
import type { SolarQuoteAddon } from './solar'

/** Roofing materials we price for. Phase 1 — adds-only. */
export type RoofMaterial =
  | 'colorbond_corrugated'
  | 'colorbond_trimdek'
  | 'colorbond_spandek'
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
 * Premium building attributes from the paid Geoscape Buildings API
 * (Roof / Height / Solar insight packs), fetched per building alongside
 * the footprint. Every field is nullable — null when Geoscape has no
 * value for that building or the sub-resource isn't licensed / reachable.
 */
export type GeoscapeBuildingAttributes = {
  /** Roof material verbatim from Geoscape, e.g. "Metal" / "Tile". */
  roof_material: string | null
  /** Roof complexity band, e.g. "Moderate pitch or complexity". */
  roof_complexity: string | null
  /** Highest roof point above ground in metres (from maximumRoofHeight). */
  max_roof_height_m: number | null
  /** Average eave height above ground in metres (from averageEaveHeight). */
  eave_height_m: number | null
  /** Ground elevation above the AHD datum in metres. */
  ground_elevation_m: number | null
  /** Derived roof rise = max roof height − eave height, metres. Null when
   *  either height is missing. */
  roof_rise_m: number | null
  /** Whether Geoscape detected existing solar panels on the roof. */
  solar_panel: boolean | null
  /** Whether a tree overhangs the roof (access / debris signal). */
  overhanging_tree: boolean | null
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
  /**
   * Stable provider-side identity for this structure. Surfaced so the
   * multi-structure UI / persistence can key per-building state on a
   * durable id. Optional for back-compat — the single-building path and
   * the mock provider may leave it null. Sub-polygons split out of a
   * MultiPolygon footprint are suffixed (e.g. `${buildingId}#1`).
   */
  buildingId?: string | null
  // ── Solar-API pitch enrichment (optional, additive) ────────────────
  // Populated by lib/roofing/solar-api.ts when ROOFING_SOLAR_ENRICHMENT
  // is on and Google Solar imagery covers the building. All optional so
  // existing callers / persisted payloads are unaffected.
  /** Area-weighted mean roof pitch in degrees, when measured from imagery. */
  pitch_degrees?: number | null
  /** Where sloped_area_m2's pitch came from: 'measured' (Solar) or 'declared'. */
  pitch_source?: 'measured' | 'declared'
  /** Number of roof planes the Solar API reported for this building. */
  roof_segment_count?: number | null
  /** Solar imagery quality backing the measured pitch. */
  imagery_quality?: 'HIGH' | 'MEDIUM' | 'LOW' | null
  /** ISO date (YYYY-MM-DD) the Solar imagery was captured. */
  imagery_date?: string | null
  // ── Geoscape premium building attributes (optional, additive) ────────
  // Populated by lib/roofing/providers/geoscape.ts from the paid Buildings
  // API roof / height / solar sub-resources. Absent on mock / manual /
  // legacy measurements; individual fields are null when unavailable.
  building_attributes?: GeoscapeBuildingAttributes | null
}

/** Which structure on the parcel a measurement represents. */
export type RoofStructureRole = 'primary' | 'secondary'

/**
 * One measured structure in a multi-building result. The `primary` is
 * the dwelling Geoscape resolves most specifically to the queried
 * address; `secondary` structures are detached buildings (sheds,
 * garages, granny flats) or extra footprint polygons at the same parcel.
 */
export type RoofMeasuredBuilding = {
  buildingId: string | null
  role: RoofStructureRole
  metrics: RoofMetrics
}

export type RoofingMultiMeasurementSuccess = {
  ok: true
  buildings: RoofMeasuredBuilding[]
  provider: 'geoscape' | 'lidar' | 'mock' | 'manual'
  warnings: string[]
}

export type RoofingMultiMeasurementResult =
  | RoofingMultiMeasurementSuccess
  | RoofingMeasurementFailure

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
  /**
   * Minimum job charge (ex-GST). A per-structure floor so a tiny
   * structure (e.g. a 12 m² shed) never computes an unrealistic price
   * no roofer would honour — each tier's ex-GST amount is raised to at
   * least this value. Optional; absent/0 means no floor.
   */
  call_out_minimum_ex_gst?: number
  /**
   * Per-linear-metre rate to repoint ridge and hip caps. Mirrors the
   * seeded `Repoint ridge and hip caps` assembly (migration 080,
   * $12.00/lm ex-GST). Optional; the default rate card supplies it.
   */
  ridge_hip_repoint_rate_per_lm?: number
  /**
   * Per-linear-metre rate to replace valley flashing. Mirrors the seeded
   * `Valley flashing replacement` assembly (migration 080, $45.00/lm
   * ex-GST). Optional; the default rate card supplies it.
   */
  valley_flashing_rate_per_lm?: number
  /**
   * Master switch — itemise hip/valley edge works on the quote. When
   * false, no edge line items are produced and tiers reproduce the
   * pre-edge-works output exactly. Optional; defaults to true.
   */
  price_edge_works?: boolean
}

/**
 * One itemised line on a roofing price tier. The shape matches what the
 * customer quote page (/q/[token]) expects in `good/better/best.line_items`.
 * Across a tier, the sum of `total_ex_gst` equals the tier's `ex_gst`.
 */
export type RoofingLineItem = {
  /** Unit of measure for the quantity. */
  unit: 'sqm' | 'lm' | 'each'
  quantity: number
  /** Single-line scope, sentence case. */
  description: string
  unit_price_ex_gst: number
  total_ex_gst: number
  /** Where the cost sits — labour-led (sqm works) or material-led (edge works). */
  source: 'labour' | 'material'
}

/**
 * Derived hip/valley edge-works summary. Surfaced so display surfaces can
 * show the same hips/valleys figures pricing used — never "0 shown but
 * charged". Counts are the raw metric counts (null when the roof form
 * could not classify them); the `_lm` figures are the derived lengths.
 */
export type RoofingEdgeWorks = {
  hips_count: number | null
  valleys_count: number | null
  hips_lm: number | null
  valleys_lm: number | null
  /** The per-edge length applied to the counts. */
  per_edge_length_m: number
  /** Whether per-edge length came from roof geometry or the fallback. */
  length_source: 'geometry' | 'fallback'
}

/** A single price tier on the customer quote. */
export type RoofingPriceTier = {
  tier: 'good' | 'better' | 'best'
  label: string
  ex_gst: number
  inc_gst: number
  /** Single-line scope of works, sentence case. */
  scope: string
  /**
   * Itemised breakdown of this tier. When present, the sum of
   * `line_items[].total_ex_gst` equals `ex_gst`. Optional for back-compat
   * with callers/tiers that don't decompose (they fall back to a single
   * sqm line at render time).
   */
  line_items?: RoofingLineItem[]
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
    code: 'multi_storey' | 'asbestos' | 'complexity'
    pct: number
    detail: string
  }>
  /** Routing decision derived from the measurement + inputs. */
  routing: RoofingRoutingDecision
  /** True when the call-out minimum raised one or more tiers. */
  call_out_minimum_applied?: boolean
  /**
   * Derived hip/valley edge-works summary (counts + linear metres) used to
   * build the edge line items. Exposed for display consistency. Absent when
   * edge-works pricing is disabled on the rate card.
   */
  edge_works?: RoofingEdgeWorks
}

// ── Multi-structure pricing ──────────────────────────────────────────
// A roofing job can span several structures on the one property (the
// dwelling plus a shed / garage / granny flat). Each structure is priced
// independently with its OWN material, area and loadings — areas are
// never summed onto a single material rate — then aggregated.

/** One priced structure inside a multi-roof quote. */
export type RoofStructurePrice = {
  buildingId: string | null
  role: RoofStructureRole
  /** Human label for the line, e.g. "Main dwelling" / "Secondary structure 1". */
  label: string
  metrics: RoofMetrics
  inputs: RoofUserInputs
  price: RoofingQuotePrice
}

/**
 * Property context from PropRadar (best-effort, additive). Present only when
 * PropRadar covers the address (on-market / recently-sold) and enrichment is
 * enabled. Supplements — never measures — the roof: dwelling type, age, and
 * areas that contextualise or sanity-check the Geoscape measurement.
 */
export type RoofPropertyContext = {
  source: 'propradar'
  property_id: string
  /** Dwelling type, e.g. "House" / "Unit" / "Townhouse". */
  property_type: string | null
  /** Year the dwelling was built — feeds the pre-1990 asbestos gate. Hobby+
   *  plan only; null on the free plan even when the property is covered. */
  year_built: number | null
  floor_area_sqm: number | null
  land_size_sqm: number | null
  bedrooms: number | null
  bathrooms: number | null
  parking: number | null
}

/** The aggregated multi-structure quote returned to the dashboard. */
export type MultiRoofQuote = {
  structures: RoofStructurePrice[]
  combined: {
    /** Sum of the sloped areas priced across all structures. */
    area_m2: number
    /** Per-tier totals summed across every structure (good / better / best). */
    tiers: [RoofingPriceTier, RoofingPriceTier, RoofingPriceTier]
  }
  /**
   * Job-level routing. If ANY structure individually requires
   * inspection, the whole job is inspection_required (a tradie must
   * attend the property regardless); otherwise tradie_review. Each
   * structure keeps its own routing flag for line-level transparency.
   */
  routing: RoofingRoutingDecision
  /** buildingIds (or labels) of the structures that triggered inspection. */
  inspection_structures: string[]
  /**
   * Existing-solar / skylight detection + the detach & reinstate allowance,
   * attached at save time (lib/roofing/solar.ts). Optional + additive — older
   * persisted payloads omit it and render exactly as before. The allowance is
   * a deterministic add-on on the roofing money path; it never flows through
   * the estimator grounding validator.
   */
  solar?: SolarQuoteAddon
  /**
   * Best-effort PropRadar property context (dwelling type, year built, areas),
   * attached at measurement time when enrichment is enabled and the address is
   * covered. Additive + optional — off-market addresses and disabled
   * enrichment simply omit it. See lib/roofing/propradar.ts.
   */
  property_context?: RoofPropertyContext | null
}
