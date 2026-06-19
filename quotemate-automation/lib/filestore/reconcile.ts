// Reconcile + retention pass for per-tenant file docs (spec 2026-06-19, R15).
//
// Run by the cron at app/api/cron/tenant-filestore-reconcile. Three jobs:
//   (a) pending → active : confirm async KB indexing finished (poll kbListDocuments).
//   (b) failed retries   : re-ingest while attempts < TENANT_FILESTORE_MAX_RETRIES,
//                          incrementing attempts each pass (then give up).
//   (c) retention prune  : when a tenant exceeds TENANT_FILESTORE_MAX_DOCS active
//                          docs, delete the oldest from the KB index (kbDeleteDocument)
//                          and mark the row skipped/pruned. The Supabase full-doc
//                          archive is RETAINED — only the KB index is pruned.
//
// The core is written against an injectable `ReconcilePorts` so it is unit-tested
// offline; `defaultReconcilePorts()` wires the ports to Supabase + the KB client.

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import {
  kbDeleteDocument,
  kbListDocuments,
  loadKbConfigFromEnv,
  type KbConfig,
  type KbFetch,
} from '../admin-loader/mt-filestore-kb'
import { bareStoreId } from './tenant-store-name'
import { archiveAndIngestQuote } from './ingest-quote'
import { loadAndBuildKbDoc } from './source-doc'

export type ReconRow = {
  id: string
  tenant_id: string
  kb_document_id: string | null
  attempts: number
  source_kind: 'quote' | 'invoice'
  source_id: string
  trade: string | null
}

export interface ReconcilePorts {
  listPending(limit: number): Promise<ReconRow[]>
  listFailedRetryable(maxRetries: number, limit: number): Promise<ReconRow[]>
  /** KB indexing state of a document, or null if not found. */
  kbDocState(kbDocumentId: string): Promise<string | null>
  markActive(id: string): Promise<void>
  bumpAttempts(id: string, attempts: number): Promise<void>
  reingest(row: ReconRow): Promise<void>
  /** Tenants whose active-doc count exceeds maxDocs, with the overflow count. */
  listOverflow(maxDocs: number): Promise<Array<{ tenant_id: string; excess: number }>>
  oldestActive(tenantId: string, n: number): Promise<ReconRow[]>
  deleteKbDoc(kbDocumentId: string): Promise<void>
  markPruned(id: string): Promise<void>
}

export type ReconcileStats = {
  activated: number
  stillPending: number
  retried: number
  pruned: number
}

export async function reconcileTenantFileDocs(
  ports: ReconcilePorts,
  opts?: { maxRetries?: number; maxDocs?: number; limit?: number },
): Promise<ReconcileStats> {
  const maxRetries = opts?.maxRetries ?? Number(process.env.TENANT_FILESTORE_MAX_RETRIES ?? 3)
  const maxDocs = opts?.maxDocs ?? Number(process.env.TENANT_FILESTORE_MAX_DOCS ?? 5000)
  const limit = opts?.limit ?? 200
  let activated = 0
  let stillPending = 0
  let retried = 0
  let pruned = 0

  // (a) pending → active
  for (const row of await ports.listPending(limit)) {
    if (!row.kb_document_id) {
      stillPending++
      continue
    }
    let state: string | null = null
    try {
      state = await ports.kbDocState(row.kb_document_id)
    } catch {
      // best-effort — leave pending for next run
    }
    if (state && state.toLowerCase() === 'active') {
      await ports.markActive(row.id)
      activated++
    } else {
      stillPending++
    }
  }

  // (b) bounded failed retries
  for (const row of await ports.listFailedRetryable(maxRetries, limit)) {
    const next = (row.attempts ?? 0) + 1
    await ports.bumpAttempts(row.id, next)
    try {
      await ports.reingest({ ...row, attempts: next })
      retried++
    } catch {
      // stays failed; next run retries until attempts >= maxRetries
    }
  }

  // (c) retention prune (KB index only; Supabase archive retained)
  for (const t of await ports.listOverflow(maxDocs)) {
    if (t.excess <= 0) continue
    for (const row of await ports.oldestActive(t.tenant_id, t.excess)) {
      if (!row.kb_document_id) continue
      try {
        await ports.deleteKbDoc(row.kb_document_id)
        await ports.markPruned(row.id)
        pruned++
      } catch {
        // best-effort
      }
    }
  }

  return { activated, stillPending, retried, pruned }
}

