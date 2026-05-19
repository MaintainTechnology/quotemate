// ════════════════════════════════════════════════════════════════════
// WP2 — historical pricing pattern (SAFE slice).
//
// The full WP2 spec line ("import the tradie's past quotes, learn a
// pricing model, validate new pricing against history") is unbounded
// and money-path-risky, and there is no external data source. The safe,
// real, bounded slice — implemented here — is:
//
//   summarise the tenant's OWN already-stored priced quotes for this
//   job type into a per-tier $ band, and surface it to Opus as a SOFT
//   advisory hint ("you've historically quoted Good ~$X for this job").
//
// CRITICAL SAFETY: this is ADVISORY ONLY. It is appended to the user
// prompt exactly like the catalogue / BOM hints; it NEVER feeds the
// grounding validator and is NEVER a hard gate. So it can only nudge —
// it can never over-reject a quote, dump one to inspection, or change
// a price the validator wouldn't already accept. Flag-gated off by
// default (PRICE_HISTORY_HINT) so it is fully inert until enabled.
//
// PURE + DB-free (the DB query lives in run.ts and passes plain numbers
// in, same split as buildBomHint → formatBomHint). Unit-tested.
// ════════════════════════════════════════════════════════════════════

export type Tier = 'good' | 'better' | 'best'

/** One past priced quote: the tier subtotals we already store on
 *  quotes.good/.better/.best (null when that tier wasn't priced /
 *  inspection). */
export interface PastQuoteTiers {
  good?: number | string | null
  better?: number | string | null
  best?: number | string | null
}

export interface TierBand {
  tier: Tier
  count: number
  min: number
  median: number
  max: number
}

export interface PriceHistorySummary {
  jobType: string
  /** Only tiers with enough samples appear here. */
  bands: TierBand[]
}

// Need at least this many historical samples for a tier before we show
// a band — below this it's noise, not a pattern (cold-start safety).
const MIN_SAMPLES = 3

function num(v: number | string | null | undefined): number {
  if (v === null || v === undefined || v === '') return NaN
  return typeof v === 'string' ? parseFloat(v) : v
}

function median(sorted: number[]): number {
  const n = sorted.length
  if (n === 0) return NaN
  const mid = Math.floor(n / 2)
  return n % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

/**
 * Summarise past priced quotes into per-tier $ bands. Returns null when
 * no tier has >= MIN_SAMPLES usable values (→ caller emits no hint).
 */
export function summarisePriceHistory(
  pastQuotes: PastQuoteTiers[],
  jobType: string,
): PriceHistorySummary | null {
  const job = (jobType ?? '').trim()
  if (!job || !Array.isArray(pastQuotes) || pastQuotes.length === 0) return null

  const bands: TierBand[] = []
  for (const tier of ['good', 'better', 'best'] as Tier[]) {
    const vals = pastQuotes
      .map((q) => num(q[tier]))
      .filter((n) => Number.isFinite(n) && n > 0)
      .sort((a, b) => a - b)
    if (vals.length < MIN_SAMPLES) continue
    bands.push({
      tier,
      count: vals.length,
      min: +vals[0].toFixed(2),
      median: +median(vals).toFixed(2),
      max: +vals[vals.length - 1].toFixed(2),
    })
  }
  if (bands.length === 0) return null
  return { jobType: job, bands }
}

/**
 * SOFT advisory string for the Opus user prompt. Mirrors the
 * catalogue/BOM hint tone — explicitly a sanity check, NOT a rule, with
 * the grounding-still-applies caveat so the model never treats it as a
 * price source. Returns null when there's nothing useful to say.
 */
export function formatPriceHistoryHint(
  summary: PriceHistorySummary | null,
): string | null {
  if (!summary || summary.bands.length === 0) return null
  const job = summary.jobType.replace(/_/g, ' ')
  const lines = summary.bands.map(
    (b) =>
      `  • ${b.tier}: typically ~$${b.median.toFixed(0)} ` +
      `(range $${b.min.toFixed(0)}–$${b.max.toFixed(0)}, from ${b.count} past quote${b.count === 1 ? '' : 's'})`,
  )
  return [
    `Your historical pricing for "${job}" jobs (a SANITY CHECK only — ` +
      `not a price source):`,
    ...lines,
    `If this quote lands far outside that range, re-check the scope and ` +
      `line items. Always price each line from the pricing book / ` +
      `catalogue / shared materials — grounding validation still applies.`,
  ].join('\n')
}
