// Fork-baseline catalogue-gap display mapper (R38).
//
// POST /api/tenant/bom/fork copies a shared baseline recipe into the tenant's
// editable rows AND returns which forked lines reference a material category
// the tenant has NO active catalogue product for (each such line falls back to
// a generic price until the tradie adds a product in that category). The route
// shape (already shipped) is:
//
//   {
//     ok, forked, lines,
//     has_category_gaps: boolean,
//     category_gaps: Array<{ material_category: string; line: number }>,
//     gap_detection_failed: boolean,
//   }
//
// `line` is the 1-based position of the line in the forked recipe (sort order).
//
// This module turns that response into a per-line lookup the Recipes UI renders
// against each forked line, plus a headline summary. Pure: no fetch/React/DB.
// Unit-tested in fork-gaps.test.ts.

import { normaliseCategory } from '@/lib/estimate/catalogue'

/** One gap entry as returned by the fork route. */
export type CategoryGap = {
  material_category: string
  line: number
}

/** The subset of the fork response this mapper reads. */
export type ForkGapResponse = {
  category_gaps?: CategoryGap[] | null
  has_category_gaps?: boolean | null
  gap_detection_failed?: boolean | null
}

/** Per-line gap display state, keyed two ways so the UI can look up by 1-based
 *  line number (the position the route reports) OR by normalised category
 *  (when it renders rows it loaded itself rather than from the fork echo). */
export type ForkGapDisplay = {
  /** True when the route ran gap detection AND found ≥1 generic-priced line. */
  hasGaps: boolean
  /** True when the catalogue read errored — the UI should say "couldn't check"
   *  rather than "all good", so a tradie isn't falsely reassured. */
  detectionFailed: boolean
  /** 1-based line numbers that have no tenant catalogue product. */
  gapLines: Set<number>
  /** Normalised categories that have no tenant catalogue product. */
  gapCategories: Set<string>
  /** The raw list, sorted by line, for rendering a summary list. */
  gaps: CategoryGap[]
  /** Count of generic-priced lines. */
  count: number
}

/**
 * Map a fork response into the per-line display model.
 *
 * Defensive: a missing/null `category_gaps` is treated as no gaps; a malformed
 * entry (non-numeric line / blank category) is dropped rather than thrown. When
 * `gap_detection_failed` is true we report `detectionFailed` and surface NO gap
 * markers (we genuinely don't know), so the UI can show an explicit
 * "couldn't verify catalogue coverage" note.
 */
export function mapForkGaps(res: ForkGapResponse | null | undefined): ForkGapDisplay {
  const detectionFailed = !!res?.gap_detection_failed
  const raw = Array.isArray(res?.category_gaps) ? res!.category_gaps! : []
  const clean = detectionFailed
    ? []
    : raw.filter(
        (g): g is CategoryGap =>
          !!g &&
          typeof g.material_category === 'string' &&
          g.material_category.trim() !== '' &&
          typeof g.line === 'number' &&
          Number.isFinite(g.line),
      )
  const sorted = [...clean].sort((a, b) => a.line - b.line)
  const gapLines = new Set<number>(sorted.map((g) => g.line))
  const gapCategories = new Set<string>(
    sorted.map((g) => normaliseCategory(g.material_category)).filter((c) => c !== ''),
  )
  return {
    // Trust the route's explicit flag when present; else derive from the list.
    hasGaps: detectionFailed ? false : (res?.has_category_gaps ?? sorted.length > 0),
    detectionFailed,
    gapLines,
    gapCategories,
    gaps: sorted,
    count: sorted.length,
  }
}

/** Does a given 1-based line have a catalogue gap? */
export function lineHasGap(display: ForkGapDisplay, line: number): boolean {
  return display.gapLines.has(line)
}

/** Does a given material category have a catalogue gap (fallback lookup when
 *  the UI doesn't track the 1-based line position)? */
export function categoryHasGap(display: ForkGapDisplay, category: string | null | undefined): boolean {
  const n = normaliseCategory(category)
  return n !== '' && display.gapCategories.has(n)
}

/** Human summary line for the post-fork banner. Returns null when there's
 *  nothing noteworthy to say (no gaps and detection succeeded). */
export function forkGapSummary(display: ForkGapDisplay): string | null {
  if (display.detectionFailed) {
    return "Couldn't check your catalogue for this recipe — some lines may fall back to a generic price."
  }
  if (display.count === 0) return null
  const n = display.count
  return `${n} line${n === 1 ? '' : 's'} in this recipe ${
    n === 1 ? 'has' : 'have'
  } no matching product in your catalogue and will use a generic price until you add one.`
}
