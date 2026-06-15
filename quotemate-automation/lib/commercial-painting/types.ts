// ════════════════════════════════════════════════════════════════════
// lib/commercial-painting/types.ts — shared contract for the
// Commercial Painting estimator (strategy v11, spec 2026-06-12).
//
// Commercial painting extends the Estimator-Beta plumbing: a paint_run
// owns N plan_uploads (classified construction documents) and one
// current plan_extractions row whose items are PaintTakeoffItem[] (a
// painting-shaped superset of the electrical takeoff item).
//
// MONEY PATH IS PURE TYPESCRIPT — price.ts prices a confirmed takeoff
// against paint_rates rows; unmatched lines are returned unpriced,
// never guessed (same discipline as lib/estimation/price.ts).
//
// PURE TYPES — no I/O, no SDK imports.
// ════════════════════════════════════════════════════════════════════

// ── Documents ─────────────────────────────────────────────────────────

/** Auto-classified upload kind. Exactly one plan_set is required per run. */
export type PaintDocType =
  | 'plan_set'
  | 'measurement_takeoff'
  | 'services_layout'
  | 'site_photo'
  | 'other'

export const PAINT_DOC_TYPES: PaintDocType[] = [
  'plan_set',
  'measurement_takeoff',
  'services_layout',
  'site_photo',
  'other',
]

/** Sanity bound on a per-quote labour-rate override ($/hr). Shared by the
 *  pricing route (server validation) and the takeoff editor (client input
 *  max + inline validation) so the two never disagree — a value the editor
 *  accepts is always one the server will apply. */
export const MAX_LABOUR_RATE_PER_HR = 1000

/** paint_runs.status lifecycle. */
export type PaintRunStatus = 'draft' | 'extracting' | 'ready' | 'priced' | 'failed'

// ── Takeoff items (plan_extractions.items / corrected_items) ─────────

/** Paint application system — drives labour coverage + default product. */
export type PaintSystem = 'spray_matt' | 'flat' | 'low_sheen' | 'semi_gloss'

export const PAINT_SYSTEMS: PaintSystem[] = ['spray_matt', 'flat', 'low_sheen', 'semi_gloss']

export type PaintConfidence = 'high' | 'medium' | 'low'

/** Where a takeoff line came from (reconciliation provenance). */
export type PaintLineSource = 'plan' | 'measurements' | 'both' | 'manual'

/**
 * One paint takeoff line. Stored in plan_extractions.items /
 * corrected_items jsonb — a superset of the electrical shape, so
 * existing electrical rows remain valid readers of the same columns.
 */
export type PaintTakeoffItem = {
  /** "Retail concrete ceiling (thermal panels)" */
  surface: string
  /** "Retail" | "BOH" | "Kitchen" | "Office" | "Wet areas" | … */
  room: string
  /** "concrete" | "plasterboard" | "suspension tile" | "timber" | … */
  substrate: string
  system: PaintSystem
  /** Doors/frames are per-item; everything else m². */
  unit: 'm2' | 'item'
  /** m² or count. */
  quantity: number
  /** Default 2. */
  coats: number
  /** Drives the access multiplier + equipment trigger. */
  height_m?: number
  confidence: PaintConfidence
  source: PaintLineSource
  /** When source='both' and the two documents disagree (percent, signed). */
  delta_pct?: number
  /** "separate price for fridge window wall" pattern. */
  separate_price?: boolean
  /** Tradie excluded this line in the editor — not priced, listed in exclusions. */
  excluded?: boolean
  /** Provenance: plan page / measurements line no. */
  note?: string
}

// ── Reconciliation ────────────────────────────────────────────────────

/** A parsed line from the painter's measurements document. */
export type MeasurementLine = {
  /** Line number in the document, 1-based, when known. */
  line_no?: number
  surface: string
  room: string
  unit: 'm2' | 'item'
  quantity: number
  /** Paint-system note when the doc carries one. */
  system?: PaintSystem
  note?: string
}

