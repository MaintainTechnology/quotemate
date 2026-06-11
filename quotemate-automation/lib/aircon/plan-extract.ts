// ════════════════════════════════════════════════════════════════════
// Air-conditioning — floor plan → structured rooms (vision extraction).
//
// Pure core + thin IO, mirroring lib/estimation/extract.ts:
//   • buildPlanExtractionPrompt()      — pure prompt builder
//   • parsePlanExtraction(text)        — pure: model text → normalised rooms
//   • runPlanExtraction({ file, … })   — thin: one Claude call (PDF or image)
//
// The extraction is the UNDERSTANDING step only. Areas are finalised in
// plan-scale.ts and all money stays in the deterministic rate-card path
// (recommend.ts) — the model never prices anything here.
// ════════════════════════════════════════════════════════════════════

import { anthropic } from '@ai-sdk/anthropic'
import { generateText } from 'ai'
import type {
  AcConfidence,
  AcExtractedRoom,
  AcPlanExtraction,
  AcPlanPoint,
  ExtractedRoomType,
  RoomType,
} from './types'

export const DEFAULT_PLAN_MODEL = 'claude-opus-4-8'
const MAX_PLAN_BYTES = 32 * 1024 * 1024 // Anthropic file-part ceiling

export const PLAN_MEDIA_TYPES = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
] as const
export type PlanMediaType = (typeof PLAN_MEDIA_TYPES)[number]

/** Models that reject `temperature` (Opus 4.7+) — same guard as estimation. */
export function modelAcceptsTemperature(model: string): boolean {
  return !/opus-4-[78]/.test(model)
}

const ROOM_TYPES: ExtractedRoomType[] = [
  'bedroom',
  'living',
  'kitchen',
  'study',
  'bathroom',
  'laundry',
  'garage',
  'hall',
  'other',
]

/** Conditioned plan-room kinds → the sizing engine's load type.
 *  Kitchens are treated as living (open-plan AU stock); studies size like
 *  bedrooms. Wet areas, garages and circulation are not conditioned. */
export const LOAD_TYPE_BY_ROOM: Partial<Record<ExtractedRoomType, RoomType>> = {
  bedroom: 'bedroom',
  study: 'bedroom',
  living: 'living',
  kitchen: 'living',
}

export function buildPlanExtractionPrompt(): string {
  return `You are an HVAC estimator reading a residential floor plan (file attached).

TASK: Find the floor-plan sheet (the room layout — not elevations, site plans or sections) and return EVERY room as structured data so an air-conditioning system can be sized and laid out.

RULES — follow all of them:
1. ONE FLOOR-PLAN PAGE. If the file has several pages, pick the clearest dimensioned floor-plan page and report its literal 1-based page number in "page". If two storeys are drawn on one page, treat each labelled room separately.
2. EVERY ROOM, ONCE. Walk the plan systematically (top-left → bottom-right) and list every labelled space: bedrooms, living/family/lounge/media/rumpus, kitchen/dining, study/office, bathrooms/ensuites/WC, laundry, garage, hallways. Do not merge or skip rooms.
3. OUTLINE EACH ROOM. For each room return "polygon": 3–12 vertices tracing the room's internal outline, each vertex as percentages of the page — "x" from the left edge (0-100) and "y" from the top edge (0-100). A simple rectangle (4 corners) is fine. Approximate is fine; the polygon drives an indicative overlay, not construction.
4. READ THE DIMENSIONS. If a dimension string is printed in or beside the room (e.g. "3.6 x 4.2", "3600 × 4200"), copy it verbatim into "dimensions_text" and convert it to square metres in "area_m2" (millimetre figures ÷ 1000 first). If no dimensions are printed, leave both out — do NOT guess areas.
5. CLASSIFY each room as one of: ${ROOM_TYPES.join(' | ')}. Dining/meals/family/lounge/media/rumpus count as "living"; ensuite/WC as "bathroom"; entry/passage/stairs as "hall".
6. STATED TOTAL. If the plan states a total internal/living area (e.g. "LIVING: 184.2 m²"), return it in "stated_total_area_m2", else null.
7. CONFIDENCE per room: "high" when the label and dimensions are clearly legible, "medium" when the label is clear but dimensions are missing/unclear, "low" when you inferred the room kind.

Return STRICT JSON only, no prose:
{
  "page": <int>,
  "rooms": [{
    "name": "<label as printed, e.g. BED 2>",
    "room_type": "<one of the types above>",
    "polygon": [{ "x": <0-100>, "y": <0-100> }, ...],
    "dimensions_text": "<verbatim, omit if none>",
    "area_m2": <number, omit if no printed dimensions>,
    "confidence": "high|medium|low"
  }],
  "stated_total_area_m2": <number or null>,
  "overall_note": "<anything that hurt the read: scan quality, missing dimensions, multiple floors, etc.>"
}`
}

