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
  /** Storeys/levels: 1, 2, or 3 (3 = "3 or more"). Defaults to 1. */
  storeys?: number
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
  /** Plan room name (e.g. "Bed 2") when sizing came from a floor plan. */
  name?: string
  area_m2: number
  /** Room air volume (area × ceiling height) — the load basis. */
  volume_m3: number
  kw: number
}

export type AcFloorAreaSource = 'entered' | 'typical_room_mix' | 'solar_footprint' | 'floor_plan'

/** Deterministic sizing output. */
export type AcSizing = {
  rooms: RoomLoad[]
  conditioned_zones: number
  total_floor_area_m2: number
  floor_area_source: AcFloorAreaSource
  /** Sum of per-room volumes — the volumetric load basis. */
  total_volume_m3: number
  ceiling_height_m: number
  storeys: number
  /** kW per m³ of conditioned air for this climate zone. */
  volumetric_factor_kw_m3: number
  connected_kw: number
  connected_kw_low: number
  connected_kw_high: number
  /** connected × diversity factor — the central-unit size for ducted. */
  ducted_kw: number
  confidence: AcConfidence
  notes: string[]
  warnings: string[]
}

export type AcSystemType = 'ducted' | 'split'

/** Indicative inc-GST price band. */
export type AcPriceRange = {
  low: number
  high: number
}

export type AcPriceComponent = {
  label: string
  quantity: number
  unit: string
  rate_ex_gst: number
  total_ex_gst: number
  note?: string
}

export type AcPriceExplanation = {
  point_estimate_ex_gst: number
  point_estimate_inc_gst: number
  confidence_band_pct: number
  gst_registered: boolean
  formula: string
  band_reason: string
  components: AcPriceComponent[]
  adjustments: AcPriceComponent[]
}

export type AcOption = {
  system_type: AcSystemType
  capacity_kw: number
  price: AcPriceRange
  pricing: AcPriceExplanation
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

// ── Floor-plan pipeline (plan-extract.ts → plan-scale.ts → design.ts) ─
//
// Coordinates follow the estimator convention (lib/estimation/extract.ts):
// page is 1-based; x/y are percentages of the page measured from the
// top-left corner (0–100). The design artifact is deterministic geometry
// rendered as an SVG overlay — never a generated image.

/** A point on the plan page, in page-percent space (0–100, top-left origin). */
export type AcPlanPoint = {
  x: number
  y: number
}

/** Room kinds the plan extractor reports. Only some are conditioned. */
export type ExtractedRoomType =
  | 'bedroom'
  | 'living'
  | 'kitchen'
  | 'study'
  | 'bathroom'
  | 'laundry'
  | 'garage'
  | 'hall'
  | 'other'

/** One room as read off the uploaded floor plan. */
export type AcExtractedRoom = {
  /** The label printed on the plan (e.g. "BED 2", "FAMILY"). */
  name: string
  room_type: ExtractedRoomType
  /** Page-percent outline, ≥3 vertices, drawn clockwise or anticlockwise. */
  polygon: AcPlanPoint[]
  /** Dimension string printed in/near the room (e.g. "3.6 x 4.2"), if any. */
  dimensions_text?: string
  /** Area in m² when the model could read it directly off the plan. */
  area_m2?: number | null
  confidence: AcConfidence
}

/** Whole-plan extraction result (one floor-plan page). */
export type AcPlanExtraction = {
  /** 1-based page of the file the rooms were read from. */
  page: number
  rooms: AcExtractedRoom[]
  /** Total internal area printed on the plan (e.g. "Living 184.2 m²"), if stated. */
  stated_total_area_m2: number | null
  overall_note: string
}

/** A room with its final resolved area, ready for sizing + design. */
export type AcResolvedRoom = {
  name: string
  room_type: ExtractedRoomType
  /** Conditioned rooms map to a load type; bathrooms/halls/etc. do not. */
  load_type: RoomType | null
  polygon: AcPlanPoint[]
  area_m2: number
  area_source: 'dimensions' | 'stated_total_apportioned' | 'scale_inferred'
}

/** Plan-derived area evidence handed to the sizing engine. */
export type AcPlanAreaEvidence = {
  rooms: { name: string; room_type: RoomType; area_m2: number }[]
  /** True when areas derive from dimension strings or a stated plan total. */
  dimensioned: boolean
  capture_note: string
}

/** One supply-air outlet (ducted) or indoor head (split) placed in a room. */
export type AcPlacedUnit = {
  room: string
  at: AcPlanPoint
  kw: number
}

/** A straight indicative duct run from the central unit toward one outlet. */
export type AcDuctRun = {
  room: string
  from: AcPlanPoint
  to: AcPlanPoint
}

export type AcZoneGroup = {
  name: string
  rooms: string[]
}

export type AcDuctedLayout = {
  /** Central indoor (roof-space) unit position. */
  unit: AcPlanPoint
  return_air: AcPlanPoint
  outdoor: AcPlanPoint
  outlets: AcPlacedUnit[]
  runs: AcDuctRun[]
  zones: AcZoneGroup[]
  warnings: string[]
}

export type AcSplitLayout = {
  heads: AcPlacedUnit[]
  outdoor: AcPlanPoint
  warnings: string[]
}

/** Deterministic indicative system design over the uploaded floor plan. */
export type AcPlanDesign = {
  page: number
  ducted: AcDuctedLayout
  split: AcSplitLayout
}
