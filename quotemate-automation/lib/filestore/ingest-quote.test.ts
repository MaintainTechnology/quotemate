import { describe, it, expect, vi } from 'vitest'
import type { KbConfig, KbFetch } from '../admin-loader/mt-filestore-kb'
import {
  archiveAndIngestQuote,
  type TenantFileDocRow,
  type TenantFileDocsRepo,
} from './ingest-quote'

const CONFIG: KbConfig = { url: 'https://kb.test', apiKey: 'k' }
const TID = '550e8400-e29b-41d4-a716-446655440000'
const ENABLED = { TENANT_FILESTORE_ENABLED: 'true' } as unknown as NodeJS.ProcessEnv

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

function mkFetch(routes: Record<string, (ctx: { url: URL; init?: RequestInit }) => Response>): {
  fetchImpl: KbFetch
  calls: string[]
} {
  const calls: string[] = []
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : (input as URL).toString())
    const method = (init?.method ?? 'GET').toUpperCase()
    calls.push(`${method} ${url.pathname}`)
    const handler =
      routes[`${method} ${url.pathname}`] ??
      routes[`${method} ${url.pathname.replace(/\/[^/]+$/, '/*')}`]
    if (!handler) return new Response('not found', { status: 404 })
    return handler({ url, init })
  }) as unknown as KbFetch
  return { fetchImpl, calls }
}

function memRepo(seed?: TenantFileDocRow): TenantFileDocsRepo & { rows: Map<string, TenantFileDocRow> } {
  const rows = new Map<string, TenantFileDocRow>()
  if (seed) rows.set(`${seed.tenant_id}|${seed.display_name}`, seed)
  return {
    rows,
    async find(t, dn) {
      return rows.get(`${t}|${dn}`) ?? null
    },
    async save(row) {
      rows.set(`${row.tenant_id}|${row.display_name}`, { ...row })
    },
  }
}

const happyRoutes = {
  'GET /v1/stores': () => json({ stores: [] }),
  'POST /v1/stores': () => json({ name: 'store1' }),
  'GET /v1/stores/store1/documents': () => json({ documents: [] }),
  'POST /v1/stores/store1/upload': () => json({ name: 'fileSearchStores/store1/documents/doc1' }),
} as const

const baseArgs = {
  tenantId: TID,
  sourceKind: 'quote' as const,
  sourceId: 'q-123',
  trade: 'electrical',
  fullDocPath: 'quotes/q-123.pdf',
  kbText: '# Quote summary\n- Total inc GST: $1100',
  contentHash: 'hash-v1',
}

