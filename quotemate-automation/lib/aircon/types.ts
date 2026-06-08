// ════════════════════════════════════════════════════════════════════
// Air-conditioning trade — shared types (Phase 1).
//
// A self-contained deterministic slice, like painting/roofing. The
// money path is a rate card, NOT the strict-grounding Opus estimator.
// Pipeline: climate.ts → sizing.ts → recommend.ts. PURE TYPES, no I/O.
// ════════════════════════════════════════════════════════════════════

export type AusState = 'NSW' | 'VIC' | 'QLD' | 'SA' | 'WA' | 'TAS' | 'ACT' | 'NT'

/** Coarse climate grouping (from NCC zones) → drives kW/m². */
export type ClimateZone = 'cool' | 'temperate' | 'subtropical' | 'tropical'

export type CeilingHeight = 'standard' | 'high' | 'raked'
export type Insulation = 'good' | 'average' | 'poor' | 'unknown'
export type CurrentSituation = 'none' | 'replacing' | 'adding'

/** Confidence in the derived sizing → band width + routing. */
export type AcConfidence = 'high' | 'medium' | 'low'

/** Only conditioned room kinds are modelled; bathrooms are excluded. */
export type RoomType = 'bedroom' | 'living'

export type AcAddressInput = {
  address: string
  postcode: string
  state: AusState
}

/** What the tradie types into the form. */
export type AcPropertyInputs = {
  bedrooms: number
  bathrooms: number
  living_spaces: number
  /** Internal floor area in m². When present, pins confidence to high. */
  floor_area_m2?: number | null
  ceiling_height: CeilingHeight
  insulation: Insulation
  current_situation: CurrentSituation
  /** Optional customer budget — nudges ducted vs split + routing. */
  budget?: number | null
}

export type RoomLoad = {
  room_type: RoomType
  area_m2: number
  kw: number
}

/** Deterministic sizing output. */
export type AcSizing = {
  rooms: RoomLoad[]
  conditioned_zones: number
  total_floor_area_m2: number
  /** floor area × ceiling height — Jon's "volumetric box" explainer. */
  total_volume_m3: number
  ceiling_height_m: number
  connected_kw: number
  connected_kw_low: number
  connected_kw_high: number
  /** connected × diversity factor — the central-unit size for ducted. */
  ducted_kw: number
  confidence: AcConfidence
  notes: string[]
}

export type AcSystemType = 'ducted' | 'split'

/** Indicative inc-GST price band. */
export type AcPriceRange = {
  low: number
  high: number
}

export type AcOption = {
  system_type: AcSystemType
  capacity_kw: number
  price: AcPriceRange
  best_fit: boolean
  pros: string[]
  cons: string[]
}

/** Indicative posture: there is only ever one decision. */
export type AcRoutingDecision = {
  decision: 'book_assessment'
  reason: string
}

export type AcRecommendation = {
  sizing: AcSizing
  /** Always two options, ordered [ducted, split]. */
  options: AcOption[]
  routing: AcRoutingDecision
  confidence: AcConfidence
}

// ── Rate card (per-tenant overridable via pricing_book.overlays) ──────

export type AcSplitRates = {
  /** Supply+install $ ex-GST per indoor head, keyed by kW band string. */
  per_head: Record<string, number>
  /** Discount applied when 2+ heads. 0.08 = 8% off. */
  multi_head_discount_pct: number
}

export type AcDuctedRates = {
  rate_per_kw: number
  base_ex_gst: number
  per_zone: number
  min_ex_gst: number
}

export type AcRateCard = {
  split: AcSplitRates
  ducted: AcDuctedRates
  gst_registered: boolean
}
