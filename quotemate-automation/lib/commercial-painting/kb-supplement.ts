// ════════════════════════════════════════════════════════════════════
// lib/commercial-painting/kb-supplement.ts
//
// Commercial-paint takeoff SUPPLEMENT via the mt-filestore-kb File Search
// store built from the tradie's own uploaded PDFs. After Opus extracts +
// reconcileTakeoff() merges the takeoff, this layer asks the KB (grounded
// in the source plans/measurements) what the documents say, and folds the
// answer back in under HYBRID rules:
//
//   • Fill a field ONLY when it is missing/empty OR the item's confidence
//     is 'low'. A confident (high/medium) value is NEVER overwritten — a
//     disagreement becomes a flag the tradie sees in the editor.
//   • Append items the documents contain that the takeoff missed.
//
// Same discipline as the rest of the money path: the KB can add detail and
// raise review, never silently rewrite a number a customer is quoted on.
//
// PURE — builders, parser and the merge are I/O-free and unit-tested.
// ════════════════════════════════════════════════════════════════════

import {
  PAINT_SYSTEMS,
  type PaintConfidence,
  type PaintSystem,
  type PaintTakeoffItem,
} from './types'

// ── Findings shapes (the KB's structured answer) ────────────────────

/** A KB-proposed correction to ONE existing takeoff field. */
export type PaintSupplementCorrection = {
  surface: string
  room?: string
  field: 'quantity' | 'unit' | 'system' | 'substrate' | 'coats' | 'height_m'
  value: string | number
  page?: number
  confidence?: PaintConfidence
}

/** A paintable surface the documents describe that the takeoff omitted. */
export type PaintSupplementMissingItem = {
  surface: string
  room: string
  substrate?: string
  system?: PaintSystem
  unit: 'm2' | 'item'
  quantity: number
  page?: number
  confidence?: PaintConfidence
}

export type PaintSupplementFindings = {
  missing_items: PaintSupplementMissingItem[]
  corrections: PaintSupplementCorrection[]
}

/** What the merge did, surfaced to the tradie confirm UI. */
export type PaintSupplementFlag = {
  kind: 'kb_filled' | 'kb_added' | 'kb_conflict'
  surface: string
  room: string
  detail: string
}

export type ApplyPaintSupplementResult = {
  items: PaintTakeoffItem[]
  flags: PaintSupplementFlag[]
}

const CORRECTION_FIELDS = ['quantity', 'unit', 'system', 'substrate', 'coats', 'height_m'] as const
const UNITS = ['m2', 'item'] as const
const CONFIDENCES = ['high', 'medium', 'low'] as const

// ── Query building (PURE) ───────────────────────────────────────────

/** PURE — the grounded File Search query. The /v1/search API takes only a
 *  `query`, so the instruction + the current takeoff are folded into it. */
export function buildPaintSupplementQuery(
  items: readonly PaintTakeoffItem[],
  jobHint?: string,
): string {
  const lines = items.length
    ? items
        .map(
          (it, i) =>
            `  ${i + 1}. surface="${it.surface}" room="${it.room}" unit=${it.unit} quantity=${it.quantity} system=${it.system} confidence=${it.confidence}`,
        )
        .join('\n')
    : '  (none extracted)'
  return [
    'SYSTEM INSTRUCTION:',
    'You are a commercial-painting QUANTITY-SURVEYOR assistant. Answer ONLY from the construction documents indexed in this store (the plans / measurement takeoff just uploaded).',
    'Your job is to VERIFY and COMPLETE an automatically-extracted paint takeoff against those documents. Cite the page for every claim. Do not invent areas the documents do not show.',
    '',
    jobHint ? `JOB CONTEXT: ${jobHint}` : 'JOB CONTEXT: (none provided)',
    '',
    'CURRENT EXTRACTED TAKEOFF:',
    lines,
    '',
    'TASKS:',
    '1. missing_items: paintable surfaces the documents clearly describe that are ABSENT from the takeoff above. Give surface, room, substrate, paint system, unit (m2 or item), quantity, the source page, and your confidence.',
    '2. corrections: for a takeoff line whose surface/room/quantity/unit/system the documents CONTRADICT or where the takeoff is missing a value, give surface, room, the single field to change, the document-supported value, the page, and your confidence.',
    `   Valid system values: ${PAINT_SYSTEMS.join(', ')}. Valid units: m2, item.`,
    '',
    'Respond with STRICT JSON only — no prose, no code fences:',
    '{"missing_items": [{"surface": string, "room": string, "substrate": string, "system": string, "unit": "m2"|"item", "quantity": number, "page": number, "confidence": "high"|"medium"|"low"}], "corrections": [{"surface": string, "room": string, "field": "quantity"|"unit"|"system"|"substrate"|"coats"|"height_m", "value": string|number, "page": number, "confidence": "high"|"medium"|"low"}]}',
  ].join('\n')
}

