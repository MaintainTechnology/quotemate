// ════════════════════════════════════════════════════════════════════
// Roofing — persisted structure selection (migration 140).
//
// `included_indices` is the AUTHORITATIVE, 1-based set of structures the
// tradie keeps in a roofing job (a column on roofing_measurements). The
// customer quote page AND the quote PDF derive their effective structure
// set from here, so unchecking a structure on the Measurement Results page
// flows straight through to pricing and the document — fixing the old bug
// where the PDF summed ALL detected structures regardless of selection.
//
// NULL / empty selection means "all structures" (back-compat).
//
// PURE — no I/O. Indices are 1-based throughout (matches narrowQuoteToStructures
// and the legacy `?s=` / confirmed_structure conventions).
// ════════════════════════════════════════════════════════════════════

import type { MultiRoofQuote, RoofStructurePrice } from './types'
import { narrowQuoteToStructures } from '@/lib/sms/roofing-compose'

/** [1..count] — every structure index, 1-based. */
export function allStructureIndices(count: number): number[] {
  const n = Math.max(0, Math.floor(count))
  return Array.from({ length: n }, (_, i) => i + 1)
}

/** Keep only valid 1-based indices within [1..count]; unique, ascending. */
export function sanitizeIndices(
  indices: readonly number[] | null | undefined,
  count: number,
): number[] {
  if (!indices) return []
  const max = Math.max(0, Math.floor(count))
  const seen = new Set<number>()
  for (const raw of indices) {
    const n = Number(raw)
    // Only already-integer indices in range — reject floats outright rather
    // than truncating, so a stray 2.5 can never silently select structure 2.
    if (Number.isInteger(n) && n >= 1 && n <= max) seen.add(n)
  }
  return [...seen].sort((a, b) => a - b)
}

/** Structure count off a (possibly null) stored quote. */
export function structureCount(quote: MultiRoofQuote | null | undefined): number {
  return Array.isArray(quote?.structures) ? quote!.structures.length : 0
}

/**
 * The "roof-only" default selection (1-based): just the PRIMARY structure
 * (the main dwelling/roof). A freshly-saved measurement starts here so the
 * tradie opts secondary structures (sheds/garages) IN rather than out. Falls
 * back to the first structure when no explicit primary is present, and [] for
 * an empty quote.
 */
export function primaryStructureIndices(quote: MultiRoofQuote | null | undefined): number[] {
  const structures = Array.isArray(quote?.structures) ? quote!.structures : []
  if (structures.length === 0) return []
  const idx = structures.findIndex((s) => s.role === 'primary')
  return [(idx >= 0 ? idx : 0) + 1]
}

/**
 * The structures to actually price/render, as 1-based indices. Starts from
 * the tradie's persisted selection (all when null/empty) and only ever
 * NARROWS it:
 *   • a `?s=` link intersects (legacy links must not widen past the selection)
 *   • a customer single-pick (`confirmedStructure`) intersects (customer view)
 * An intersection that would empty the set is ignored — we keep the wider set
 * rather than show nothing. Returns a non-empty array whenever count > 0.
 */
export function resolveEffectiveIndices(
  opts: {
    included: readonly number[] | null | undefined
    confirmedStructure?: number | null
    paramIndices?: readonly number[] | null
  },
  count: number,
): number[] {
  const all = allStructureIndices(count)
  let eff = sanitizeIndices(opts.included, count)
  if (eff.length === 0) eff = all
  const param = sanitizeIndices(opts.paramIndices, count)
  if (param.length > 0) {
    const inter = eff.filter((i) => param.includes(i))
    if (inter.length > 0) eff = inter
  }
  if (opts.confirmedStructure != null) {
    const inter = eff.filter((i) => i === opts.confirmedStructure)
    if (inter.length > 0) eff = inter
  }
  return eff
}

/**
 * Denormalised summary for fast list views, derived from the included set.
 * Reuses narrowQuoteToStructures so the combined totals are computed by the
 * one source of truth (never re-derived free-form).
 */
