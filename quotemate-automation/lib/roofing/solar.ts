// ════════════════════════════════════════════════════════════════════
// Roofing — existing-solar detection + detach & reinstate allowance.
//
// On a FULL RE-ROOF, any existing rooftop PV must be detached, stored and
// reinstated by a licensed electrician — a real cost roofers routinely
// miss. We detect panels from the same Google satellite aerial the tool
// already fetches (Gemini vision; see app/api/roofing/detect-solar), then
// add a configurable allowance to the re-roof tiers.
//
// Doctrine (same as the rest of the roofing money path): vision only
// CLASSIFIES; all arithmetic is here and deterministic; low-confidence
// detections FLAG but never silently change the price. The tradie reviews
// every roofing quote before send.
//
// PURE — no I/O. Fully unit-testable.
// ════════════════════════════════════════════════════════════════════

import type { RoofJobIntent, RoofingRateCard } from './types'

export type SolarConfidence = 'high' | 'medium' | 'low'

/** Vision output — what the aerial scan reports about existing PV. */
export type SolarDetection = {
  has_solar: boolean
  /** Distinct panel arrays on the roof. */
  array_count: number
  panel_count_estimate: number | null
  approx_area_m2: number | null
  confidence: SolarConfidence
  notes: string
}

/** The detach & reinstate allowance derived from a detection. */
export type SolarAllowance = {
  /** True when the $ is actually added to the quote (medium/high conf,
   *  full re-roof). False = flagged for the tradie but price unchanged. */
  applies: boolean
  arrays: number
  ex_gst: number
  inc_gst: number
  detail: string
  electrician_note: string
  low_confidence: boolean
}

/** Default allowance — base mobilisation + per-array. Tenant-overridable
 *  via pricing_book.overlays.roofing_rate_card.solar_*. AU detach+reinstate
 *  runs ~$800–$2,500 depending on system size. */
export const SOLAR_ALLOWANCE_DEFAULTS = {
  base_ex_gst: 1000,
  per_array_ex_gst: 700,
} as const

const ELECTRICIAN_NOTE =
  'A licensed electrician must disconnect the system before the re-roof and reconnect it after. Panel condition and inverter age are confirmed on site.'

/** PURE — the vision prompt for detecting existing PV on the centre building. */
export function buildSolarDetectPrompt(): string {
  return (
    'You are analysing a top-down satellite aerial of an Australian residential property. ' +
    'The building of interest is the one at the CENTRE of the image. Determine whether that ' +
    "central building's roof has EXISTING solar photovoltaic (PV) panels. Solar panels appear " +
    'as dark blue or black rectangular grid arrays sitting flat on the roof. Ignore skylights, ' +
    'windows, vents, shadows and the neighbouring houses. ' +
    'Respond ONLY with strict JSON, no prose, no code fences: ' +
    '{"has_solar": boolean, "array_count": number, "panel_count_estimate": number|null, ' +
    '"approx_area_m2": number|null, "confidence": "high"|"medium"|"low", "notes": string}'
  )
}

/** Gemini structured-output schema mirroring the JSON the prompt requests —
 *  passed as responseSchema so the model can only emit these keys (kills the
 *  "Sure, here's the JSON:" / code-fence fluff). parseSolarDetection stays
 *  as the defensive fallback for older/free-text responses. */
export const SOLAR_DETECTION_SCHEMA: Record<string, unknown> = {
  type: 'OBJECT',
  properties: {
    has_solar: { type: 'BOOLEAN' },
    array_count: { type: 'INTEGER' },
    panel_count_estimate: { type: 'INTEGER', nullable: true },
    approx_area_m2: { type: 'NUMBER', nullable: true },
    confidence: { type: 'STRING', enum: ['high', 'medium', 'low'] },
    notes: { type: 'STRING' },
  },
  required: ['has_solar', 'array_count', 'confidence', 'notes'],
}

