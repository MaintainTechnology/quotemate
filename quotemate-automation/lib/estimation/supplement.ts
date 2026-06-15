// Ephemeral file-store supplementation of the electrical take-off.
//
// After runExtraction() produces a ParsedExtraction from the plan PDF (Claude
// vision counting symbols), this step builds a THROWAWAY file store from that
// same PDF, retrieves textual passages (schedules, legends, quantity tables the
// vision pass may have missed or miscounted), and uses them to CORRECT/FILL the
// extracted counts — then deletes the store. The store is purely temporary.
//
// Pure core + thin orchestration, mirroring lib/estimation/extract.ts:
//   • buildSupplementQueries(parsed)        — pure: extraction → targeted queries
//   • findQuantityInSnippets(needles, snip) — pure: passage text → a quantity
//   • mergeSupplement(parsed, evidence)     — pure: extraction + evidence → enriched
//   • supplementExtraction({...})           — thin: create store → upload → search
//                                             → merge → ALWAYS delete (finally)
//
// Doctrine: never fabricate. A count only changes when snippet evidence gives an
// explicit number. The upstream search `answer` is ignored (it carries a fixed
// signage persona) — only `citations[].snippet` is trusted. On any failure or
// when the service is not configured, the ORIGINAL extraction passes through
// unchanged; this step never throws into the estimate.

import type { ParsedExtraction, ExtractionItem, Confidence } from './extract'
import type { FileStoreClient } from './filestore-client'

/** What a query/evidence pair is trying to resolve. */
export type SupplementTarget =
  | { kind: 'item'; index: number; type: string; symbol: string }
  | { kind: 'legend'; symbol: string; means: string }

export type SupplementQuery = {
  /** Stable correlation key (e.g. "item:3", "legend:▲▲"). */
  key: string
  query: string
  target: SupplementTarget
}

export type SupplementEvidence = {
  target: SupplementTarget
  /** citations[].snippet values only — the `answer` field is deliberately dropped. */
  snippets: string[]
}

export type SupplementChange = {
  kind: 'count_corrected' | 'gap_filled' | 'confidence_raised'
  item_type: string
  before?: number
  after?: number
  detail: string
}

export type SupplementResult = {
  parsed: ParsedExtraction
  changes: SupplementChange[]
  /** True when the file-store path actually ran end-to-end. */
  supplemented: boolean
  /** Human-readable summary, also folded into overall_note by the route. */
  note: string
}

/** Confidence levels worth re-checking against the document text. */
const RECHECK_CONFIDENCE: ReadonlySet<Confidence> = new Set<Confidence>(['low', 'medium'])
const DEFAULT_MAX_QUERIES = 12
const PROVENANCE_TAG = '[file-store]'

// ── Pure: extraction → targeted queries ──────────────────────────────

/**
 * PURE — build a bounded, deterministic set of retrieval queries. Items the
 * vision pass was unsure about (low/medium confidence) are re-checked first,
 * then legend symbols that have no matching counted item (a likely gap). High
 * confidence items are not individually re-queried. Capped at maxQueries so the
 * cost stays bounded regardless of plan size.
 */
export function buildSupplementQueries(
  parsed: ParsedExtraction,
  maxQueries: number = DEFAULT_MAX_QUERIES,
): SupplementQuery[] {
  const queries: SupplementQuery[] = []

  // 1. Re-check uncertain counted items (low before medium).
  const uncertain = parsed.items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => RECHECK_CONFIDENCE.has(item.confidence))
    .sort((a, b) => confidenceRank(a.item.confidence) - confidenceRank(b.item.confidence))

  for (const { item, index } of uncertain) {
    const label = item.type + (item.symbol ? ` (symbol ${item.symbol})` : '')
    queries.push({
      key: `item:${index}`,
      query:
        `In the attached electrical plan and any fixture/quantity schedule it contains, ` +
        `how many ${label} are specified? Reply with the exact quantity and the schedule text.`,
      target: { kind: 'item', index, type: item.type, symbol: item.symbol },
    })
  }

  // 2. Legend symbols with no matching counted item — likely missed entirely.
  const countedTypes = new Set(parsed.items.map((i) => normalise(i.type)))
  const countedSymbols = new Set(parsed.items.map((i) => normalise(i.symbol)).filter(Boolean))
  for (const legend of parsed.legend_symbols) {
    const meansKey = normalise(legend.means)
    const symbolKey = normalise(legend.symbol)
    const alreadyCounted =
      (meansKey && countedTypes.has(meansKey)) || (symbolKey && countedSymbols.has(symbolKey))
    if (alreadyCounted) continue
    queries.push({
      key: `legend:${legend.symbol || legend.means}`,
      query:
        `The plan legend defines "${legend.means || legend.symbol}" ` +
        `(symbol ${legend.symbol || 'n/a'}). How many of these appear on the plan? ` +
        `Reply with the exact quantity and the schedule text.`,
      target: { kind: 'legend', symbol: legend.symbol, means: legend.means },
    })
  }

  return queries.slice(0, Math.max(0, maxQueries))
}

