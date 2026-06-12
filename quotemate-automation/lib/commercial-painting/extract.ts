// ════════════════════════════════════════════════════════════════════
// Commercial painting — AI takeoff extraction (spec §4.2).
//
// Two extraction passes, both PDF-native via Anthropic file parts:
//   • runPaintExtraction  — Opus 4.8 over the plan set (+ services
//     layout as masking/access context) → PaintTakeoffItem[] with page
//     provenance, the finishes schedule, and room/height facts.
//   • runMeasurementParse — Sonnet 4.6 over the painter's measurements
//     document → MeasurementLine[] (the reconciliation ground truth).
//
// The prompt builders and parsers are PURE and unit-tested; the run*
// functions are thin IO wrappers mirroring lib/estimation/extract.ts
// (32 MB cap, temperature omitted for Opus 4.7+, tolerant JSON parse —
// the model's prose never reaches the money path).
// ════════════════════════════════════════════════════════════════════

import { anthropic } from '@ai-sdk/anthropic'
import { generateText } from 'ai'
import type {
  MeasurementLine,
  PaintConfidence,
  PaintSystem,
  PaintTakeoffItem,
} from './types'

export const DEFAULT_PAINT_EXTRACTION_MODEL = 'claude-opus-4-8'
export const MEASUREMENT_PARSE_MODEL = 'claude-sonnet-4-6'
const MAX_PDF_BYTES = 32 * 1024 * 1024

/** Opus 4.7+ reject the temperature param (same guard as electrical). */
function modelAcceptsTemperature(model: string): boolean {
  return !/opus-4-[789]/.test(model)
}

// ── Plan-set takeoff prompt (PURE) ────────────────────────────────────

export function buildPaintTakeoffPrompt(opts?: { jobHint?: string }): string {
  const hint = opts?.jobHint?.trim()
  return [
    'You are a commercial painting estimator producing a surface-by-surface takeoff from an architectural drawing set.',
    hint ? `Job context: ${hint}` : null,
    '',
    'RULES:',
    '1. LATEST REVISION ONLY — if the set contains superseded/redline sheets, take quantities from the latest revision and say so in overall_note.',
    '2. READ THE FINISHES SCHEDULE FIRST — it names the paint products, codes and sheen levels per surface. Use it to set each line\'s system.',
    '3. ONE LINE PER SURFACE PER ROOM/ZONE — never merge rooms. Use the plan\'s room names (Retail, BOH, Kitchen, Office, WC/Wet areas, …).',
    '4. AREAS in m²: derive wall areas from plan dimensions × ceiling heights (RCP / sections give heights); ceiling areas from floor areas. Doors/door frames are per-item lines (unit "item").',
    '5. SYSTEMS — map every line to exactly one of: "spray_matt" (exposed/concrete ceilings sprayed matt), "flat" (suspension/set ceilings), "low_sheen" (general walls), "semi_gloss" (wet areas/kitchens + doors/trim).',
    '6. HEIGHTS — record height_m for wall lines and exposed-ceiling lines (drives access equipment). If a services/ductwork layout is supplied, treat exposed-ceiling zones with dense services as the same area but note the masking in the line note.',
    '7. SHOW PROVENANCE — every line\'s note states the sheet/page it came from (e.g. "A-103 floor finishes plan").',
    '8. ONLY PAINTED SURFACES — exclude tiling, glazing, stainless, FRP panels; list what you excluded in overall_note.',
    '9. CONFIDENCE — high when the schedule + plan agree; medium when you inferred (e.g. height assumed); low when the drawing is ambiguous.',
    '10. SEPARATE-PRICE — when a sheet marks something as a separate/optional scope, set separate_price true.',
    '',
    'Respond with STRICT JSON only (no markdown fences, no prose):',
    '{',
    '  "job": { "name": string|null, "address": string|null },',
    '  "finishes_schedule": [ { "code": string, "product": string, "sheen": string, "surfaces": string } ],',
    '  "items": [',
    '    {',
    '      "surface": string,            // "Retail concrete ceiling (thermal panels)"',
    '      "room": string,               // "Retail" | "BOH" | "Kitchen" | …',
    '      "substrate": string,          // "concrete" | "plasterboard" | "suspension tile" | "timber" | …',
    '      "system": "spray_matt"|"flat"|"low_sheen"|"semi_gloss",',
    '      "unit": "m2"|"item",',
    '      "quantity": number,           // m² or count',
    '      "coats": number,              // default 2',
    '      "height_m": number|null,',
    '      "confidence": "high"|"medium"|"low",',
    '      "separate_price": boolean,',
    '      "note": string                // sheet/page provenance',
    '    }',
    '  ],',
    '  "overall_note": string',
    '}',
  ]
    .filter((l) => l !== null)
    .join('\n')
}