// ─────────────────────────────────────────────────────────────────────
// Default ports — Supabase + KB client wiring (used by the cron route).
// ─────────────────────────────────────────────────────────────────────

let _client: SupabaseClient | null = null
function serviceClient(): SupabaseClient {
  if (_client) return _client
  _client = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  )
  return _client
}

const ROW_COLS = 'id, tenant_id, kb_document_id, attempts, source_kind, source_id, trade'

export function defaultReconcilePorts(deps?: {
  supabase?: SupabaseClient
  config?: KbConfig
  fetchImpl?: KbFetch
}): ReconcilePorts {
  const db = deps?.supabase ?? serviceClient()
  const config = deps?.config ?? (() => {
    try {
      return loadKbConfigFromEnv()
    } catch {
      return null
    }
  })()
  const nowIso = () => new Date().toISOString()

  return {
    async listPending(limit) {
      const { data } = await db
        .from('tenant_file_documents')
        .select(ROW_COLS)
        .eq('state', 'pending')
        .not('kb_document_id', 'is', null)
        .limit(limit)
      return (data ?? []) as ReconRow[]
    },
    async listFailedRetryable(maxRetries, limit) {
      const { data } = await db
        .from('tenant_file_documents')
        .select(ROW_COLS)
        .eq('state', 'failed')
        .lt('attempts', maxRetries)
        .limit(limit)
      return (data ?? []) as ReconRow[]
    },
    async kbDocState(kbDocumentId) {
      if (!config) return null
      const m = kbDocumentId.match(/^fileSearchStores\/([^/]+)\/documents\/.+$/)
      if (!m) return null
      const docs = await kbListDocuments(config, bareStoreId(`fileSearchStores/${m[1]}`), deps?.fetchImpl)
      const doc = docs.find((d) => d.name === kbDocumentId)
      return doc?.state ?? null
    },
    async markActive(id) {
      await db.from('tenant_file_documents').update({ state: 'active', updated_at: nowIso() }).eq('id', id)
    },
    async bumpAttempts(id, attempts) {
      await db.from('tenant_file_documents').update({ attempts, updated_at: nowIso() }).eq('id', id)
    },
    async reingest(row) {
      const built = await loadAndBuildKbDoc(db, {
        sourceKind: row.source_kind,
        sourceId: row.source_id,
        trade: row.trade,
      })
      await archiveAndIngestQuote(
        {
          tenantId: built?.tenantId ?? row.tenant_id,
          sourceKind: row.source_kind,
          sourceId: row.source_id,
          trade: row.trade,
          fullDocPath: built?.fullDocPath ?? null,
          kbText: built?.kbText ?? '',
          contentHash: built?.contentHash ?? null,
        },
        { config: config ?? undefined, fetchImpl: deps?.fetchImpl },
      )
    },
    async listOverflow(maxDocs) {
      // Small install: tally active docs per tenant in memory.
      const { data } = await db
        .from('tenant_file_documents')
        .select('tenant_id')
        .eq('state', 'active')
      const counts = new Map<string, number>()
      for (const r of (data ?? []) as Array<{ tenant_id: string }>) {
        counts.set(r.tenant_id, (counts.get(r.tenant_id) ?? 0) + 1)
      }
      const out: Array<{ tenant_id: string; excess: number }> = []
      for (const [tenant_id, n] of counts) {
        if (n > maxDocs) out.push({ tenant_id, excess: n - maxDocs })
      }
      return out
    },
    async oldestActive(tenantId, n) {
      const { data } = await db
        .from('tenant_file_documents')
        .select(ROW_COLS)
        .eq('tenant_id', tenantId)
        .eq('state', 'active')
        .order('created_at', { ascending: true })
        .limit(n)
      return (data ?? []) as ReconRow[]
    },
    async deleteKbDoc(kbDocumentId) {
      if (!config) return
      await kbDeleteDocument(config, kbDocumentId, deps?.fetchImpl)
    },
    async markPruned(id) {
      await db
        .from('tenant_file_documents')
        .update({ state: 'skipped', skip_reason: 'pruned', updated_at: nowIso() })
        .eq('id', id)
    },
  }
}
