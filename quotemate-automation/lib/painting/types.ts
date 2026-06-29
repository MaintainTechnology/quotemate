// ════════════════════════════════════════════════════════════════════
// Painting trade — shared types (Phase 1, scaffold).
//
// Mirrors the roofing slice: a self-contained pipeline that does NOT
// touch lib/intake/structure.ts or the strict-grounding estimator. The
// IntakeSchema enum stays ['electrical', 'plumbing'].
//
// The painting money path is deterministic, like roofing — but the
// hard input is INTERNAL FLOOR AREA, which no free/official AU source
// returns per-address. So the pipeline is:
//   property-data provider → PropertyFacts → area engine (floor area →
//   paintable m²) → pricing (G/B/B + routing). Every external number is
//   a derived ESTIMATE with a confidence band; low confidence routes to
//   an on-site measure (the same inspection fallback roofing uses).
//
// PURE TYPES — no I/O, no SDK. Used by:
//   • lib/painting/providers/*  (property-data adapters)
//   • lib/painting/area.ts      (floor area → paintable area)
//   • lib/painting/pricing.ts   ($/m² × area × coats/prep → tiers)
//   • lib/painting/measure.ts   (orchestrator)
//   • app/api/painting/estimate/route.ts (HTTP boundary)
//   • app/dashboard/painting/*  (UI — the two-tab tool)
// ════════════════════════════════════════════════════════════════════

/** The paintable surface scopes a tradie can toggle on a job. */
export type PaintScope =
  | 'walls' // interior wall area (the big one)
  | 'ceilings' // interior ceiling area ≈ floor area
  | 'trim' // skirting / architraves / doors — priced per linear metre
  | 'exterior' // façade — derived from footprint + storeys

/** Substrate condition → labour/prep multiplier. `poor` forces inspection. */
export type PaintCondition =
  | 'sound' // previously painted, sound — the baseline
  | 'minor' // nail holes / hairline / light patching
  | 'bare' // bare plaster / new render / bare timber — needs full prime
  | 'poor' // flaking / water damage / mould → forced inspection

/** Ceiling-height bucket. `raked` and `extra_high` force inspection. */
export type CeilingHeight =
  | 'standard' // ~2.4 m — modern slab homes
  | 'high' // ~2.7 m — Queenslanders / period
  | 'extra_high' // ~3 m+ flat — beyond the auto-price band → forced inspection (access/scaffold)
  | 'raked' // cathedral / void / non-standard → forced inspection

/** Property-side inputs the lead form provides. Mirrors RoofAddressInput. */
export type PaintAddressInput = {
  address: string
  postcode: string
  state: 'NSW' | 'VIC' | 'QLD' | 'SA' | 'WA' | 'TAS' | 'ACT' | 'NT'
}

/** Job inputs the customer / tradie declares on top of the lookup. */
export type PaintUserInputs = {
  /** Which surfaces to paint. At least one. */
  scopes: PaintScope[]
  /** Number of topcoats. 2 is the AU residential default. */
  coats: 1 | 2 | 3
  condition: PaintCondition
  ceiling_height: CeilingHeight
  /** Light-over-dark / dark-over-light needs extra coverage. */
  colour_change: boolean
  /**
   * Storeys the customer/tradie declares. Overrides the provider's value
   * (the Google Solar footprint path can't infer storeys, and a 2-storey
   * home has ~2× the floor area for the same footprint). When omitted,
   * the provider's storeys (or 1) is used.
   */
  storeys?: 1 | 2 | 3
  /**
   * Customer/tradie-supplied internal floor area, in m². When present it
   * overrides whatever the property-data provider returned and pins
   * confidence to HIGH — this is the "paste the floor plan figure" path.
   */
  manual_floor_area_m2?: number | null
}

/** Where the floor-area number came from — drives the confidence band. */
export type FloorAreaSource =
  | 'listing' // a real listing's building size (REA scrape / Domain) → high
  | 'footprint' // footprint × storeys (Google Solar / Geoscape) → medium
  | 'beds_estimate' // inferred from bedroom count only → low
  | 'manual' // customer/tradie-entered → high
  | null