// ── Measurements-doc parse prompt (PURE) ─────────────────────────────

export function buildMeasurementParsePrompt(): string {
  return [
    'You are transcribing a painter\'s measurement takeoff document into structured data.',
    'It is a numbered list of surfaces with quantities (mostly m², some per-item lines like doors).',
    'Transcribe EVERY line item faithfully — do not merge, skip, round, or correct anything.',
    'Where the document carries paint-system notes (e.g. "spray ceiling matt", "kitchen semi gloss premium", "low sheen walls"), map them per line: "spray_matt", "flat", "low_sheen", "semi_gloss". Omit system when the line has no note.',
    '',
    'Respond with STRICT JSON only (no markdown fences, no prose):',
    '{',
    '  "lines": [',
    '    { "line_no": number, "surface": string, "room": string, "unit": "m2"|"item", "quantity": number, "system": "spray_matt"|"flat"|"low_sheen"|"semi_gloss"|null, "note": string|null }',
    '  ],',
    '  "overall_note": string',
    '}',
  ].join('\n')
}

// ── Tolerant parsers (PURE) ───────────────────────────────────────────

function firstJsonObject(text: string): unknown | null {
  const start = text.indexOf('{')
  if (start === -1) return null
  // Walk to the matching closing brace (handles trailing prose).
  let depth = 0
  let inString = false
  let escape = false
  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (escape) { escape = false; continue }
    if (ch === '\\') { escape = true; continue }
    if (ch === '"') inString = !inString
    if (inString) continue
    if (ch === '{') depth++
    if (ch === '}') {
      depth--
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1))
        } catch {
          return null
        }
      }
    }
  }
  return null
}