describe('archiveAndIngestQuote', () => {
  it('STUBs when the flag is off (no rows, no KB calls)', async () => {
    const repo = memRepo()
    const { fetchImpl, calls } = mkFetch(happyRoutes)
    await archiveAndIngestQuote(baseArgs, { repo, env: {} as NodeJS.ProcessEnv, config: CONFIG, fetchImpl })
    expect(repo.rows.size).toBe(0)
    expect(calls).toHaveLength(0)
  })

  it('no-ops on a null tenant (orphan row)', async () => {
    const repo = memRepo()
    await archiveAndIngestQuote({ ...baseArgs, tenantId: null }, { repo, env: ENABLED, config: CONFIG, fetchImpl: mkFetch(happyRoutes).fetchImpl })
    expect(repo.rows.size).toBe(0)
  })

  it('records a skipped row (lockstep) when no full doc was archived', async () => {
    const repo = memRepo()
    await archiveAndIngestQuote({ ...baseArgs, fullDocPath: null }, { repo, env: ENABLED, config: CONFIG, fetchImpl: mkFetch(happyRoutes).fetchImpl })
    const row = repo.rows.get(`${TID}|quote-electrical-q-123`)
    expect(row?.state).toBe('skipped')
    expect(row?.skip_reason).toBe('no-full-doc')
  })

  it('does NOT clobber an already-active doc with a skip', async () => {
    const repo = memRepo({
      tenant_id: TID, source_kind: 'quote', source_id: 'q-123', trade: 'electrical',
      display_name: 'quote-electrical-q-123', storage_path: 'quotes/q-123.pdf',
      kb_document_id: 'fileSearchStores/store1/documents/doc1', state: 'active', content_hash: 'hash-v1',
    })
    await archiveAndIngestQuote({ ...baseArgs, fullDocPath: null }, { repo, env: ENABLED, config: CONFIG, fetchImpl: mkFetch(happyRoutes).fetchImpl })
    expect(repo.rows.get(`${TID}|quote-electrical-q-123`)?.state).toBe('active')
  })

  it('happy path: archives + uploads minimized text + records the row', async () => {
    const repo = memRepo()
    const { fetchImpl } = mkFetch(happyRoutes)
    await archiveAndIngestQuote(baseArgs, { repo, env: ENABLED, config: CONFIG, fetchImpl })
    const row = repo.rows.get(`${TID}|quote-electrical-q-123`)
    expect(row).toBeTruthy()
    expect(row!.storage_path).toBe('quotes/q-123.pdf')
    expect(row!.kb_document_id).toBe('fileSearchStores/store1/documents/doc1')
    expect(row!.state).toBe('pending') // upload returned no state ⇒ pending; reconcile flips to active
    expect(row!.content_hash).toBe('hash-v1')
  })

  it('marks the row active directly when the upload reports STATE_ACTIVE', async () => {
    const repo = memRepo()
    // Real service behaviour: the upload omits the doc name. First documents GET
    // = dedup (empty), second = post-upload recovery (doc, STATE_ACTIVE) → ingest
    // records 'active' without waiting on the reconcile cron.
    let listCalls = 0
    const fetchImpl = mkFetch({
      'GET /v1/stores': () => json({ stores: [] }),
      'POST /v1/stores': () => json({ name: 'store1' }),
      'GET /v1/stores/store1/documents': () => {
        listCalls += 1
        if (listCalls === 1) return json({ documents: [] })
        return json({
          documents: [{ name: 'fileSearchStores/store1/documents/doc1', displayName: 'quote-electrical-q-123', state: 'STATE_ACTIVE' }],
        })
      },
      'POST /v1/stores/store1/upload': () => json({ indexed: true, document: { sizeBytes: '42', mimeType: 'text/markdown' } }),
    }).fetchImpl
    await archiveAndIngestQuote(baseArgs, { repo, env: ENABLED, config: CONFIG, fetchImpl })
    const row = repo.rows.get(`${TID}|quote-electrical-q-123`)
    expect(row!.kb_document_id).toBe('fileSearchStores/store1/documents/doc1')
    expect(row!.state).toBe('active')
  })

  it('never throws and marks the row failed when KB upload errors', async () => {
    const repo = memRepo()
    const { fetchImpl } = mkFetch({
      ...happyRoutes,
      'POST /v1/stores/store1/upload': () => new Response('kb boom', { status: 500 }),
    })
    await expect(
      archiveAndIngestQuote(baseArgs, { repo, env: ENABLED, config: CONFIG, fetchImpl }),
    ).resolves.toBeUndefined()
    const row = repo.rows.get(`${TID}|quote-electrical-q-123`)
    expect(row!.state).toBe('failed')
    expect(row!.storage_path).toBe('quotes/q-123.pdf') // archive recorded regardless
  })

  it('leaves the row pending when the store cannot be ensured (KB down)', async () => {
    const repo = memRepo()
    const { fetchImpl } = mkFetch({ 'GET /v1/stores': () => new Response('down', { status: 503 }) })
    await archiveAndIngestQuote(baseArgs, { repo, env: ENABLED, config: CONFIG, fetchImpl })
    const row = repo.rows.get(`${TID}|quote-electrical-q-123`)
    expect(row!.state).toBe('pending')
  })

  it('dedups an unchanged, already-active doc (no KB calls)', async () => {
    const repo = memRepo({
      tenant_id: TID,
      source_kind: 'quote',
      source_id: 'q-123',
      trade: 'electrical',
      display_name: 'quote-electrical-q-123',
      storage_path: 'quotes/q-123.pdf',
      kb_document_id: 'fileSearchStores/store1/documents/doc1',
      state: 'active',
      content_hash: 'hash-v1',
    })
    const { fetchImpl, calls } = mkFetch(happyRoutes)
    await archiveAndIngestQuote(baseArgs, { repo, env: ENABLED, config: CONFIG, fetchImpl })
    expect(calls).toHaveLength(0)
  })

  it('material re-draft: deletes the stale KB doc then uploads the new one', async () => {
    const repo = memRepo({
      tenant_id: TID,
      source_kind: 'quote',
      source_id: 'q-123',
      trade: 'electrical',
      display_name: 'quote-electrical-q-123',
      storage_path: 'quotes/q-123.pdf',
      kb_document_id: 'fileSearchStores/store1/documents/old',
      state: 'active',
      content_hash: 'hash-OLD',
    })
    const del = vi.fn(() => json({ ok: true }))
    const { fetchImpl, calls } = mkFetch({ ...happyRoutes, 'DELETE /v1/stores/store1/documents/old': del })
    await archiveAndIngestQuote({ ...baseArgs, contentHash: 'hash-v1' }, { repo, env: ENABLED, config: CONFIG, fetchImpl })
    expect(del).toHaveBeenCalledOnce()
    expect(calls).toContain('DELETE /v1/stores/store1/documents/old')
    const row = repo.rows.get(`${TID}|quote-electrical-q-123`)
    expect(row!.kb_document_id).toBe('fileSearchStores/store1/documents/doc1')
    expect(row!.content_hash).toBe('hash-v1')
  })
})
