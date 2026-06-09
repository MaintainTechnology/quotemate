// Electrical plan → quantity take-off (the engine behind the Estimator-Beta tab).
//
// Pure core + thin IO, mirroring lib/estimate + lib/signage:
//   • buildExtractionPrompt(sheetHint) — pure prompt builder
//   • parseExtraction(text)            — pure: model text → normalised items
//   • runExtraction({ pdf, sheetHint }) — thin: one Claude call with the PDF as
//                                         a file part (the proven spike call)
//
// v1 is counts only — no pricing/labour. The model reads each plan's own legend
// and counts symbols; dense graphical fields come back flagged medium/low so the
// tradie's review (the Beta UI) is where those get corrected.

import { anthropic } from '@ai-sdk/anthropic'
import { generateText } from 'ai'

export type Confidence = 'high' | 'medium' | 'low'

/** A single counted item. `type` is the model's own wording for the item
 *  (kept as `type` to stay consistent with the spike output + eval harness). */
export type ExtractionItem = {
  type: string
  symbol: string
  count: number
  confidence: Confidence
  note?: string
}

export type ParsedExtraction = {
  sheets_used: string[]
  legend_symbols: { symbol: string; means: string }[]
  items: ExtractionItem[]
  overall_note: string
}

export const DEFAULT_ESTIMATION_MODEL = 'claude-sonnet-4-6'
const MAX_PDF_BYTES = 32 * 1024 * 1024 // Anthropic PDF ceiling

/** The proven take-off prompt (identical intent to scripts/estimation-spike.mjs):
 *  read the legend first, sweep zone-by-zone, count don't estimate, JSON only. */
export function buildExtractionPrompt(sheetHint: string): string {
  const hint = sheetHint?.trim() || 'POWER & DATA LAYOUT'
  return `You are an electrical estimator doing a quantity take-off from a construction plan set (PDF attached).

TASK: Find the "${hint}" sheet (and the Reflected Ceiling Plan / lighting sheet if present) and COUNT each electrical item type, using the sheet's own LEGEND to identify symbols.

Be systematic: read the legend first, then sweep the drawing zone by zone so you do not miss symbols in dense areas. Count, do not estimate.

Count at least these (use the legend's wording; 0 if absent):
- general power outlets (GPO / power points) — single and double, report total
- data / comms outlets
- dedicated or 15-amp circuits / appliance points
- light fittings (downlights, battens, feature, exit/emergency) from the RCP if visible
- switchboards / distribution boards
- any other electrical item the legend defines (TV points, mech isolators, etc.)

Return STRICT JSON only, no prose:
{
  "sheets_used": ["..."],
  "legend_symbols": [{ "symbol": "<as drawn>", "means": "<from legend>" }],
  "items": [{ "type": "<item>", "symbol": "<symbol>", "count": <int>, "confidence": "high|medium|low", "note": "<optional>" }],
  "overall_note": "<anything that hurt the count: density, illegible zones, multi-sheet, etc.>"
}`
}

/** Coerce one raw model item into a clean ExtractionItem, or null if unusable. */
function normaliseItem(raw: unknown): ExtractionItem | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const type = String(r.type ?? r.item ?? r.name ?? '').trim()
  if (!type) return null
  const countNum = Number(r.count)
  const confidence: Confidence =
    r.confidence === 'high' || r.confidence === 'low' ? r.confidence : 'medium'
  return {
    type,
    symbol: r.symbol != null ? String(r.symbol) : '',
    count: Number.isFinite(countNum) ? Math.max(0, Math.round(countNum)) : 0,
    confidence,
    note: r.note != null && String(r.note).trim() ? String(r.note) : undefined,
  }
}

/** Parse the model's reply (tolerant: grabs the first JSON object, coerces shape).
 *  Returns null only when there's no parseable JSON object at all. */
export function parseExtraction(text: string): ParsedExtraction | null {
  const match = text.match(/\{[\s\S]*\}/)
  if (!match) return null
  let obj: Record<string, unknown>
  try {
    obj = JSON.parse(match[0]) as Record<string, unknown>
  } catch {
    return null
  }
  const items = Array.isArray(obj.items)
    ? obj.items.map(normaliseItem).filter((x): x is ExtractionItem => x !== null)
    : []
  const legend = Array.isArray(obj.legend_symbols)
    ? (obj.legend_symbols as unknown[])
        .filter((s): s is Record<string, unknown> => !!s && typeof s === 'object')
        .map((s) => ({ symbol: String(s.symbol ?? ''), means: String(s.means ?? '') }))
    : []
  return {
    sheets_used: Array.isArray(obj.sheets_used) ? obj.sheets_used.map((s) => String(s)) : [],
    legend_symbols: legend,
    items,
    overall_note: typeof obj.overall_note === 'string' ? obj.overall_note : '',
  }
}

export type ExtractionResult = {
  model: string
  runtimeSeconds: number
  parsed: ParsedExtraction | null
  raw: string
  inputTokens?: number
  outputTokens?: number
}

/** Thin IO: send the whole PDF to Claude as a file part and parse the take-off.
 *  Throws on an oversized PDF or a model/transport error (the caller maps to HTTP). */
export async function runExtraction({
  pdf,
  sheetHint,
  model,
}: {
  pdf: Buffer | Uint8Array
  sheetHint: string
  model?: string
}): Promise<ExtractionResult> {
  if (pdf.length > MAX_PDF_BYTES) {
    throw new Error(`PDF too large (${(pdf.length / 1e6).toFixed(1)} MB; max 32 MB)`)
  }
  const m = model ?? process.env.ESTIMATION_MODEL ?? DEFAULT_ESTIMATION_MODEL
  const t0 = Date.now()
  const { text, usage } = await generateText({
    model: anthropic(m),
    temperature: 0,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: buildExtractionPrompt(sheetHint) },
          { type: 'file', data: pdf, mediaType: 'application/pdf' },
        ],
      },
    ],
  })
  return {
    model: m,
    runtimeSeconds: Math.round(((Date.now() - t0) / 1000) * 10) / 10,
    parsed: parseExtraction(text),
    raw: text,
    inputTokens: usage?.inputTokens,
    outputTokens: usage?.outputTokens,
  }
}