export function denormFromSelection(
  quote: MultiRoofQuote,
  includedIndices: readonly number[] | null,
): { combined_area_m2: number; combined_better_inc_gst: number; structure_count: number } {
  const count = structureCount(quote)
  const eff = sanitizeIndices(includedIndices, count)
  const narrowed = narrowQuoteToStructures(
    quote,
    eff.length > 0 ? eff : allStructureIndices(count),
  )
  return {
    combined_area_m2: narrowed.combined.area_m2,
    combined_better_inc_gst: narrowed.combined.tiers[1]?.inc_gst ?? 0,
    structure_count: narrowed.structures.length,
  }
}

/**
 * THE canonical headline total for a roofing job, given a 1-based included
 * selection. Every surface (customer quote page, PDF, dashboard pre-save
 * preview, the /m measure-results page, the save-as-quote payload) derives
 * its total from here so they can never drift. Delegates to
 * narrowQuoteToStructures so there is exactly ONE summation — the total covers
 * the INCLUDED *quotable* structures only (inspection-routed ones are listed
 * but never priced into the headline). An empty/invalid selection totals zero.
 */
export function combinedTotalsForIndices(
  quote: MultiRoofQuote,
  indices1Based: readonly number[] | null,
): { count: number; area: number; exGst: [number, number, number]; incGst: [number, number, number] } {
  const idx = sanitizeIndices(indices1Based, structureCount(quote))
  if (idx.length === 0) {
    return { count: 0, area: 0, exGst: [0, 0, 0], incGst: [0, 0, 0] }
  }
  const t = narrowQuoteToStructures(quote, idx).combined
  return {
    count: idx.length,
    area: t.area_m2,
    exGst: [t.tiers[0].ex_gst, t.tiers[1].ex_gst, t.tiers[2].ex_gst],
    incGst: [t.tiers[0].inc_gst, t.tiers[1].inc_gst, t.tiers[2].inc_gst],
  }
}

/** How a single structure renders on the quote/PDF, given the selection. */
export type RoofStructureDisplayState = 'priced' | 'inspection' | 'excluded'

/** One detected structure annotated with its display state + 1-based index. */
export type RoofDisplayRow = {
  index1Based: number
  structure: RoofStructurePrice
  state: RoofStructureDisplayState
  included: boolean
}

export type RoofQuotePartition = {
  /** Included + quotable narrow used for the headline/combined total. */
  narrowed: MultiRoofQuote
  /** EVERY detected structure, in order, annotated for display. */
  rows: RoofDisplayRow[]
}

/**
 * Split a full multi-structure quote into (a) the narrowed quote that backs
 * the headline total and (b) display rows for ALL detected structures, each
 * tagged priced / inspection / excluded. The renderers list excluded and
 * inspection structures for transparency without ever adding them to the
 * total. `effectiveIndices1Based` is the resolved selection
 * (resolveEffectiveIndices); an empty selection is treated as "all".
 */
export function partitionRoofQuote(
  fullQuote: MultiRoofQuote,
  effectiveIndices1Based: readonly number[],
): RoofQuotePartition {
  const count = structureCount(fullQuote)
  const eff = sanitizeIndices(effectiveIndices1Based, count)
  const includedSet = new Set(eff)
  const structures = Array.isArray(fullQuote?.structures) ? fullQuote.structures : []
  const rows: RoofDisplayRow[] = structures.map((structure, i) => {
    const index1Based = i + 1
    const included = includedSet.has(index1Based)
    const isInspection = structure.price?.routing?.decision === 'inspection_required'
    const state: RoofStructureDisplayState = !included
      ? 'excluded'
      : isInspection
        ? 'inspection'
        : 'priced'
    return { index1Based, structure, state, included }
  })
  const narrowed = narrowQuoteToStructures(fullQuote, eff.length > 0 ? eff : allStructureIndices(count))
  return { narrowed, rows }
}