function confidenceRank(c: Confidence): number {
  return c === 'low' ? 0 : c === 'medium' ? 1 : 2
}

// ── Pure: passage text → a quantity ──────────────────────────────────

/**
 * PURE — find an explicit quantity for `needles` (item type/symbol words) in the
 * retrieved snippets, or null when none is clearly stated. Conservative by
 * design: only well-formed "N <thing>", "<thing> x N", "<thing>: N", "<thing>
 * qty N", "<thing> = N", or "<thing> (N)" patterns count, so a number that
 * merely sits near the term does not trigger a change. Returns null on any
 * ambiguity (e.g. conflicting quantities across snippets).
 */
export function findQuantityInSnippets(needles: string[], snippets: string[]): number | null {
  const terms = needles
    .map((n) => normalise(n))
    .filter((n) => n.length >= 2)
  if (terms.length === 0) return null

  const found = new Set<number>()
  for (const snippet of snippets) {
    const hay = ` ${normalise(snippet)} `
    for (const term of terms) {
      const t = escapeRegExp(term)
      // <term> <sep> N   e.g. "double gpo: 42", "gpo x 42", "gpo qty 42", "gpo = 42", "gpo (42)"
      const after = new RegExp(`\\b${t}\\b[^0-9]{0,12}?(?:[:=x×]|qty|quantity|no|off|total)[^0-9]{0,4}?(\\d{1,4})\\b`, 'i')
      // N <term>   e.g. "42 double gpo", "42x gpo"
      const before = new RegExp(`\\b(\\d{1,4})\\s*[x×]?\\s*${t}\\b`, 'i')
      const m = hay.match(after) ?? hay.match(before)
      if (m) {
        const n = Number(m[1])
        if (Number.isFinite(n) && n >= 0) found.add(n)
      }
    }
  }
  if (found.size !== 1) return null // none, or conflicting → no confident answer
  return [...found][0]
}

// ── Pure: extraction + evidence → enriched extraction ────────────────

/**
 * PURE — apply evidence to the extraction. Corrects a counted item when the
 * document text states a different explicit quantity; raises confidence when it
 * corroborates the existing count; adds a new item when a legend-defined symbol
 * that was never counted has an explicit quantity in the text. Records each
 * change with provenance and stamps the affected item's note. Never fabricates:
 * evidence without an explicit quantity leaves the extraction untouched.
 */
