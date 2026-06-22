import { describe, it, expect, vi } from 'vitest'
import { reconcileTenantFileDocs, type ReconRow, type ReconcilePorts } from './reconcile'

function row(over: Partial<ReconRow> = {}): ReconRow {
  return {
    id: 'r1',
    tenant_id: 't1',
    kb_document_id: 'fileSearchStores/s1/documents/d1',
    attempts: 0,
    source_kind: 'quote',
    source_id: 'q1',
    trade: 'electrical',
    ...over,
  }
}

function ports(over: Partial<ReconcilePorts> = {}): ReconcilePorts {
  return {
    listPending: async () => [],
    listFailedRetryable: async () => [],
    kbDocState: async () => null,
    markActive: async () => {},
    bumpAttempts: async () => {},
    reingest: async () => {},
    listOverflow: async () => [],
    oldestActive: async () => [],
    deleteKbDoc: async () => {},
    markPruned: async () => {},
    ...over,
  }
}

describe('reconcileTenantFileDocs', () => {
  it('(a) flips a pending row to active once KB indexing completed', async () => {
    const markActive = vi.fn(async () => {})
    const stats = await reconcileTenantFileDocs(
      ports({
        listPending: async () => [row()],
        kbDocState: async () => 'ACTIVE',
        markActive,
      }),
    )
    expect(markActive).toHaveBeenCalledWith('r1')
    expect(stats.activated).toBe(1)
  })

  it('(a) flips a pending row to active on the real STATE_ACTIVE wire format', async () => {
    const markActive = vi.fn(async () => {})
    const stats = await reconcileTenantFileDocs(
      ports({
        listPending: async () => [row()],
        kbDocState: async () => 'STATE_ACTIVE',
        markActive,
      }),
    )
    expect(markActive).toHaveBeenCalledWith('r1')
    expect(stats.activated).toBe(1)
  })

  it('(a) leaves a still-processing row pending', async () => {
    const markActive = vi.fn(async () => {})
    const stats = await reconcileTenantFileDocs(
      ports({ listPending: async () => [row()], kbDocState: async () => 'PROCESSING', markActive }),
    )
    expect(markActive).not.toHaveBeenCalled()
    expect(stats.stillPending).toBe(1)
  })

  it('(b) retries a failed row and increments attempts (bounded by maxRetries)', async () => {
    const bumpAttempts = vi.fn(async () => {})
    const reingest = vi.fn(async () => {})
    // The port itself enforces attempts < maxRetries; here it returns one retryable row.
    const stats = await reconcileTenantFileDocs(
      ports({
        listFailedRetryable: async (maxRetries) => {
          expect(maxRetries).toBe(3)
          return [row({ state: undefined, attempts: 1 } as Partial<ReconRow>)]
        },
        bumpAttempts,
        reingest,
      }),
      { maxRetries: 3 },
    )
    expect(bumpAttempts).toHaveBeenCalledWith('r1', 2)
    expect(reingest).toHaveBeenCalledOnce()
    expect(stats.retried).toBe(1)
  })

  it('(b) does not retry when no rows are under the retry cap', async () => {
    const reingest = vi.fn(async () => {})
    const stats = await reconcileTenantFileDocs(ports({ listFailedRetryable: async () => [], reingest }), {
      maxRetries: 3,
    })
    expect(reingest).not.toHaveBeenCalled()
    expect(stats.retried).toBe(0)
  })

  it('(c) prunes the oldest active docs from the KB when a tenant overflows', async () => {
    const deleteKbDoc = vi.fn(async () => {})
    const markPruned = vi.fn(async () => {})
    const stats = await reconcileTenantFileDocs(
      ports({
        listOverflow: async (maxDocs) => {
          expect(maxDocs).toBe(2)
          return [{ tenant_id: 't1', excess: 1 }]
        },
        oldestActive: async (t, n) => {
          expect(t).toBe('t1')
          expect(n).toBe(1)
          return [row({ id: 'old1', kb_document_id: 'fileSearchStores/s1/documents/old' })]
        },
        deleteKbDoc,
        markPruned,
      }),
      { maxDocs: 2 },
    )
    expect(deleteKbDoc).toHaveBeenCalledWith('fileSearchStores/s1/documents/old')
    expect(markPruned).toHaveBeenCalledWith('old1')
    expect(stats.pruned).toBe(1)
  })
})
