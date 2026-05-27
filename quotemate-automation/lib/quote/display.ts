// Quote display mode — pure helpers (unit-tested in display.test.ts).
//
// Phases:
//   • Phase A (mig 071): tenant preference on pricing_book.quote_display.
//   • Phase B: per-quote override on quotes.display_mode (nullable; falls
//     back to the tenant preference when null).
//   • Phase C: customer-side expand/collapse on /q/[token]; the default
//     open/closed state is derived from the resolved display mode here.
//
// Single source of truth for: (a) the union of valid modes, (b) how the
// per-quote override + tenant preference combine, (c) the labour-hours
// roll-up used by the summary view + the SMS summary template. Everything
// here is pure and DB-free so the customer page renderer, SMS template,
// and dashboard form can all share the same answers.

export type QuoteDisplayMode = 'itemised' | 'summary'

export const QUOTE_DISPLAY_MODES: readonly QuoteDisplayMode[] = [
  'itemised',
  'summary',
] as const

/**
 * Type-guard / sanitiser for unknown inputs (incoming form values, API
 * payloads, DB rows that pre-date the column). Returns `fallback`
 * ('itemised' by default) when the value isn't one of the valid modes.
 */
export function asQuoteDisplayMode(
  v: unknown,
  fallback: QuoteDisplayMode = 'itemised',
): QuoteDisplayMode {
  if (v === 'itemised' || v === 'summary') return v
  return fallback
}

/**
 * Resolve the effective display mode for a single quote, applying the
 * override chain:
 *   1. `perQuoteOverride` — quotes.display_mode (Phase B). Wins when set
 *      to a valid mode. Null/undefined/invalid → fall through.
 *   2. `tenantPreference` — pricing_book.quote_display (Phase A). Used
 *      when there's no per-quote override.
 *   3. `'itemised'` — hard default, matches pre-Phase-A behaviour so a
 *      tenant with no preference (or a corrupt value) always gets the
 *      safe, fully-transparent layout.
 *
 * Pure. Does not read the DB. Caller passes whatever it already loaded.
 */
export function resolveQuoteDisplayMode(args: {
  perQuoteOverride?: string | null | undefined
  tenantPreference?: string | null | undefined
}): QuoteDisplayMode {
  if (args.perQuoteOverride === 'itemised' || args.perQuoteOverride === 'summary') {
    return args.perQuoteOverride
  }
  return asQuoteDisplayMode(args.tenantPreference, 'itemised')
}

/**
 * The line-item shape we need for the summary roll-up. Deliberately a
 * subset of the full line_items[] entry so this module doesn't pull in
 * the entire estimator type graph. Anything with extra fields is fine —
 * we only read these three.
 */
export interface LineItemForRollup {
  source?: string | null
  unit?: string | null
  quantity?: number | string | null
}

/**
 * Total labour hours across the line items, used by the summary view's
 * "X hours of [trade] work" line + the SMS summary template. Sums any
 * line whose `source` is `'labour'` (covers both standalone labour rows
 * and the per-assembly "handling time" lines like Disposal's 0.25 hr).
 *
 * Returns 0 for empty / non-array input — render-safe.
 */
export function sumLabourHours(
  lineItems: LineItemForRollup[] | null | undefined,
): number {
  if (!Array.isArray(lineItems)) return 0
  let total = 0
  for (const li of lineItems) {
    if (!li || li.source !== 'labour') continue
    const qty =
      typeof li.quantity === 'number'
        ? li.quantity
        : parseFloat(String(li.quantity ?? '0'))
    if (Number.isFinite(qty) && qty > 0) total += qty
  }
  // Round to 2 dp so a sum of e.g. 3 + 0.25 doesn't print as 3.2500000001.
  return Math.round(total * 100) / 100
}

/**
 * Number of "material-style" line items (non-labour, non-call-out). Used
 * by the summary template's "X items" wording so the customer still
 * sees a rough scope-size hint even in summary mode.
 */
export function countMaterialItems(
  lineItems: LineItemForRollup[] | null | undefined,
): number {
  if (!Array.isArray(lineItems)) return 0
  let n = 0
  for (const li of lineItems) {
    if (!li) continue
    const src = String(li.source ?? '')
    if (src === 'labour' || src === 'call_out') continue
    n += 1
  }
  return n
}