/** Which data source produced the facts (for tracing + the UI badge). */
export type PropertyDataSource =
  | 'rea' // realestate.com.au — needs a managed scraper (no official API)
  | 'domain' // Domain API — beds/baths/land, NOT floor area
  | 'solar' // Google Solar API — footprint only
  | 'geoscape' // Geoscape National Buildings — licensed total_floor_area
  | 'mock' // deterministic demo data
  | 'manual' // hand-entered

/**
 * The structured property facts a provider returns. Every field is
 * nullable — a provider returns what it can, and the area engine decides
 * whether it has enough to estimate or must route to inspection.
 */
export type PropertyFacts = {
  /** Internal floor area in m². The number the whole estimate hinges on. */
  floor_area_m2: number | null
  /** How floor_area_m2 was obtained — sets the confidence tier. */
  floor_area_source: FloorAreaSource
  /** Top-down building footprint in m² (roof outprint). */
  footprint_m2: number | null
  storeys: number | null
  bedrooms: number | null
  bathrooms: number | null
  year_built: number | null
  property_type: string | null
  land_size_m2: number | null
  /** Whether a floor plan is known to exist for this address. */
  has_floor_plan: boolean
  source: PropertyDataSource
  /** Free-text provenance note surfaced to the tradie (e.g. "stale listing"). */
  capture_note: string | null
}

/** Operator-actionable failure codes from a property-data lookup. */
export type PropertyLookupFailureCode =
  | 'address_not_resolved'
  | 'no_data_for_address'
  | 'rea_not_configured' // the REA tab with no scraper/paste configured
  | 'provider_unavailable'
  | 'provider_rate_limited'
  | 'provider_invalid_response'

export type PropertyLookupSuccess = {
  ok: true
  facts: PropertyFacts
  provider: PropertyDataSource
  /** Soft warnings the UI surfaces but that do not block estimation. */
  warnings: string[]
}

export type PropertyLookupFailure = {
  ok: false
  code: PropertyLookupFailureCode
  detail: string
}

export type PropertyLookupResult = PropertyLookupSuccess | PropertyLookupFailure

/** Confidence in the derived paintable area → drives band width + routing. */
export type PaintConfidence = 'high' | 'medium' | 'low'

/** One measured paintable surface. Walls/ceilings/exterior are m²; trim is lm. */
export type PaintSurfaceArea = {
  scope: PaintScope
  unit: 'm2' | 'lm'
  /** Point estimate of the quantity. */
  quantity: number
  /** Low / high bounds of the quantity from the confidence band. */
  quantity_low: number
  quantity_high: number
}

/** The structured area output — provider-agnostic, fully deterministic. */
export type PaintMeasurement = {
  floor_area_m2: number
  floor_area_low_m2: number
  floor_area_high_m2: number
  floor_area_source: FloorAreaSource
  ceiling_height_m: number
  storeys: number
  confidence: PaintConfidence
  surfaces: PaintSurfaceArea[]
  /** Notes on how each number was derived (shown in the UI breakdown). */
  notes: string[]
}

/** Routing outcome — identical shape to roofing's decider. */
export type PaintingRoutingDecision =
  | { decision: 'auto_quote'; reason: string }
  | { decision: 'tradie_review'; reason: string }
  | { decision: 'inspection_required'; reason: string }