/** Flag the reconciler attaches for the confirm UI. */
export type ReconcileFlag = {
  kind: 'delta' | 'plan_only' | 'measurements_only'
  surface: string
  room: string
  detail: string
}

export type ReconcileResult = {
  items: PaintTakeoffItem[]
  flags: ReconcileFlag[]
}

// ── Rates (paint_rates rows → resolved book) ─────────────────────────

/** One paint_rates DB row (subset the engine reads). */
export type PaintRateRow = {
  kind: 'labour' | 'material' | 'modifier' | 'equipment'
  code: string
  label: string
  tenant_id?: string | null
  system?: string | null
  method?: string | null
  product?: string | null
  coverage_m2_per_hr?: number | null
  spread_m2_per_l?: number | null
  price_per_l_ex_gst?: number | null
  unit_hours?: number | null
  value?: number | null
  unit?: string | null
  is_default?: boolean
}

export type PaintMethod = 'spray' | 'roller' | 'brush' | 'per_item'

/** Resolved, validated rate book the pricer consumes. */
export type PaintRateBook = {
  /** key `${system}:${method}` → m²/hr per painter per coat. */
  labour: Record<string, { coverage: number; label: string; code: string }>
  /** Per-item labour (doors): hours per unit per coat. */
  perItem: { unitHours: number; label: string; code: string } | null
  /** key system → default product. */
  materials: Record<string, { product: string; spread: number; pricePerL: number; code: string }>
  /** Per-item lines use this product (enamel). */
  perItemMaterial: { product: string; spread: number; pricePerL: number; code: string } | null
  modifiers: {
    heightLow: number
    heightMid: number
    heightHigh: number
    prepPct: number
    sundriesPct: number
    labourRatePerHr: number
    crewHoursPerDay: number
    defaultCrewSize: number
  }
  equipment: {
    scissorLift: { label: string; dayRate: number; code: string } | null
  }
  /** True when any consumed row is an unvalidated seeded default. */
  usesSeedDefaults: boolean
}

// ── Priced output ─────────────────────────────────────────────────────

/** Per-line audit trace — mirrors the electrical PriceTrace discipline. */
export type PaintPriceTrace = {
  method: PaintMethod
  rateCode: string
  heightMultiplier: number
  labourFormula: string
  materialFormula: string
}

export type PricedPaintLine = {
  surface: string
  room: string
  system: PaintSystem
  unit: 'm2' | 'item'
  quantity: number
  coats: number
  height_m?: number
  separate_price: boolean
  labourHours: number
  labourExGst: number
  product: string
  litres: number
  materialExGst: number
  lineExGst: number
  trace: PaintPriceTrace
}

export type PaintMaterialSummary = {
  product: string
  /** Raw litres before whole-L rounding. */
  litresRaw: number
  /** Whole litres purchased. */
  litres: number
  pricePerL: number
  /** litres × $/L × (1 + sundries). */
  costExGst: number
}

export type PaintEquipmentLine = {
  code: string
  label: string
  days: number
  dayRate: number
  costExGst: number
  reason: string
}

export type PricedPaintBom = {
  lines: PricedPaintLine[]
  /** Lines whose system matched no labour rate — never guessed. */
  unmatched: Array<{ surface: string; room: string; system: string; quantity: number }>
  /** Tradie-excluded lines, surfaced as quote exclusions. */
  excluded: Array<{ surface: string; room: string; quantity: number; unit: 'm2' | 'item' }>

  labour: {
    hours: number
    ratePerHr: number
    crewSize: number
    estimatedDays: number
    costExGst: number
  }
  materials: PaintMaterialSummary[]
  materialsExGst: number
  equipment: PaintEquipmentLine[]
  equipmentExGst: number

  /** separate_price lines totalled independently. */
  separate: {
    lines: PricedPaintLine[]
    exGst: number
  }

  subtotalExGst: number
  gst: number
  totalIncGst: number
  gstRegistered: boolean

  assumptions: string[]
  exclusions: string[]
}
