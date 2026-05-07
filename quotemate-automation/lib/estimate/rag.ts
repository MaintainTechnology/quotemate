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
import { getReranker } from './rerank'
import { pipelineLog } from '@/lib/log/pipeline'

// Number of candidates to pull from pgvector. The reranker (when active)
// re-scores all of them and we keep the top FINAL_CONTEXT_COUNT for the
// Opus prompt. Without the reranker we fall back to the cosine ordering
// and still keep top FINAL_CONTEXT_COUNT.
//
// 20 is enough room for the reranker to do meaningful refinement while
// staying inside Voyage Rerank's batch-size sweet spot for short docs.
const VECTOR_FETCH_COUNT = 20

// How many past quotes to actually include in the prompt context block.
// Empirically 3 is enough to anchor pricing patterns without bloating the
// prompt or burying the "do NOT copy verbatim" instruction.
const FINAL_CONTEXT_COUNT = 3

// Floor below which a cosine match is rejected outright (before reranking).
// Slightly looser than before because the reranker is the real gate now;
// this floor exists only to prevent obviously-orthogonal junk from going
// to the reranker (which would waste the API call).
const MIN_SIMILARITY = 0.40

// Floor on reranker relevance score below which a candidate is dropped
// even if it made the top-K. Voyage scores roughly 0.0–1.0; below 0.3
// is "not really related" in practice.
const MIN_RERANK_SCORE = 0.30

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
  scope?: any
  access?: any
  risks?: string[]
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

  const log = pipelineLog('estimate', intake.id ?? undefined)

  const { data: matches, error: matchErr } = await supabase.rpc('match_intakes', {
    query_embedding: queryEmbedding,
    match_count: VECTOR_FETCH_COUNT,
  })

  if (matchErr || !Array.isArray(matches) || matches.length === 0) {
    return null
  }

  // Drop the current intake itself + anything below the cosine floor.
  // The reranker is the real relevance gate; this floor only filters
  // obvious orthogonal noise so we don't waste a rerank API call on it.
  const cosineSurvivors = (matches as MatchedIntake[])
    .filter((m) => m.id !== intake.id)
    .filter((m) => Number.isFinite(m.similarity) && m.similarity >= MIN_SIMILARITY)

  if (cosineSurvivors.length === 0) return null

  // Hydrate matched intakes with their winning quote. We don't include
  // inspection-required quotes (no real pricing) or null-tier drafts.
  const intakeIds = cosineSurvivors.map((m) => m.id)
  const { data: quotes } = await supabase
    .from('quotes')
    .select('id, intake_id, scope_of_works, needs_inspection, good, better, best, selected_tier')
    .in('intake_id', intakeIds)

  if (!quotes || quotes.length === 0) return null

  const quotesByIntake = new Map<string, QuoteForRag>()
  for (const q of quotes as QuoteForRag[]) {
    if (q.intake_id) quotesByIntake.set(q.intake_id, q)
  }

  // Build the candidate pool — past intakes that have a usable quote.
  type Candidate = { match: MatchedIntake; quote: QuoteForRag }
  const candidates: Candidate[] = []
  for (const m of cosineSurvivors) {
    const q = quotesByIntake.get(m.id)
    if (!q) continue
    if (q.needs_inspection) continue
    if (!q.good && !q.better && !q.best) continue
    candidates.push({ match: m, quote: q })
  }

  if (candidates.length === 0) return null

  // ─── Re-rank stage ──────────────────────────────────────────────
  // Run the reranker over the candidate pool. If the reranker is
  // disabled (or unavailable / fails), fall back to cosine ordering.
  const reranker = getReranker()
  let finalItems: Array<Candidate & { rerankScore?: number }>

  if (reranker && candidates.length > 1) {
    const queryText = buildRerankQuery(intake)
    const docTexts = candidates.map((c) => buildRerankDoc(c.match, c.quote))

    try {
      const ranked = await reranker.rerank(queryText, docTexts, FINAL_CONTEXT_COUNT)
      // Drop low-score reranked candidates so we never anchor to
      // genuinely-irrelevant past quotes even if they were in top-K.
      finalItems = ranked
        .filter((r) => r.score >= MIN_RERANK_SCORE)
        .map((r) => ({
          ...candidates[r.index],
          rerankScore: r.score,
        }))
      log.ok('RAG rerank complete', {
        reranker: reranker.name,
        candidates_in: candidates.length,
        kept_after_score_floor: finalItems.length,
        top_score: ranked[0]?.score?.toFixed(3) ?? 'n/a',
      })
    } catch (e: any) {
      // Rerank API failure → fall back to cosine ordering. Don't block
      // the estimation just because the rerank service is down.
      log.err('rerank API failed — falling back to cosine ordering', e?.message ?? String(e))
      finalItems = candidates.slice(0, FINAL_CONTEXT_COUNT)
    }
  } else {
    finalItems = candidates.slice(0, FINAL_CONTEXT_COUNT)
    if (!reranker) {
      log.ok('RAG rerank skipped — provider disabled or unconfigured', { candidates: candidates.length })
    }
  }

  if (finalItems.length === 0) return null

  // ─── Format the prompt context block ────────────────────────────
  const lines: string[] = []
  lines.push('SIMILAR PAST QUOTES (anchor to these pricing patterns; do NOT copy verbatim if the new intake differs)')
  lines.push('')

  for (let i = 0; i < finalItems.length; i++) {
    const { match, quote, rerankScore } = finalItems[i]
    const sim = (match.similarity * 100).toFixed(0)
    const rs = rerankScore != null ? ` · rerank ${(rerankScore * 100).toFixed(0)}%` : ''
    const scopeBits = describeScope(match.scope)
    lines.push(`${i + 1}. similarity ${sim}%${rs}${scopeBits ? ' — ' + scopeBits : ''}`)
    if (quote.scope_of_works) {
      lines.push(`   scope: ${truncateOneLine(quote.scope_of_works, 140)}`)
    }
    const tierLine = formatTierPrices(quote)
    if (tierLine) lines.push(`   ${tierLine}`)
    lines.push('')
  }

  lines.push('END SIMILAR PAST QUOTES')
  lines.push('')

  return { context: lines.join('\n'), matchCount: finalItems.length }
}