export function mergeSupplement(
  parsed: ParsedExtraction,
  evidence: SupplementEvidence[],
): { parsed: ParsedExtraction; changes: SupplementChange[] } {
  const items: ExtractionItem[] = parsed.items.map((i) => ({ ...i }))
  const changes: SupplementChange[] = []

  for (const ev of evidence) {
    if (ev.target.kind === 'item') {
      const item = items[ev.target.index]
      if (!item) continue
      const qty = findQuantityInSnippets([item.type, item.symbol], ev.snippets)
      if (qty === null) continue
      if (qty !== item.count) {
        const before = item.count
        item.count = qty
        item.confidence = 'high'
        item.note = stampNote(item.note, `corrected ${before}→${qty} from plan schedule`)
        changes.push({
          kind: 'count_corrected',
          item_type: item.type,
          before,
          after: qty,
          detail: `${item.type}: count corrected ${before} → ${qty} from the plan's own schedule text.`,
        })
      } else if (item.confidence !== 'high') {
        item.confidence = 'high'
        item.note = stampNote(item.note, `count ${qty} confirmed by plan schedule`)
        changes.push({
          kind: 'confidence_raised',
          item_type: item.type,
          after: qty,
          detail: `${item.type}: count ${qty} confirmed by the plan's schedule text (confidence raised).`,
        })
      }
    } else {
      // legend gap — add a new item only when the text gives an explicit quantity
      const needles = [ev.target.means, ev.target.symbol]
      const qty = findQuantityInSnippets(needles, ev.snippets)
      if (qty === null || qty <= 0) continue
      const type = ev.target.means || ev.target.symbol
      // guard against a race where the legend term now matches an existing item
      const exists = items.some(
        (i) => normalise(i.type) === normalise(type) && i.symbol === ev.target.symbol,
      )
      if (exists) continue
      items.push({
        type,
        symbol: ev.target.symbol,
        count: qty,
        confidence: 'medium',
        note: `${PROVENANCE_TAG} added from plan schedule (not found in the visual count)`,
      })
      changes.push({
        kind: 'gap_filled',
        item_type: type,
        after: qty,
        detail: `${type}: added (${qty}) from the plan's schedule — missed by the visual count.`,
      })
    }
  }

  return { parsed: { ...parsed, items }, changes }
}

function stampNote(note: string | undefined, addition: string): string {
  const tagged = `${PROVENANCE_TAG} ${addition}`
  return note && note.trim() ? `${note} ${tagged}` : tagged
}

// ── Thin orchestration: create → upload → search → merge → delete ────

/**
 * Run the ephemeral supplementation. Creates a temporary file store, uploads the
 * PDF, retrieves evidence, merges it into the extraction, and ALWAYS deletes the
 * store (finally block) — including on error or timeout. Returns the original
 * extraction unchanged when the service is not configured (client null), when
 * there is nothing worth checking, or when any step fails. Never throws.
 */
export async function supplementExtraction(args: {
  parsed: ParsedExtraction
  pdf: Uint8Array
  filename: string
  client: FileStoreClient | null
  storeDisplayName?: string
  maxQueries?: number
}): Promise<SupplementResult> {
  const { parsed, pdf, filename, client } = args
  if (!client) {
    return { parsed, changes: [], supplemented: false, note: 'file-store supplementation skipped (not configured)' }
  }

  const queries = buildSupplementQueries(parsed, args.maxQueries)
  if (queries.length === 0) {
    return { parsed, changes: [], supplemented: false, note: 'file-store supplementation skipped (nothing to verify)' }
  }

  const displayName =
    args.storeDisplayName ?? `estimator-supplement-${Date.now()}-${parsed.items.length}`
  let storeName: string | null = null
  try {
    const store = await client.createStore(displayName)
    storeName = store.name
    await client.uploadPdf(storeName, pdf, filename)

    const evidence: SupplementEvidence[] = []
    for (const q of queries) {
      const res = await client.search(storeName, q.query)
      const snippets = (res.citations ?? [])
        .map((c) => c.snippet)
        .filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
      evidence.push({ target: q.target, snippets })
    }

    const merged = mergeSupplement(parsed, evidence)
    const note =
      merged.changes.length > 0
        ? `file store supplemented ${merged.changes.length} item(s): ` +
          merged.changes.map((c) => c.detail).join(' ')
        : 'file store found no corrections to apply'
    return { parsed: merged.parsed, changes: merged.changes, supplemented: true, note }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown error'
    return { parsed, changes: [], supplemented: false, note: `file-store supplementation failed (${msg}) — used the original extraction` }
  } finally {
    if (storeName) {
      try {
        await client.deleteStore(storeName)
      } catch {
        // Best-effort teardown — the store is named uniquely per run and the
        // upstream service can sweep orphans; never surface a cleanup error.
      }
    }
  }
}

// ── helpers ──────────────────────────────────────────────────────────

function normalise(s: string | undefined): string {
  return String(s ?? '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