// ── Parsing (PURE) ──────────────────────────────────────────────────

function asConfidence(v: unknown): PaintConfidence | undefined {
  return typeof v === 'string' && (CONFIDENCES as readonly string[]).includes(v)
    ? (v as PaintConfidence)
    : undefined
}
function asSystem(v: unknown): PaintSystem | undefined {
  return typeof v === 'string' && (PAINT_SYSTEMS as readonly string[]).includes(v)
    ? (v as PaintSystem)
    : undefined
}
function asUnit(v: unknown): 'm2' | 'item' | undefined {
  return v === 'm2' || v === 'item' ? v : undefined
}
function asPosNumber(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined
}
function asPage(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.round(v) : undefined
}
function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

/** PURE — parse the KB's JSON answer into validated findings, dropping any
 *  malformed entry. Returns null only when the answer is not parseable JSON
 *  object at all (so the caller can no-op safely). */
export function parsePaintSupplementFindings(answer: string): PaintSupplementFindings | null {
  if (typeof answer !== 'string' || !answer.trim()) return null
  const cleaned = answer
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
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const o = raw as Record<string, unknown>

  const missing_items: PaintSupplementMissingItem[] = (
    Array.isArray(o.missing_items) ? o.missing_items : []
  )
    .map((m): PaintSupplementMissingItem | null => {
      const surface = str((m as any)?.surface)
      const room = str((m as any)?.room)
      const unit = asUnit((m as any)?.unit)
      const quantity = asPosNumber((m as any)?.quantity)
      if (!surface || !unit || quantity === undefined) return null
      const out: PaintSupplementMissingItem = { surface, room, unit, quantity }
      const substrate = str((m as any)?.substrate)
      if (substrate) out.substrate = substrate
      const system = asSystem((m as any)?.system)
      if (system) out.system = system
      const page = asPage((m as any)?.page)
      if (page !== undefined) out.page = page
      const confidence = asConfidence((m as any)?.confidence)
      if (confidence) out.confidence = confidence
      return out
    })
    .filter((x): x is PaintSupplementMissingItem => x !== null)

  const corrections: PaintSupplementCorrection[] = (
    Array.isArray(o.corrections) ? o.corrections : []
  )
    .map((c): PaintSupplementCorrection | null => {
      const surface = str((c as any)?.surface)
      const field = (c as any)?.field
      if (!surface || !(CORRECTION_FIELDS as readonly string[]).includes(field)) return null
      const rawVal = (c as any)?.value
      // Validate value against the field it targets.
      let value: string | number
      if (field === 'quantity' || field === 'coats' || field === 'height_m') {
        const n = typeof rawVal === 'number' ? rawVal : Number(rawVal)
        if (!Number.isFinite(n)) return null
        if ((field === 'quantity' || field === 'coats') && n <= 0) return null
        if (field === 'height_m' && n < 0) return null
        value = n
      } else if (field === 'unit') {
        const u = asUnit(rawVal)
        if (!u) return null
        value = u
      } else if (field === 'system') {
        const s = asSystem(rawVal)
        if (!s) return null
        value = s
      } else {
        // substrate
        const sv = str(rawVal)
        if (!sv) return null
        value = sv
      }
      const out: PaintSupplementCorrection = { surface, field, value }
      const room = str((c as any)?.room)
      if (room) out.room = room
      const page = asPage((c as any)?.page)
      if (page !== undefined) out.page = page
      const confidence = asConfidence((c as any)?.confidence)
      if (confidence) out.confidence = confidence
      return out
    })
    .filter((x): x is PaintSupplementCorrection => x !== null)

  return { missing_items, corrections }
}

// ── Merge (PURE, HYBRID) ────────────────────────────────────────────

function key(surface: string, room: string): string {
  return `${surface.trim().toLowerCase()}|${room.trim().toLowerCase()}`
}

/** The takeoff's most common system — the default for a kb-added line when
 *  the documents didn't state one (never guessed silently: the line is
 *  flagged + low-confidence for the tradie to confirm). */