function num(v: unknown): number | null {
  const n = typeof v === 'string' ? Number(v.replace(/[, ]/g, '')) : typeof v === 'number' ? v : NaN
  return Number.isFinite(n) ? n : null
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

/** Coerce a free-text system label onto the 4-system enum. */
export function normaliseSystem(v: unknown): PaintSystem | null {
  const s = str(v).toLowerCase().replace(/[^a-z_ ]/g, '')
  if (!s) return null
  if (s.includes('semi') || s.includes('gloss') || s.includes('enamel')) return 'semi_gloss'
  if (s.includes('low') || s.includes('sheen')) return 'low_sheen'
  if (s.includes('spray') || s.includes('matt') || s.includes('matte')) return 'spray_matt'
  if (s.includes('flat') || s.includes('ceiling')) return 'flat'
  return null
}

function normaliseUnit(v: unknown): 'm2' | 'item' {
  const s = str(v).toLowerCase()
  if (/item|each|ea|no\.?$|unit|count|door/.test(s)) return 'item'
  return 'm2'
}

function normaliseConfidence(v: unknown): PaintConfidence {
  const s = str(v).toLowerCase()
  return s === 'high' || s === 'low' ? s : 'medium'
}

export type ParsedPaintExtraction = {
  job: { name: string | null; address: string | null }
  finishes_schedule: Array<{ code: string; product: string; sheen: string; surfaces: string }>
  items: PaintTakeoffItem[]
  overall_note: string
}

/** PURE — tolerant parse of the plan-takeoff model output. */
export function parsePaintExtraction(text: string): ParsedPaintExtraction | null {
  const obj = firstJsonObject(text) as Record<string, unknown> | null
  if (!obj || typeof obj !== 'object') return null
  const rawItems = Array.isArray(obj.items) ? obj.items : []
  const items: PaintTakeoffItem[] = []
  for (const raw of rawItems) {
    if (!raw || typeof raw !== 'object') continue
    const r = raw as Record<string, unknown>
    const surface = str(r.surface) || str(r.type) || str(r.name)
    const quantity = num(r.quantity) ?? num(r.area_m2) ?? num(r.count)
    const system = normaliseSystem(r.system) ?? normaliseSystem(r.sheen)
    if (!surface || quantity == null || quantity <= 0) continue
    const coats = num(r.coats)
    const height = num(r.height_m)
    items.push({
      surface,
      room: str(r.room) || 'General',
      substrate: str(r.substrate) || 'unknown',
      // A line we cannot map to a system still surfaces — low confidence,
      // defaulting to walls low_sheen; the confirm step exists for this.
      system: system ?? 'low_sheen',
      unit: normaliseUnit(r.unit),
      quantity,
      coats: coats != null && coats >= 1 && coats <= 4 ? Math.round(coats) : 2,
      ...(height != null && height > 0 ? { height_m: Math.round(height * 10) / 10 } : {}),
      confidence: system == null ? 'low' : normaliseConfidence(r.confidence),
      source: 'plan',
      ...(r.separate_price === true ? { separate_price: true } : {}),
      note: str(r.note) || undefined,
    })
  }
  if (items.length === 0) return null
  const job = (obj.job ?? {}) as Record<string, unknown>
  const fin = Array.isArray(obj.finishes_schedule) ? obj.finishes_schedule : []
  return {
    job: { name: str(job.name) || null, address: str(job.address) || null },
    finishes_schedule: fin
      .filter((f) => f && typeof f === 'object')
      .map((f) => {
        const r = f as Record<string, unknown>
        return { code: str(r.code), product: str(r.product), sheen: str(r.sheen), surfaces: str(r.surfaces) }
      }),
    items,
    overall_note: str(obj.overall_note),
  }
}

/** PURE — tolerant parse of the measurements-doc model output. */
export function parseMeasurementLines(text: string): MeasurementLine[] | null {
  const obj = firstJsonObject(text) as Record<string, unknown> | null
  if (!obj || typeof obj !== 'object') return null
  const raw = Array.isArray(obj.lines) ? obj.lines : []
  const lines: MeasurementLine[] = []
  for (const r0 of raw) {
    if (!r0 || typeof r0 !== 'object') continue
    const r = r0 as Record<string, unknown>
    const surface = str(r.surface)
    const quantity = num(r.quantity)
    if (!surface || quantity == null || quantity <= 0) continue
    const lineNo = num(r.line_no)
    const system = normaliseSystem(r.system)
    lines.push({
      ...(lineNo != null && lineNo > 0 ? { line_no: Math.round(lineNo) } : {}),
      surface,
      room: str(r.room) || 'General',
      unit: normaliseUnit(r.unit),
      quantity,
      ...(system ? { system } : {}),
      ...(str(r.note) ? { note: str(r.note) } : {}),
    })
  }
  return lines.length > 0 ? lines : null
}

// ── IO wrappers ───────────────────────────────────────────────────────

export type PaintExtractionResult = {
  model: string
  runtimeSeconds: number
  parsed: ParsedPaintExtraction | null
  raw: string
}

export async function runPaintExtraction(args: {
  planSet: Buffer | Uint8Array
  servicesLayout?: Buffer | Uint8Array | null
  jobHint?: string
  model?: string
}): Promise<PaintExtractionResult> {
  const model = args.model ?? process.env.ESTIMATION_MODEL ?? DEFAULT_PAINT_EXTRACTION_MODEL
  if (args.planSet.byteLength > MAX_PDF_BYTES) {
    throw new Error(`Plan set exceeds ${MAX_PDF_BYTES / (1024 * 1024)} MB`)
  }
  const started = Date.now()
  const content: Array<
    | { type: 'text'; text: string }
    | { type: 'file'; data: Buffer | Uint8Array; mediaType: 'application/pdf' }
  > = [
    { type: 'text', text: buildPaintTakeoffPrompt({ jobHint: args.jobHint }) },
    { type: 'file', data: args.planSet, mediaType: 'application/pdf' },
  ]
  if (args.servicesLayout && args.servicesLayout.byteLength <= MAX_PDF_BYTES) {
    content.push({
      type: 'text',
      text: 'A mechanical services layout follows — use it ONLY for masking/access context on exposed-ceiling lines (rule 6), not as a quantity source.',
    })
    content.push({ type: 'file', data: args.servicesLayout, mediaType: 'application/pdf' })
  }
  const { text } = await generateText({
    model: anthropic(model),
    ...(modelAcceptsTemperature(model) ? { temperature: 0 } : {}),
    maxRetries: 0,
    messages: [{ role: 'user', content }],
  })
  return {
    model,
    runtimeSeconds: Math.round(((Date.now() - started) / 1000) * 100) / 100,
    parsed: parsePaintExtraction(text),
    raw: text,
  }
}

export type MeasurementParseResult = {
  model: string
  runtimeSeconds: number
  lines: MeasurementLine[] | null
  raw: string
}

export async function runMeasurementParse(args: {
  pdf: Buffer | Uint8Array
  model?: string
}): Promise<MeasurementParseResult> {
  const model = args.model ?? MEASUREMENT_PARSE_MODEL
  if (args.pdf.byteLength > MAX_PDF_BYTES) {
    throw new Error(`Measurements document exceeds ${MAX_PDF_BYTES / (1024 * 1024)} MB`)
  }
  const started = Date.now()
  const { text } = await generateText({
    model: anthropic(model),
    ...(modelAcceptsTemperature(model) ? { temperature: 0 } : {}),
    maxRetries: 0,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: buildMeasurementParsePrompt() },
          { type: 'file', data: args.pdf, mediaType: 'application/pdf' },
        ],
      },
    ],
  })
  return {
    model,
    runtimeSeconds: Math.round(((Date.now() - started) / 1000) * 100) / 100,
    lines: parseMeasurementLines(text),
    raw: text,
  }
}
