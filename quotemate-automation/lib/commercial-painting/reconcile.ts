// ════════════════════════════════════════════════════════════════════
// Commercial painting — PURE takeoff reconciliation (spec §4.4).
//
// reconcileTakeoff(aiItems, measurementLines) merges the AI plan-derived
// takeoff with the painter's measurements document:
//
//   • Matched lines      → source 'both'; quantity = the painter's
//     measured figure (it is a measured number), delta_pct records how
//     far the plan-derived figure sat from it, and the note carries
//     both values. Deltas > 10% drop confidence to 'medium' and raise
//     a UI flag — the tradie resolves them in the editor.
//   • Measurements-only  → source 'measurements', confidence high
//     (the painter measured it; the AI missed it) + flag.
//   • Plan-only          → source 'plan', kept as-is + flag so the
//     tradie checks whether the painter genuinely excluded it.
//
// NOTHING is silently dropped or silently preferred — every divergence
// surfaces as a ReconcileFlag. PURE: no I/O, fully unit-tested.
// ════════════════════════════════════════════════════════════════════

import type {
  MeasurementLine,
  PaintTakeoffItem,
  ReconcileFlag,
  ReconcileResult,
} from './types'

/** Deltas above this (absolute %) are flagged for review. */
export const DELTA_FLAG_PCT = 10

/** Minimum text-similarity score for a match to count. */
const MIN_MATCH_SCORE = 0.34

/** Common construction-doc abbreviations, expanded before tokenising. */
const EXPANSIONS: Array<[RegExp, string]> = [
  [/\bboh\b/g, 'back of house boh'],
  [/\bfoh\b/g, 'front of house foh'],
  [/\brcp\b/g, 'reflected ceiling'],
  [/\bw\.?c\.?\b/g, 'toilet wc'],
  [/\bsusp\.?\b/g, 'suspension'],
  [/\bceil\.?\b/g, 'ceiling'],
]

const STOP_WORDS = new Set(['the', 'and', 'to', 'of', 'in', 'a', 'an', 'with', 'for'])

function tokens(text: string): Set<string> {
  let t = text.toLowerCase()
  for (const [re, exp] of EXPANSIONS) t = t.replace(re, exp)
  return new Set(
    t
      .replace(/[^a-z0-9.\s]/g, ' ')
      .split(/\s+/)
      .map((w) => w.replace(/s$/, '')) // crude singulariser: walls→wall
      .filter((w) => w.length > 1 && !STOP_WORDS.has(w)),
  )
}

/** Jaccard-style overlap of surface+room token sets, 0..1. */
function textScore(a: { surface: string; room: string }, b: { surface: string; room: string }): number {
  const ta = tokens(`${a.room} ${a.surface}`)
  const tb = tokens(`${b.room} ${b.surface}`)
  if (ta.size === 0 || tb.size === 0) return 0
  let shared = 0
  for (const w of ta) if (tb.has(w)) shared++
  return shared / Math.max(ta.size, tb.size)
}

/** Area proximity bonus, 0..0.3 (same unit required). */
function areaScore(a: PaintTakeoffItem, b: MeasurementLine): number {
  if (a.unit !== b.unit) return 0
  if (a.quantity <= 0 || b.quantity <= 0) return 0
  const ratio = Math.min(a.quantity, b.quantity) / Math.max(a.quantity, b.quantity)
  return ratio * 0.3
}

function signedDeltaPct(planQty: number, measuredQty: number): number {
  if (measuredQty <= 0) return 0
  return Math.round(((planQty - measuredQty) / measuredQty) * 1000) / 10
}

/**
 * PURE — reconcile the AI plan takeoff against the painter's
 * measurements document. With no measurement lines, AI items pass
 * through untouched (source stays 'plan') and no flags are raised.
 */
