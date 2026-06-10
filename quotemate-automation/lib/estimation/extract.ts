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

/** Approximate position of one counted symbol on a PDF page.
 *  page is 1-based (the literal page in the PDF file); x/y are percentages
 *  of the page width/height measured from the top-left corner. */
export type ItemLocation = {
  page: number
  x: number
  y: number
}

/** A single counted item. `type` is the model's own wording for the item
 *  (kept as `type` to stay consistent with the spike output + eval harness). */
export type ExtractionItem = {
  type: string
  symbol: string
  count: number
  confidence: Confidence
  note?: string
  /** One entry per counted symbol — powers the plan-overlay pin viewer. */
  locations?: ItemLocation[]
}

export type ParsedExtraction = {
  sheets_used: string[]
  legend_symbols: { symbol: string; means: string }[]
  items: ExtractionItem[]
  overall_note: string
}

export const DEFAULT_ESTIMATION_MODEL = 'claude-opus-4-8'
const MAX_PDF_BYTES = 32 * 1024 * 1024 // Anthropic PDF ceiling

/** Models that reject the `temperature` parameter (Opus 4.7+). Determinism for
 *  those comes from the strict count-don't-estimate prompt, not temperature. */
export function modelAcceptsTemperature(model: string): boolean {
  return !/opus-4-[78]/.test(model)
}

/** The take-off prompt (kept in sync with scripts/estimation-spike.mjs):
 *  read the legend first, latest sheet revision only, one line item per legend
 *  VARIANT (never merged), zone-by-zone tallies in the note for auditability. */
export function buildExtractionPrompt(sheetHint: string): string {
  const hint = sheetHint?.trim() || 'POWER & DATA LAYOUT'
  return `You are an electrical estimator doing a quantity take-off from a construction plan set (PDF attached).

TASK: Find the "${hint}" sheet (and the Reflected Ceiling Plan / lighting sheet if present) and COUNT each electrical item type, using the sheet's own LEGEND to identify symbols.

RULES — follow all of them:
1. LATEST REVISION ONLY. Plan sets often contain multiple revisions of the same sheet (e.g. 103A and 103B, or Rev A / Rev B in the title block). Identify every revision present, then count ONLY from the latest revision of each sheet. Record which revision you used in "sheets_used".
2. READ THE LEGEND FIRST. List every symbol the legend defines before counting anything.
3. ONE LINE ITEM PER LEGEND VARIANT — NEVER MERGE. If the legend defines multiple variants of the same fitting (different wattage e.g. 12W vs 9W, different IP rating e.g. IP44 vs IP65, different location e.g. "@ mirrors", different mounting, colour temperature, or product code), report EACH variant as its own item with its own count. A 9W mirror downlight is NOT the same item as a 12W feature downlight.
4. SINGLE vs DOUBLE OUTLETS ARE DIFFERENT ITEMS. Distinguish GPO (single) from DGPO (double) symbols precisely, including suffix variants (AB/UB/SK, USB, waterproof). Report each as its own line.
5. SWEEP ZONE BY ZONE. Walk the drawing systematically (e.g. left wall → top wall → right wall → bottom wall → interior rooms) so dense areas are not skipped. Count, do not estimate.
6. SHOW YOUR WORKING. For every item, the "note" MUST give a zone-by-zone tally of where each symbol was found (e.g. "left wall 2, amenities 1, bottom wall 1 = 4") so a human can verify the count against the drawing.
7. Wattage/size labels printed next to a symbol on the drawing (e.g. "12W", "9W", "IP65") identify which legend variant it is — use them.
8. PIN EVERY SYMBOL. For each item, return "locations": one entry per counted symbol with the literal PDF page number (1-based, counting every page in the file) and the symbol's approximate position as percentages of that page — "x" from the left edge (0-100) and "y" from the top edge (0-100). locations.length must equal count. Approximate positions are fine; they are used to draw review pins on the drawing.

Count at least these (use the legend's wording; 0 if absent):
- general power outlets (GPO / power points) — each single/double/special variant as its own line
- data / comms outlets
- dedicated or 15-amp circuits / appliance points (including text-labelled power e.g. "fountain power")
- light fittings from the RCP — each legend variant separately (downlights by wattage/IP, battens, panels, feature, exit/emergency)
- switchboards / distribution boards
- any other electrical item the legend defines (TV points, mech isolators, speakers, fans, etc.)

Return STRICT JSON only, no prose:
{
  "sheets_used": ["<sheet number + revision used>"],
  "legend_symbols": [{ "symbol": "<as drawn>", "means": "<from legend>" }],
  "items": [{ "type": "<item incl. variant e.g. wattage/IP>", "symbol": "<symbol>", "count": <int>, "confidence": "high|medium|low", "note": "<zone-by-zone tally>", "locations": [{ "page": <int>, "x": <0-100>, "y": <0-100> }] }],
  "overall_note": "<anything that hurt the count: density, illegible zones, multi-sheet, superseded revisions present, etc.>"
}`
}

/** Coerce one raw location into a clean ItemLocation, or null if unusable.
 *  x/y are clamped to 0–100 (% of page); page must be a positive integer. */
function normaliseLocation(raw: unknown): ItemLocation | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const page = Math.round(Number(r.page))
  const x = Number(r.x)
  const y = Number(r.y)
  if (!Number.isFinite(page) || page < 1 || !Number.isFinite(x) || !Number.isFinite(y)) return null
  return {
    page,
    x: Math.min(100, Math.max(0, Math.round(x * 10) / 10)),
    y: Math.min(100, Math.max(0, Math.round(y * 10) / 10)),
  }
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
  const locations = Array.isArray(r.locations)
    ? r.locations.map(normaliseLocation).filter((l): l is ItemLocation => l !== null)
    : []
  return {
    type,
    symbol: r.symbol != null ? String(r.symbol) : '',
    count: Number.isFinite(countNum) ? Math.max(0, Math.round(countNum)) : 0,
    confidence,
    note: r.note != null && String(r.note).trim() ? String(r.note) : undefined,
    ...(locations.length > 0 ? { locations } : {}),
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
    ...(modelAcceptsTemperature(m) ? { temperature: 0 } : {}),
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
