// ════════════════════════════════════════════════════════════════════
// Roofing — existing-solar + skylight detection + detach & reinstate
// allowance.
//
// On a FULL RE-ROOF, any existing rooftop PV must be detached, stored and
// reinstated by a licensed electrician — a real cost roofers routinely
// miss. Skylights on the roof are also surfaced so the tradie can allow
// for re-flashing them (skylights are FLAGGED ONLY — never auto-priced).
//
// Detection runs from TWO sources and is merged:
//   • AERIAL — the Google satellite aerial the measure tool already fetches
//     (Gemini vision; see app/api/roofing/detect-solar).
//   • PHOTOS — customer-uploaded or tradie-attached close-up roof photos
//     (Claude/Anthropic vision; mirrors lib/roofing/vision-verify.ts).
// mergeSolarDetections combines them: the booleans are OR-ed, the counts
// come from the higher-confidence source, and a disagreement hedges the
// confidence down so a shaky read never auto-prices.
//
// Doctrine (same as the rest of the roofing money path): vision only
// CLASSIFIES; all arithmetic is here and deterministic; low-confidence
// detections FLAG but never silently change the price. The tradie reviews
// every roofing quote before send.
//
// PURE — no I/O except the two thin vision callers at the bottom, which
// never throw on operational failure. Fully unit-testable.
// ════════════════════════════════════════════════════════════════════

import type { RoofJobIntent, RoofingRateCard } from './types'

export type SolarConfidence = 'high' | 'medium' | 'low'

/** Which detection source produced a SolarDetection. */
export type SolarDetectionSource = 'aerial' | 'photo' | 'merged' | 'none'

