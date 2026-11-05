import type { SupabaseClient } from '@supabase/supabase-js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchSimilarPastQuotesContext } from './rag'

const { getReranker } = vi.hoisted(() => ({ getReranker: vi.fn() }))
vi.mock('./rerank', () => ({ getReranker }))

afterEach(() => {
  vi.unstubAllEnvs()
  vi.clearAllMocks()
})

describe('retired historical-quote retrieval', () => {
  it.each([undefined, 'false', 'true'])(
    'does not access customer records or a reranker when RAG_DISABLED=%s',
    async (disabled) => {
      vi.stubEnv('RAG_DISABLED', disabled)
      const rpc = vi.fn()
      const from = vi.fn()
      const supabase = { rpc, from } as unknown as SupabaseClient

      const result = await fetchSimilarPastQuotesContext(supabase, {
        id: 'new-intake',
        embedding: [0.1, 0.2, 0.3],
        job_type: 'downlights',
      })

      expect(result).toBeNull()
      expect(rpc).not.toHaveBeenCalled()
      expect(from).not.toHaveBeenCalled()
      expect(getReranker).not.toHaveBeenCalled()
    },
  )

  it('does not consider a caller-supplied tenant ID proof of isolated retrieval', async () => {
    vi.stubEnv('RAG_DISABLED', 'false')
    const databaseAccess = vi.fn(() => {
      throw new Error('Historical customer records must not be accessed')
    })
    const supabase = new Proxy({}, { get: databaseAccess }) as SupabaseClient
    const intake = {
      id: 'tenant-a-intake',
      tenant_id: 'tenant-a',
      embedding: '[0.1,0.2,0.3]',
      job_type: 'downlights',
      scope: { description: 'Prior quote GOOD $550 / BETTER $770 / BEST $990' },
    }

    const result = await fetchSimilarPastQuotesContext(supabase, intake)

    // There is no context string in which historic amounts or customer prose
    // can reach either the estimator or a third-party reranker.
    expect(result).toBeNull()
    expect(databaseAccess).not.toHaveBeenCalled()
    expect(getReranker).not.toHaveBeenCalled()
  })

  it('does not inspect intake data when historical retrieval is disabled', async () => {
    const intakeAccess = vi.fn(() => {
      throw new Error('Historical retrieval must not read intake content')
    })
    const intake = new Proxy({}, { get: intakeAccess })

    await expect(
      fetchSimilarPastQuotesContext({} as SupabaseClient, intake),
    ).resolves.toBeNull()
    expect(intakeAccess).not.toHaveBeenCalled()
  })
})