// ─── Rerank query/document builders ──────────────────────────────
// The reranker only sees these strings — make them dense with the
// fields that actually distinguish electrical jobs (job_type, count,
// new vs replace, indoor/outdoor, key access factors, risks).

function buildRerankQuery(intake: IntakeForRag): string {
  const bits: string[] = []
  if (intake.job_type) bits.push(`job_type=${intake.job_type}`)
  const sc = intake.scope ?? {}
  if (typeof sc.item_count === 'number') bits.push(`count=${sc.item_count}`)
  if (typeof sc.is_new_install === 'boolean') {
    bits.push(sc.is_new_install ? 'new install' : 'replacing existing')
  }
  if (sc.indoor_outdoor) bits.push(sc.indoor_outdoor)
  if (sc.description) bits.push(`scope: ${String(sc.description).slice(0, 200)}`)
  const ac = intake.access ?? {}
  if (ac.ceiling_type) bits.push(`ceiling=${ac.ceiling_type}`)
  if (ac.wall_type) bits.push(`wall=${ac.wall_type}`)
  if (ac.roof_access != null) bits.push(`roof_access=${ac.roof_access}`)
  if (Array.isArray(intake.risks) && intake.risks.length) {
    bits.push(`risks: ${intake.risks.join(', ').slice(0, 120)}`)
  }
  return bits.join(' · ')
}

function buildRerankDoc(match: MatchedIntake, quote: QuoteForRag): string {
  const bits: string[] = []
  bits.push(describeScope(match.scope) || 'past quote')
  if (quote.scope_of_works) {
    bits.push(`scope: ${truncateOneLine(quote.scope_of_works, 200)}`)
  }
  const tierLine = formatTierPrices(quote)
  if (tierLine) bits.push(tierLine)
  return bits.join(' · ')
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
