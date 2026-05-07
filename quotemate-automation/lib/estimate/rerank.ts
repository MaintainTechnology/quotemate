// Provider-agnostic reranker for the RAG pipeline.
//
// After pgvector returns top-K cosine-similar past intakes, the reranker
// scores each (query, candidate) pair with a cross-encoder model that
// reads both texts together — much sharper relevance than cosine alone.
//
// Today only Voyage Rerank is wired up; the interface is structured so
// swapping to Cohere later is a ~50-LOC addition (one new impl, one env
// var change). See README in lib/estimate/.
//
// Disabled at runtime via RAG_RERANK_DISABLED=true. When disabled, the
// RAG pipeline falls back to ordering by cosine similarity alone.

export type RerankedDoc = {
  /** Original index in the input documents array. */
  index: number
  /** Provider-specific relevance score; higher = more relevant. */
  score: number
}

export interface Reranker {
  /** Identifier for logs / metrics, e.g. "voyage:rerank-2.5". */
  name: string
  /**
   * Re-score documents against the query and return them ordered by
   * relevance (highest first). Returns at most `topN` items. Implementations
   * MUST be deterministic for the same (query, docs, topN) tuple.
   */
  rerank(query: string, docs: string[], topN: number): Promise<RerankedDoc[]>
}

// ─────────────────────────────────────────────────────────────────
// Voyage Rerank — https://docs.voyageai.com/docs/reranker
// ─────────────────────────────────────────────────────────────────

const VOYAGE_RERANK_URL = 'https://api.voyageai.com/v1/rerank'
const VOYAGE_MODEL = process.env.VOYAGE_RERANK_MODEL ?? 'rerank-2.5'

const voyageReranker: Reranker = {
  name: `voyage:${VOYAGE_MODEL}`,
  async rerank(query, docs, topN) {
    if (!process.env.VOYAGE_API_KEY) {
      throw new Error('VOYAGE_API_KEY not set — cannot call Voyage Rerank')
    }
    if (docs.length === 0) return []

    const res = await fetch(VOYAGE_RERANK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.VOYAGE_API_KEY}`,
      },
      body: JSON.stringify({
        query,
        documents: docs,
        model: VOYAGE_MODEL,
        top_k: Math.min(topN, docs.length),
      }),
    })

    if (!res.ok) {
      const errBody = await res.text().catch(() => '(unreadable)')
      throw new Error(`Voyage Rerank HTTP ${res.status}: ${errBody.slice(0, 200)}`)
    }

    const json = (await res.json()) as {
      data: Array<{ index: number; relevance_score: number }>
    }
    return json.data.map((d) => ({ index: d.index, score: d.relevance_score }))
  },
}

// ─────────────────────────────────────────────────────────────────
// Factory — picks the configured provider, or null when disabled.
// Callers MUST handle null and fall back to cosine-only ordering.
// ─────────────────────────────────────────────────────────────────

export function getReranker(): Reranker | null {
  if (process.env.RAG_RERANK_DISABLED === 'true') return null

  const provider = process.env.RAG_RERANK_PROVIDER ?? 'voyage'
  switch (provider) {
    case 'voyage':
      if (!process.env.VOYAGE_API_KEY) return null
      return voyageReranker
    // Future provider stubs go here. Implement Reranker, return the impl.
    // case 'cohere': return cohereReranker
    default:
      return null
  }
}