function modalSystem(items: readonly PaintTakeoffItem[]): PaintSystem {
  const counts = new Map<PaintSystem, number>()
  for (const it of items) counts.set(it.system, (counts.get(it.system) ?? 0) + 1)
  let best: PaintSystem = 'low_sheen'
  let bestN = 0
  for (const [sys, n] of counts) {
    if (n > bestN) {
      best = sys
      bestN = n
    }
  }
  return best
}

function pageSuffix(page?: number): string {
  return page !== undefined ? ` (p.${page})` : ''
}

/** Is the targeted field empty/absent on this item (so it is safe to fill
 *  even on a confident line)? */
function fieldIsEmpty(item: PaintTakeoffItem, field: PaintSupplementCorrection['field']): boolean {
  switch (field) {
    case 'quantity':
      return !(typeof item.quantity === 'number' && item.quantity > 0)
    case 'coats':
      return !(typeof item.coats === 'number' && item.coats > 0)
    case 'height_m':
      return item.height_m == null
    case 'substrate':
      return !String(item.substrate ?? '').trim()
    default:
      // unit + system are always populated on an extracted line.
      return false
  }
}

function currentField(item: PaintTakeoffItem, field: PaintSupplementCorrection['field']): string | number | undefined {
  switch (field) {
    case 'quantity':
      return item.quantity
    case 'coats':
      return item.coats
    case 'height_m':
      return item.height_m
    case 'unit':
      return item.unit
    case 'system':
      return item.system
    case 'substrate':
      return item.substrate
  }
}

/** PURE — apply findings to the takeoff under the hybrid rules. Never
 *  mutates the input; returns a fresh item array + the flags to surface. */
export function applyPaintSupplement(
  items: readonly PaintTakeoffItem[],
  findings: PaintSupplementFindings | null,
): ApplyPaintSupplementResult {
  const out: PaintTakeoffItem[] = items.map((it) => ({ ...it }))
  const flags: PaintSupplementFlag[] = []
  if (!findings) return { items: out, flags }

  const indexByKey = new Map<string, number>()
  out.forEach((it, i) => {
    const k = key(it.surface, it.room)
    if (!indexByKey.has(k)) indexByKey.set(k, i)
  })

  // ── corrections ──────────────────────────────────────────────────
  for (const c of findings.corrections) {
    // Prefer surface+room; fall back to first item whose surface matches.
    let idx = c.room !== undefined ? indexByKey.get(key(c.surface, c.room)) : undefined
    if (idx === undefined) {
      idx = out.findIndex((it) => it.surface.trim().toLowerCase() === c.surface.trim().toLowerCase())
      if (idx < 0) idx = undefined
    }
    if (idx === undefined) continue // never fabricate a line from a correction
    const item = out[idx]
    const empty = fieldIsEmpty(item, c.field)
    const lowConf = item.confidence === 'low'
    const current = currentField(item, c.field)
    const changes = String(current ?? '') !== String(c.value)

    if (empty || lowConf) {
      // Fill — but only when it actually changes something.
      if (changes || empty) {
        ;(item as Record<string, unknown>)[c.field] = c.value
        item.note = `${item.note ? item.note + '; ' : ''}kb-filled ${c.field}${pageSuffix(c.page)}`
        flags.push({
          kind: 'kb_filled',
          surface: item.surface,
          room: item.room,
          detail: `${c.field} set to ${c.value}${pageSuffix(c.page)}`,
        })
      }
    } else if (changes) {
      // Confident value the documents disagree with — flag, do NOT overwrite.
      flags.push({
        kind: 'kb_conflict',
        surface: item.surface,
        room: item.room,
        detail: `${c.field}: takeoff ${current} · documents ${c.value}${pageSuffix(c.page)}`,
      })
    }
  }

  // ── missing items ────────────────────────────────────────────────
  const defaultSystem = modalSystem(out)
  for (const m of findings.missing_items) {
    const k = key(m.surface, m.room)
    if (indexByKey.has(k)) continue // already present — not missing
    const added: PaintTakeoffItem = {
      surface: m.surface,
      room: m.room,
      substrate: (m.substrate ?? '').trim() || 'unknown',
      system: m.system ?? defaultSystem,
      unit: m.unit,
      quantity: m.quantity,
      coats: 2,
      confidence: m.confidence ?? 'low',
      source: 'measurements',
      note: `kb-added${pageSuffix(m.page)}`,
    }
    out.push(added)
    indexByKey.set(k, out.length - 1)
    flags.push({
      kind: 'kb_added',
      surface: m.surface,
      room: m.room,
      detail: `added ${m.quantity}${m.unit === 'm2' ? ' m²' : ' item'} ${m.surface}${pageSuffix(m.page)}`,
    })
  }

  return { items: out, flags }
}
