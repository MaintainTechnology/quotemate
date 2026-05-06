// RAG context builder for the estimation engine.
//
// Given the new intake (with its 1536-dim embedding already populated on
// the intakes row), looks up the K most cosine-similar past intakes via
// the `match_intakes` SQL function, then fetches the resulting quotes and
// formats a compact "here's how you've quoted similar jobs" block to
// inject into the Opus prompt.
//
// Anchors Opus to the tradie's actual pricing patterns rather than
// re-deriving every quote from scratch. Falls back to NO context (returns
// null) when:
//   - The current intake has no embedding (defensive — shouldn't happen)
//   - match_intakes returns nothing
//   - All matches resolved to inspection-required quotes (no useful prices)
//   - All matches resolved to quotes still in 'draft' state with null tiers
//
// Disabled at runtime when RAG_DISABLED=true. The kill-switch lets us roll
// back without a deploy if quote outputs degrade.

import type { SupabaseClient } from '@supabase/supabase-js'

// Number of similar intakes to ask match_intakes for. We over-fetch by 1
// because the current intake itself is usually the top match (similarity
// = 1.0) and we filter it out before formatting.
const MATCH_FETCH_COUNT = 6

// Bottom threshold below which a match is too weak to anchor pricing on.
// Cosine similarity 0.0 = orthogonal, 1.0 = identical. 0.55 is roughly
// "same job_type with similar scope phrasing" — empirically tight enough
// that we don't anchor to dissimilar past jobs.
const MIN_SIMILARITY = 0.55

type MatchedIntake = {
  id: string
  scope: any
  similarity: number
}

type QuoteForRag = {
  id: string
  intake_id: string | null
  scope_of_works: string | null
  needs_inspection: boolean | null
  good: any
  better: any
  best: any
  selected_tier: 'good' | 'better' | 'best' | null
}

type IntakeForRag = {
  id?: string
  embedding?: number[] | string | null
  job_type?: string
}

/**
 * Returns a formatted context block to prepend to the Opus user message,
 * or null when no usable similar quotes exist (cold start, all inspection,
 * or RAG explicitly disabled).
 */
export async function fetchSimilarPastQuotesContext(
  supabase: SupabaseClient,
  intake: IntakeForRag,
): Promise<{ context: string; matchCount: number } | null> {
  if (process.env.RAG_DISABLED === 'true') return null
  if (!intake.embedding) return null

  // pgvector returns as either a string ("[0.1, 0.2, ...]") or an array
  // depending on the Supabase client version. Normalise to an array of
  // numbers before passing to RPC — the function expects vector(1536).
  const queryEmbedding = normaliseEmbedding(intake.embedding)
  if (!queryEmbedding) return null

  const { data: matches, error: matchErr } = await supabase.rpc('match_intakes', {
    query_embedding: queryEmbedding,
    match_count: MATCH_FETCH_COUNT,
  })

  if (matchErr || !Array.isArray(matches) || matches.length === 0) {
    return null
  }

  // Drop the current intake (it's its own top match by definition) plus
  // anything below the similarity floor.
  const usable = (matches as MatchedIntake[])
    .filter((m) => m.id !== intake.id)
    .filter((m) => Number.isFinite(m.similarity) && m.similarity >= MIN_SIMILARITY)

  if (usable.length === 0) return null

  // Hydrate matched intakes with their winning quote. We don't include
  // inspection-required quotes (no real pricing) or null-tier drafts.
  const intakeIds = usable.map((m) => m.id)
  const { data: quotes } = await supabase
    .from('quotes')
    .select('id, intake_id, scope_of_works, needs_inspection, good, better, best, selected_tier')
    .in('intake_id', intakeIds)

  if (!quotes || quotes.length === 0) return null

  const quotesByIntake = new Map<string, QuoteForRag>()
  for (const q of quotes as QuoteForRag[]) {
    if (q.intake_id) quotesByIntake.set(q.intake_id, q)
  }

  // Assemble in similarity order, dropping unusable ones (inspection or
  // entirely null tiers).
  const items: Array<{ match: MatchedIntake; quote: QuoteForRag }> = []
  for (const m of usable) {
    const q = quotesByIntake.get(m.id)
    if (!q) continue
    if (q.needs_inspection) continue
    if (!q.good && !q.better && !q.best) continue
    items.push({ match: m, quote: q })
    if (items.length >= 5) break
  }

  if (items.length === 0) return null

  const lines: string[] = []
  lines.push('SIMILAR PAST QUOTES (anchor to these pricing patterns; do NOT copy verbatim if the new intake differs)')
  lines.push('')

  for (let i = 0; i < items.length; i++) {
    const { match, quote } = items[i]
    const sim = (match.similarity * 100).toFixed(0)
    const scopeBits = describeScope(match.scope)
    lines.push(`${i + 1}. similarity ${sim}%${scopeBits ? ' — ' + scopeBits : ''}`)
    if (quote.scope_of_works) {
      lines.push(`   scope: ${truncateOneLine(quote.scope_of_works, 140)}`)
    }
    const tierLine = formatTierPrices(quote)
    if (tierLine) lines.push(`   ${tierLine}`)
    lines.push('')
  }

  lines.push('END SIMILAR PAST QUOTES')
  lines.push('')

  return { context: lines.join('\n'), matchCount: items.length }
}

function normaliseEmbedding(v: number[] | string): number[] | null {
  if (Array.isArray(v)) {
    return v.every((n) => typeof n === 'number') ? v : null
  }
  if (typeof v === 'string') {
    try {
      const parsed = JSON.parse(v)
      if (Array.isArray(parsed) && parsed.every((n) => typeof n === 'number')) {
        return parsed
      }
    } catch {
      // fall through
    }
  }
  return null
}

function describeScope(scope: any): string {
  if (!scope || typeof scope !== 'object') return ''
  const bits: string[] = []
  if (typeof scope.item_count === 'number' && scope.item_count > 0) {
    bits.push(`x${scope.item_count}`)
  }
  if (typeof scope.is_new_install === 'boolean') {
    bits.push(scope.is_new_install ? 'new install' : 'replacing existing')
  }
  if (typeof scope.indoor_outdoor === 'string' && scope.indoor_outdoor) {
    bits.push(scope.indoor_outdoor)
  }
  return bits.join(', ')
}

function truncateOneLine(s: string, max: number): string {
  const oneLine = s.replace(/\s+/g, ' ').trim()
  return oneLine.length <= max ? oneLine : oneLine.slice(0, max - 1) + '…'
}

function fmtMoney(exGst: number | string | null | undefined): string | null {
  if (exGst === null || exGst === undefined) return null
  const n = typeof exGst === 'string' ? parseFloat(exGst) : exGst
  if (!Number.isFinite(n) || n <= 0) return null
  // Show inc-GST since that's how the tradie thinks about it on the SMS.
  const inc = Math.round(n * 1.10)
  return `$${inc.toLocaleString('en-AU')}`
}

function formatTierPrices(quote: QuoteForRag): string | null {
  const g = fmtMoney(quote.good?.subtotal_ex_gst)
  const b = fmtMoney(quote.better?.subtotal_ex_gst)
  const x = fmtMoney(quote.best?.subtotal_ex_gst)
  if (!g && !b && !x) return null
  const parts: string[] = []
  if (g) parts.push(`GOOD ${g}`)
  if (b) parts.push(`BETTER ${b}${quote.selected_tier === 'better' ? ' (rec)' : ''}`)
  if (x) parts.push(`BEST ${x}${quote.selected_tier === 'best' ? ' (rec)' : ''}`)
  return `tiers (inc GST): ${parts.join(' / ')}`
}