/** Vision output — what a scan reports about existing PV + skylights. */
export type SolarDetection = {
  has_solar: boolean
  /** Distinct panel arrays on the roof. */
  array_count: number
  panel_count_estimate: number | null
  approx_area_m2: number | null
  /** Existing skylights on the roof — SURFACED ONLY, never auto-priced. */
  has_skylight: boolean
  /** Distinct skylights counted. */
  skylight_count: number
  confidence: SolarConfidence
  notes: string
  /** Confidence-aware, human-readable line for the tradie / customer, e.g.
   *  "Identified 2 solar panel arrays (high confidence)". Always populated
   *  by the parser / merge so the UI never has to build copy itself. */
  summary_note: string
  /** Which source(s) this detection came from. */
  source: SolarDetectionSource
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

/** One structure's own detection, retained so the tradie review can show
 *  WHICH building the panels/skylights are on (R3 per-structure attribution). */
export type SolarStructureDetection = {
  buildingId: string | null
  label: string
  detection: SolarDetection
}

/** What gets persisted onto MultiRoofQuote.solar + read back by the
 *  customer page / tradie review. Carries the merged job-level detection, the
 *  computed allowance, and the per-structure breakdown that fed the aggregate
 *  so the render surface is self-contained. */
export type SolarQuoteAddon = {
  detection: SolarDetection
  allowance: SolarAllowance | null
  /** Per-structure detections that fed the job-level aggregate (R3). */
  perStructure?: SolarStructureDetection[]
  /** Count of measured structures NOT scanned this run (cap / no polygon),
   *  surfaced so the tradie knows the scan wasn't exhaustive. */
  structuresSkipped?: number
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

/** A detection that found nothing — the safe "scan ran, all clear" value. */
export const EMPTY_SOLAR_DETECTION: SolarDetection = {
  has_solar: false,
  array_count: 0,
  panel_count_estimate: null,
  approx_area_m2: null,
  has_skylight: false,
  skylight_count: 0,
  confidence: 'high',
  notes: '',
  summary_note: 'No existing solar panels or skylights detected.',
  source: 'none',
}

/** PURE — the AERIAL vision prompt: detect existing PV AND skylights on the
 *  centre building of a top-down satellite aerial. */
export function buildSolarDetectPrompt(): string {
  return (
    'You are analysing a top-down satellite aerial of an Australian residential property. ' +
    'The building of interest is the one at the CENTRE of the image. Report what is on that ' +
    "central building's roof. Detect TWO things: " +
    '(1) EXISTING solar photovoltaic (PV) panels — dark blue or black rectangular grid arrays ' +
    'sitting flat on the roof; and (2) SKYLIGHTS — small bright/translucent or domed roof ' +
    'windows set into the roof plane. Ignore vents, shadows and the neighbouring houses. ' +
    'Respond ONLY with strict JSON, no prose, no code fences: ' +
    '{"has_solar": boolean, "array_count": number, "panel_count_estimate": number|null, ' +
    '"approx_area_m2": number|null, "has_skylight": boolean, "skylight_count": number, ' +
    '"confidence": "high"|"medium"|"low", "notes": string}'
  )
}

/** PURE — the PHOTO vision prompt: same detection from a close-up customer
 *  or tradie photo of the roof (one or more images). Claude/Anthropic. */
export function buildPhotoSolarDetectPrompt(): string {
  return (
    'You are a strict assistant for an Australian roofing-quote tool. The attached image(s) ' +
    'are close-up photos of a roof that is being quoted for a re-roof. Determine what existing ' +
    'roof-mounted equipment is present. Detect TWO things: ' +
    '(1) EXISTING solar photovoltaic (PV) panels — framed dark rectangular panels mounted on ' +
    'rails; and (2) SKYLIGHTS — glazed or domed roof windows set into the roof. ' +
    'Count distinct solar ARRAYS (a contiguous block of panels = one array) and distinct ' +
    'skylights. If you cannot tell, set the boolean false and confidence low. ' +
    'Respond ONLY with strict JSON, no prose, no code fences: ' +
    '{"has_solar": boolean, "array_count": number, "panel_count_estimate": number|null, ' +
    '"approx_area_m2": number|null, "has_skylight": boolean, "skylight_count": number, ' +
    '"confidence": "high"|"medium"|"low", "notes": string}'
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
    has_skylight: { type: 'BOOLEAN' },
    skylight_count: { type: 'INTEGER' },
    confidence: { type: 'STRING', enum: ['high', 'medium', 'low'] },
    notes: { type: 'STRING' },
  },
  required: ['has_solar', 'array_count', 'confidence', 'notes'],
}

/** PURE — build the confidence-aware, human-readable line the tradie and
 *  customer see. Hedges the wording on low confidence ("what appears to
 *  be…") and always flags low-confidence reads for on-site verification. */
export function buildSolarSummaryNote(d: {
  has_solar: boolean
  array_count: number
  has_skylight: boolean
  skylight_count: number
  confidence: SolarConfidence
}): string {
  const low = d.confidence === 'low'
  const lead = low ? 'What appears to be' : 'Identified'
  const conf = `(${d.confidence} confidence${low ? ' — verify on site' : ''})`
  const parts: string[] = []
  if (d.has_solar) {
    const n = Math.max(1, d.array_count || 1)
    parts.push(`${n} solar panel array${n === 1 ? '' : 's'}`)
  }
  if (d.has_skylight) {
    const n = Math.max(1, d.skylight_count || 1)
    parts.push(`${n} skylight${n === 1 ? '' : 's'}`)
  }
  if (parts.length === 0) return 'No existing solar panels or skylights detected.'
  return `${lead} ${joinAnd(parts)} ${conf}`
}

/** PURE — parse a vision model's JSON text into a SolarDetection. Returns
 *  null when the text isn't usable. Defensive: tolerates code fences and
 *  coerces the numeric/enum fields. `source` tags where it came from. */
export function parseSolarDetection(
  text: string,
  source: SolarDetectionSource = 'aerial',
): SolarDetection | null {
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
  const hasSkylight = o.has_skylight === true
  const skylightCount = num(o.skylight_count)
  const detection: SolarDetection = {
    has_solar: o.has_solar,
    array_count: arrayCount != null && arrayCount > 0 ? Math.round(arrayCount) : o.has_solar ? 1 : 0,
    panel_count_estimate: num(o.panel_count_estimate),
    approx_area_m2: num(o.approx_area_m2),
    has_skylight: hasSkylight,
    skylight_count:
      skylightCount != null && skylightCount > 0 ? Math.round(skylightCount) : hasSkylight ? 1 : 0,
    confidence: conf,
    notes: typeof o.notes === 'string' ? o.notes.slice(0, 500) : '',
    summary_note: '',
    source,
  }
  detection.summary_note = buildSolarSummaryNote(detection)
  return detection
}

/** PURE — merge an AERIAL detection with a PHOTO detection into one result.
 *  Booleans are OR-ed; counts come from the higher-confidence source; a
 *  disagreement on whether solar is present hedges confidence down to low
 *  so it never auto-prices. Either side may be null (source unavailable). */
export function mergeSolarDetections(
  aerial: SolarDetection | null,
  photo: SolarDetection | null,
): SolarDetection | null {
  if (!aerial && !photo) return null
  if (!aerial) return photo
  if (!photo) return aerial

  const rank = (c: SolarConfidence) => (c === 'high' ? 3 : c === 'medium' ? 2 : 1)
  const primary = rank(photo.confidence) > rank(aerial.confidence) ? photo : aerial

  const hasSolar = aerial.has_solar || photo.has_solar
  const hasSkylight = aerial.has_skylight || photo.has_skylight
  // Counts from the higher-confidence source; if that source didn't see the
  // feature but the other did, fall back to the other's count.
  const arrayFrom = (d: SolarDetection) => (d.has_solar ? Math.max(1, d.array_count) : 0)
  const skyFrom = (d: SolarDetection) => (d.has_skylight ? Math.max(1, d.skylight_count) : 0)
  const arrayCount = hasSolar ? arrayFrom(primary) || arrayFrom(aerial) || arrayFrom(photo) : 0
  const skylightCount = hasSkylight ? skyFrom(primary) || skyFrom(aerial) || skyFrom(photo) : 0

  // Agreement raises trust; a present/absent disagreement drops to low.
  const solarAgrees = aerial.has_solar === photo.has_solar
  const confidence: SolarConfidence = solarAgrees ? primary.confidence : 'low'

  const merged: SolarDetection = {
    has_solar: hasSolar,
    array_count: arrayCount,
    panel_count_estimate: maxNullable(aerial.panel_count_estimate, photo.panel_count_estimate),
    approx_area_m2: maxNullable(aerial.approx_area_m2, photo.approx_area_m2),
    has_skylight: hasSkylight,
    skylight_count: skylightCount,
    confidence,
    notes: [aerial.notes, photo.notes].filter((n) => n && n.trim()).join(' · ').slice(0, 500),
    summary_note: '',
    source: 'merged',
  }
  merged.summary_note = buildSolarSummaryNote(merged)
  return merged
}

/** PURE — fold per-structure detections into one job-level detection.
 *  Arrays and skylights are SUMMED across every structure that has them
 *  (so a house + a shed each with panels prices both), has_* is OR-ed, and
 *  the job confidence takes the LOWEST among structures that found solar
 *  (conservative — a single shaky structure won't auto-price the job).
 *  Returns null when the list is empty / all null. */
export function aggregateSolarDetections(
  detections: Array<SolarDetection | null>,
): SolarDetection | null {
  const present = detections.filter((d): d is SolarDetection => d != null)
  if (present.length === 0) return null

  const rank = (c: SolarConfidence) => (c === 'high' ? 3 : c === 'medium' ? 2 : 1)
  let hasSolar = false
  let hasSkylight = false
  let arrays = 0
  let skylights = 0
  let panels: number | null = null
  let area: number | null = null
  let solarConf: SolarConfidence | null = null
  const noteParts: string[] = []

  for (const d of present) {
    if (d.has_solar) {
      hasSolar = true
      arrays += Math.max(1, d.array_count || 1)
      panels = maxNullable(panels, d.panel_count_estimate)
      area = maxNullable(area, d.approx_area_m2)
      solarConf = solarConf == null || rank(d.confidence) < rank(solarConf) ? d.confidence : solarConf
    }
    if (d.has_skylight) {
      hasSkylight = true
      skylights += Math.max(1, d.skylight_count || 1)
    }
    if (d.notes && d.notes.trim()) noteParts.push(d.notes.trim())
  }

  const confidence: SolarConfidence = hasSolar ? (solarConf ?? 'low') : 'high'
  const aggregate: SolarDetection = {
    has_solar: hasSolar,
    array_count: hasSolar ? arrays : 0,
    panel_count_estimate: panels,
    approx_area_m2: area,
    has_skylight: hasSkylight,
    skylight_count: hasSkylight ? skylights : 0,
    confidence,
    notes: noteParts.join(' · ').slice(0, 500),
    summary_note: '',
    source: 'merged',
  }
  aggregate.summary_note = buildSolarSummaryNote(aggregate)
  return aggregate
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
 * with applies=false (flagged, price unchanged). Skylights never factor
 * into the allowance — they are surfaced only.
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

// ── Tiny pure helpers ────────────────────────────────────────────────

function round2(n: number): number {
  if (!Number.isFinite(n)) return 0
  return Math.round(n * 100) / 100
}

/** Larger of two nullable numbers; null only when both are null. */
function maxNullable(a: number | null, b: number | null): number | null {
  if (a == null) return b
  if (b == null) return a
  return Math.max(a, b)
}

/** "a", "a and b", "a, b and c". */
function joinAnd(parts: string[]): string {
  if (parts.length <= 1) return parts.join('')
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
}

// ── I/O — the PHOTO (Anthropic) vision caller ────────────────────────
// Thin, best-effort. NEVER throws on operational failure — returns null so
// the merge falls back to the aerial result and the save flow never blocks.
// Mirrors lib/roofing/vision-verify.ts.

const PHOTO_VISION_MODEL = process.env.ROOFING_VISION_MODEL ?? 'claude-sonnet-4-6'

export type RoofPhoto = { base64: string; mime: string }

/**
 * Best-effort Claude vision detection of solar + skylights from one or
 * more close-up roof photos. Returns a SolarDetection tagged source:'photo',
 * or null when the key is missing / no photos / the call or parse fails.
 */
export async function detectSolarFromPhotos(
  photos: RoofPhoto[],
  opts: { model?: string } = {},
): Promise<SolarDetection | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null
  if (!Array.isArray(photos) || photos.length === 0) return null
  try {
    const { anthropic } = await import('@ai-sdk/anthropic')
    const { generateText } = await import('ai')

    const content: Array<
      | { type: 'text'; text: string }
      | { type: 'image'; image: string; mediaType: string }
    > = [{ type: 'text', text: buildPhotoSolarDetectPrompt() }]
    // Cap the number of images sent to keep the call bounded.
    for (const p of photos.slice(0, 6)) {
      content.push({ type: 'image', image: p.base64, mediaType: p.mime })
    }

    const { text } = await generateText({
      model: anthropic(opts.model ?? PHOTO_VISION_MODEL),
      temperature: 0,
      messages: [{ role: 'user' as const, content }],
    })
    return parseSolarDetection(text, 'photo')
  } catch {
    return null
  }
}

export const __test_only__ = { ELECTRICIAN_NOTE, round2, maxNullable, joinAnd }