/** PURE — parse the vision model's JSON text into a SolarDetection. Returns
 *  null when the text isn't usable. Defensive: tolerates code fences and
 *  coerces the numeric/enum fields. */
export function parseSolarDetection(text: string): SolarDetection | null {
  if (typeof text !== 'string' || text.trim() === '') return null
  const cleaned = text
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```$/i, '')
    .trim()
  let raw: unknown
  try {
    raw = JSON.parse(cleaned)
  } catch {
    return null
  }
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  if (typeof o.has_solar !== 'boolean') return null
  const num = (v: unknown): number | null =>
    typeof v === 'number' && Number.isFinite(v) ? v : null
  const conf: SolarConfidence =
    o.confidence === 'high' || o.confidence === 'medium' || o.confidence === 'low'
      ? o.confidence
      : 'low'
  const arrayCount = num(o.array_count)
  return {
    has_solar: o.has_solar,
    array_count: arrayCount != null && arrayCount > 0 ? Math.round(arrayCount) : o.has_solar ? 1 : 0,
    panel_count_estimate: num(o.panel_count_estimate),
    approx_area_m2: num(o.approx_area_m2),
    confidence: conf,
    notes: typeof o.notes === 'string' ? o.notes.slice(0, 500) : '',
  }
}

/** PURE — read the per-tenant solar allowance config off a merged rate
 *  card (stashed by the overlay), falling back to defaults. */
export function solarAllowanceConfigFromCard(card: RoofingRateCard): {
  base_ex_gst: number
  per_array_ex_gst: number
} {
  const c = card as {
    solar_detach_reinstate_base_ex_gst?: unknown
    solar_detach_reinstate_per_array_ex_gst?: unknown
  }
  const base = c.solar_detach_reinstate_base_ex_gst
  const per = c.solar_detach_reinstate_per_array_ex_gst
  return {
    base_ex_gst:
      typeof base === 'number' && Number.isFinite(base) && base >= 0
        ? base
        : SOLAR_ALLOWANCE_DEFAULTS.base_ex_gst,
    per_array_ex_gst:
      typeof per === 'number' && Number.isFinite(per) && per >= 0
        ? per
        : SOLAR_ALLOWANCE_DEFAULTS.per_array_ex_gst,
  }
}

/**
 * PURE — compute the detach & reinstate allowance from a detection.
 * Returns null when there's no solar at all. When solar IS present but
 * confidence is low or the job isn't a full re-roof, returns an allowance
 * with applies=false (flagged, price unchanged).
 */
export function computeSolarAllowance(
  detection: SolarDetection | null,
  opts: {
    intent: RoofJobIntent
    base_ex_gst?: number
    per_array_ex_gst?: number
    gstRegistered?: boolean
  },
): SolarAllowance | null {
  if (!detection || !detection.has_solar) return null

  const base = opts.base_ex_gst ?? SOLAR_ALLOWANCE_DEFAULTS.base_ex_gst
  const perArray = opts.per_array_ex_gst ?? SOLAR_ALLOWANCE_DEFAULTS.per_array_ex_gst
  const arrays = Math.max(1, detection.array_count || 1)
  const ex = base + perArray * arrays
  const gstFactor = opts.gstRegistered === false ? 1.0 : 1.1

  const lowConfidence = detection.confidence === 'low'
  // Detach/reinstate only matters when the roof surface is fully replaced.
  const applies = !lowConfidence && opts.intent === 'full_reroof'

  return {
    applies,
    arrays,
    ex_gst: round2(ex),
    inc_gst: round2(ex * gstFactor),
    detail: `${arrays} solar array${arrays === 1 ? '' : 's'} · detach & reinstate`,
    electrician_note: ELECTRICIAN_NOTE,
    low_confidence: lowConfidence,
  }
}

function round2(n: number): number {
  if (!Number.isFinite(n)) return 0
  return Math.round(n * 100) / 100
}

export const __test_only__ = { ELECTRICIAN_NOTE, round2 }