/** Coerce one raw vertex into a clean page-percent point, or null. */
function normalisePoint(raw: unknown): AcPlanPoint | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const x = Number(r.x)
  const y = Number(r.y)
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null
  return {
    x: Math.min(100, Math.max(0, Math.round(x * 10) / 10)),
    y: Math.min(100, Math.max(0, Math.round(y * 10) / 10)),
  }
}

function normaliseRoomType(raw: unknown): ExtractedRoomType {
  const t = String(raw ?? '').trim().toLowerCase()
  return (ROOM_TYPES as string[]).includes(t) ? (t as ExtractedRoomType) : 'other'
}

/** Coerce one raw model room into a clean AcExtractedRoom, or null. */
function normaliseRoom(raw: unknown): AcExtractedRoom | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const name = String(r.name ?? r.label ?? '').trim()
  if (!name) return null
  const polygon = Array.isArray(r.polygon)
    ? r.polygon.map(normalisePoint).filter((p): p is AcPlanPoint => p !== null)
    : []
  if (polygon.length < 3) return null
  const confidence: AcConfidence =
    r.confidence === 'high' || r.confidence === 'low' ? r.confidence : 'medium'
  const areaNum = Number(r.area_m2)
  const area = Number.isFinite(areaNum) && areaNum > 0 && areaNum < 1000 ? areaNum : null
  const dims = r.dimensions_text != null ? String(r.dimensions_text).trim() : ''
  return {
    name,
    room_type: normaliseRoomType(r.room_type),
    polygon,
    ...(dims ? { dimensions_text: dims } : {}),
    area_m2: area,
    confidence,
  }
}

/** Parse the model's reply (tolerant: first JSON object, coerced shape).
 *  Returns null only when there is no parseable JSON object at all. */
export function parsePlanExtraction(text: string): AcPlanExtraction | null {
  const match = text.match(/\{[\s\S]*\}/)
  if (!match) return null
  let obj: Record<string, unknown>
  try {
    obj = JSON.parse(match[0]) as Record<string, unknown>
  } catch {
    return null
  }
  const rooms = Array.isArray(obj.rooms)
    ? obj.rooms.map(normaliseRoom).filter((r): r is AcExtractedRoom => r !== null)
    : []
  const pageNum = Math.round(Number(obj.page))
  const statedNum = Number(obj.stated_total_area_m2)
  return {
    page: Number.isFinite(pageNum) && pageNum >= 1 ? pageNum : 1,
    rooms,
    stated_total_area_m2:
      Number.isFinite(statedNum) && statedNum > 0 && statedNum < 5000 ? statedNum : null,
    overall_note: typeof obj.overall_note === 'string' ? obj.overall_note : '',
  }
}

export type PlanExtractionResult = {
  model: string
  runtimeSeconds: number
  parsed: AcPlanExtraction | null
  raw: string
  inputTokens?: number
  outputTokens?: number
}

/** Thin IO: send the plan (PDF as a file part, image as an image part) to
 *  Claude and parse the room read. Throws on oversized input or transport
 *  errors (the caller maps to HTTP). */
export async function runPlanExtraction({
  data,
  mediaType,
  model,
}: {
  data: Buffer | Uint8Array
  mediaType: PlanMediaType
  model?: string
}): Promise<PlanExtractionResult> {
  if (data.length > MAX_PLAN_BYTES) {
    throw new Error(`Plan too large (${(data.length / 1e6).toFixed(1)} MB; max 32 MB)`)
  }
  const m = model ?? process.env.AC_PLAN_MODEL ?? process.env.ESTIMATION_MODEL ?? DEFAULT_PLAN_MODEL
  const t0 = Date.now()
  const { text, usage } = await generateText({
    model: anthropic(m),
    ...(modelAcceptsTemperature(m) ? { temperature: 0 } : {}),
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: buildPlanExtractionPrompt() },
          mediaType === 'application/pdf'
            ? { type: 'file', data, mediaType }
            : { type: 'image', image: data, mediaType },
        ],
      },
    ],
  })
  return {
    model: m,
    runtimeSeconds: Math.round(((Date.now() - t0) / 1000) * 10) / 10,
    parsed: parsePlanExtraction(text),
    raw: text,
    inputTokens: usage?.inputTokens,
    outputTokens: usage?.outputTokens,
  }
}