export function reconcileTakeoff(
  aiItems: PaintTakeoffItem[],
  measurementLines: MeasurementLine[],
): ReconcileResult {
  if (measurementLines.length === 0) {
    return { items: aiItems.map((i) => ({ ...i })), flags: [] }
  }

  const flags: ReconcileFlag[] = []
  const items: PaintTakeoffItem[] = []
  const usedAi = new Set<number>()

  // Greedy best-match per measurement line: highest combined score wins.
  type Match = { aiIdx: number; score: number }
  const matchFor = (m: MeasurementLine): Match | null => {
    let best: Match | null = null
    aiItems.forEach((ai, idx) => {
      if (usedAi.has(idx)) return
      const ts = textScore(ai, m)
      if (ts < MIN_MATCH_SCORE) return
      const score = ts + areaScore(ai, m)
      if (!best || score > best.score) best = { aiIdx: idx, score }
    })
    return best
  }

  // Process measurement lines in document order (stable, auditable).
  for (const m of measurementLines) {
    const match = matchFor(m)
    if (match) {
      usedAi.add(match.aiIdx)
      const ai = aiItems[match.aiIdx]
      const delta = signedDeltaPct(ai.quantity, m.quantity)
      const flagged = Math.abs(delta) > DELTA_FLAG_PCT
      items.push({
        ...ai,
        // The painter MEASURED this figure — it prefils the editor; the
        // plan-derived figure is preserved in delta_pct + note, so
        // nothing is hidden from the tradie.
        quantity: m.quantity,
        unit: m.unit,
        // A paint-system note on the measurements doc wins (it is the
        // painter's specified system), recorded in the note when it
        // changes the AI's call.
        system: m.system ?? ai.system,
        source: 'both',
        delta_pct: delta,
        confidence: flagged ? 'medium' : 'high',
        note: [
          ai.note,
          m.line_no != null ? `measurements line ${m.line_no}` : 'matched to measurements doc',
          delta !== 0 ? `plan read ${ai.quantity}${ai.unit === 'm2' ? ' m²' : ''} vs measured ${m.quantity}${m.unit === 'm2' ? ' m²' : ''}` : null,
          m.system && m.system !== ai.system ? `system per measurements: ${m.system}` : null,
        ]
          .filter(Boolean)
          .join(' · '),
      })
      if (flagged) {
        flags.push({
          kind: 'delta',
          surface: m.surface,
          room: m.room,
          detail: `Plan-derived ${ai.quantity}${ai.unit === 'm2' ? ' m²' : ''} differs from measured ${m.quantity}${m.unit === 'm2' ? ' m²' : ''} by ${delta > 0 ? '+' : ''}${delta}%`,
        })
      }
    } else {
      // Measurements-only: the painter measured something the AI missed.
      items.push({
        surface: m.surface,
        room: m.room,
        substrate: 'unknown',
        system: m.system ?? 'low_sheen',
        unit: m.unit,
        quantity: m.quantity,
        coats: 2,
        confidence: 'high',
        source: 'measurements',
        note: m.line_no != null ? `measurements line ${m.line_no} — not found on plans` : 'from measurements doc — not found on plans',
      })
      flags.push({
        kind: 'measurements_only',
        surface: m.surface,
        room: m.room,
        detail: `In the measurements doc (${m.quantity}${m.unit === 'm2' ? ' m²' : ' item(s)'}) but not in the AI plan takeoff`,
      })
    }
  }

  // Plan-only leftovers: kept, flagged for the tradie to confirm.
  aiItems.forEach((ai, idx) => {
    if (usedAi.has(idx)) return
    items.push({ ...ai, source: 'plan' })
    flags.push({
      kind: 'plan_only',
      surface: ai.surface,
      room: ai.room,
      detail: `On the plans (${ai.quantity}${ai.unit === 'm2' ? ' m²' : ' item(s)'}) but not in the painter's measurements — confirm whether it was deliberately excluded`,
    })
  })

  return { items, flags }
}

export const __test_only__ = { tokens, textScore, areaScore, signedDeltaPct }