/** Per-tenant pricing inputs. Overridable via pricing_book.overlays. */
export type PaintingRateCard = {
  /** All-in (labour + material) $/unit per scope, 2 coats on sound substrate. */
  rate_per_unit: Record<PaintScope, number>
  /** Coats multiplier on the base (2-coat) rate. */
  coats_multiplier: Record<1 | 2 | 3, number>
  /** Substrate-condition labour multiplier. `poor` never reaches pricing. */
  condition_multiplier: Record<Exclude<PaintCondition, 'poor'>, number>
  /** Extra prep when the customer changes colour (light/dark). */
  colour_change_extra: number
  /** Good tier = a 1-coat refresh, expressed as a fraction of Better. */
  good_refresh_fraction: number
  /** Best tier = premium paint + extra care, expressed as an uplift. */
  premium_uplift_pct: number
  /** Exterior double-storey access loading (0.5 = +50% on exterior). */
  double_storey_loading_pct: number
  gst_registered: boolean
  /** Per-job floor (ex-GST) so a tiny job never computes an absurd number. */
  call_out_minimum_ex_gst?: number

  // ── Hourly pricing model (optional; absent ⇒ 'sqm', backward compatible) ──
  // Some painters quote by labour time, not $/m². In 'hourly' mode the engine
  // converts each surface's measured area into labour hours via
  // production_rate_per_unit, then charges hourly_rate. Everything downstream
  // (coats/prep multipliers, loadings, tiers, GST, call-out floor) is identical
  // to 'sqm' mode — only the per-unit base rate changes from a fixed $/unit to
  // (hourly_rate ÷ production_rate).
  /** How surfaces are priced. Absent or 'sqm' = fixed $/unit; 'hourly' = hours × rate. */
  pricing_model?: 'sqm' | 'hourly'
  /** Crew charge-out ($/hr, ex-GST). Only consulted when pricing_model === 'hourly'. */
  hourly_rate?: number
  /** Throughput per hour for a base (2-coat, sound) job — m²/hr for walls /
   *  ceilings / exterior, lm/hr for trim. Converts area → hours in hourly mode.
   *  Absent ⇒ DEFAULT_PAINTING_PRODUCTION_RATES. */
  production_rate_per_unit?: Record<PaintScope, number>
}

/** A single price tier on the customer quote — carries a low/high band. */
export type PaintingPriceTier = {
  tier: 'good' | 'better' | 'best'
  label: string
  ex_gst: number
  inc_gst: number
  /** Band bounds (inc GST) from the area confidence — the "range, not point". */
  inc_gst_low: number
  inc_gst_high: number
  scope: string
}

/**
 * Transparent breakdown of HOW the tiers were built — every input that
 * contributed to the numbers, so the tradie can see (and trust) where
 * Good/Better/Best came from. All figures are at the POINT quantity.
 */
export type PaintingPriceBreakdown = {
  /** Per-scope Better-tier contribution: quantity × rate × multipliers. */
  surfaces: Array<{
    scope: PaintScope
    unit: 'm2' | 'lm'
    quantity: number
    rate_per_unit: number
    line_ex_gst: number
  }>
  /** Multipliers applied to every surface line (1.0 = no effect). */
  coats_multiplier: number
  prep_multiplier: number
  colour_change_multiplier: number
  /** Exterior-only access multiplier (1.0 unless 2-storey exterior). */
  double_storey_multiplier: number
  /** Better-tier subtotal ex GST (sum of the surface lines). */
  better_ex_gst: number
  /** Good = Better × this fraction (a lighter 1-coat refresh scope). */
  good_refresh_fraction: number
  /** Best = Better × (1 + this). */
  premium_uplift_pct: number
  /** inc-GST multiplier (1.10 when GST-registered, else 1.0). */
  gst_factor: number
  /** Per-job floor that raised any tier (0 = no floor). */
  call_out_minimum_ex_gst: number
  /** Pricing model the tiers were computed under. Absent ⇒ 'sqm'. */
  pricing_model?: 'sqm' | 'hourly'
  /** Crew charge-out applied (only set in hourly mode). */
  hourly_rate?: number
}

/** The full price breakdown returned to the dashboard / customer page. */
export type PaintingQuotePrice = {
  confidence: PaintConfidence
  /** Total paintable m² priced (walls + ceilings + exterior; trim is lm). */
  total_area_m2: number
  tiers: [PaintingPriceTier, PaintingPriceTier, PaintingPriceTier]
  loadings_applied: Array<{
    code: 'double_storey' | 'colour_change'
    pct: number
    detail: string
  }>
  routing: PaintingRoutingDecision
  call_out_minimum_applied?: boolean
  /** How the tiers were computed — surfaced in the UI for transparency. */
  breakdown?: PaintingPriceBreakdown
  /** True once a tradie has hand-edited the tier prices/labels/scope on the
   *  /p review page (lib/painting/edit.ts). The UI then flags the tiers as
   *  tradie-set and suppresses the now-stale derivation breakdown. */
  manual_override?: boolean
}

/** The orchestrator's combined result — facts + measurement + price. */
export type PaintingEstimate = {
  provider: PropertyDataSource
  facts: PropertyFacts
  measurement: PaintMeasurement
  price: PaintingQuotePrice
  warnings: string[]
}
