// Shared types for the Estimator (Beta) surfaces — the dashboard tab, the
// full-view run page (/dashboard/estimator/[runId]) and the components they
// share. Mirrors the /api/tenant/estimator/* contracts.

import type { PinLocation } from '../PlanOverlay'

export type Confidence = 'high' | 'medium' | 'low'

/** A take-off line as the API stores it (items / corrected_items jsonb). */
export type TakeoffItem = {
  type: string
  symbol: string
  count: number
  confidence: Confidence
  note?: string
  locations?: PinLocation[]
}

/** A take-off line as the editor renders it — count stays a string while typing. */
export type EditableRow = {
  /** Stable identity for React keys across add/remove/reorder. */
  uid: number
  type: string
  symbol: string
  count: string
  confidence: Confidence
  note?: string
  locations?: PinLocation[]
  /** True for rows the tradie added by hand — they carry no AI provenance. */
  manual?: boolean
}

export type PriceTrace = {
  countSource: { confidence?: Confidence; tally?: string }
  matchedSignals: string[]
  baseUnitPriceExGst: number
  markupPct: number
  materialFormula: string
  unitLabourHours: number
  hourlyRate: number
  labourFormula: string
}

export type PricedLine = {
  type: string
  count: number
  matched: string
  unitPriceExGst: number
  materialExGst: number
  labourHours: number
  labourExGst: number
  lineExGst: number
  trace: PriceTrace
}

export type PricedBom = {
  lines: PricedLine[]
  unmatched: { type: string; count: number }[]
  materialExGst: number
  labourExGst: number
  labourFloorAddedExGst: number
  subtotalExGst: number
  gstExGst: number
  totalIncGst: number
  gstRegistered: boolean
  assumptions: { hourlyRate: number; markupPct: number; minLabourHours: number }
}

export type ExtractResponse =
  | {
      ok: true
      extractionId: string
      planUploadId: string
      filename: string
      items: TakeoffItem[]
      sheetsUsed: string[]
      overallNote: string
      model: string
      runtimeSeconds: number
    }
  | { ok: false; error: string }

export type PriceResponse =
  | { ok: true; bom: PricedBom; catalogueSize: number; pricingBookSource: string; persisted?: boolean }
  | { ok: false; error: string }

export type RefineResponse =
  | {
      ok: true
      page: number
      model: string
      tiles: number
      runtimeSeconds: number
      items: { type: string; count: number; locations: PinLocation[] }[]
    }
  | { ok: false; error: string }

/** One run as GET /api/tenant/estimator/extract/[id] returns it. */
export type RunDetail = {
  id: string
  plan_upload_id: string
  items: TakeoffItem[] | null
  corrected_items: TakeoffItem[] | null
  sheets_used: string[] | null
  overall_note: string | null
  model: string | null
  runtime_seconds: number | null
  priced_bom: PricedBom | null
  priced_at: string | null
  created_at: string
  updated_at: string
  plan_uploads: { filename: string; sheet_hint: string | null; created_at: string } | null
}

export type HistoryExtraction = {
  id: string
  items: TakeoffItem[] | null
  corrected_items: TakeoffItem[] | null
  sheets_used: string[] | null
  overall_note: string | null
  model: string | null
  runtime_seconds: number | null
  created_at: string
  priced_at: string | null
  priced_total: number | null
}

export type HistoryUpload = {
  id: string
  filename: string
  sheet_hint: string | null
  created_at: string
  plan_extractions: HistoryExtraction[]
}

let nextUid = 1

export function itemsToRows(items: TakeoffItem[]): EditableRow[] {
  return items.map((i) => ({
    uid: nextUid++,
    type: i.type,
    symbol: i.symbol ?? '',
    count: String(i.count ?? 0),
    confidence: i.confidence ?? 'medium',
    note: i.note,
    locations: i.locations,
  }))
}

export function blankRow(): EditableRow {
  return { uid: nextUid++, type: '', symbol: '', count: '1', confidence: 'high', manual: true }
}

export function rowsToItems(rows: EditableRow[]): TakeoffItem[] {
  return rows
    .filter((r) => r.type.trim())
    .map((r) => ({
      type: r.type.trim(),
      symbol: r.symbol,
      count: Number(r.count) || 0,
      confidence: r.confidence,
      note: r.note,
      locations: r.locations,
    }))
}

export const money = (n: number) =>
  '$' + n.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
