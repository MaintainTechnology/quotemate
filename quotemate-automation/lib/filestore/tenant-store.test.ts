import { describe, it, expect, vi } from 'vitest'
import type { KbConfig, KbFetch } from '../admin-loader/mt-filestore-kb'
import {
  ensureTenantStore,
  addDocumentToTenantStore,
  searchTenantStore,
} from './tenant-store'
import { tenantStoreDisplayName } from './tenant-store-name'

const CONFIG: KbConfig = { url: 'https://kb.test', apiKey: 'k' }
const TID = '550e8400-e29b-41d4-a716-446655440000'

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

/** Build a fake KbFetch dispatching on `METHOD /pathname`. */
function mkFetch(routes: Record<string, (ctx: { url: URL; init?: RequestInit }) => Response>): KbFetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : (input as URL).toString())
    const method = (init?.method ?? 'GET').toUpperCase()
    const handler =
      routes[`${method} ${url.pathname}`] ??
      routes[`${method} ${url.pathname.replace(/\/[^/]+$/, '/*')}`]
    if (!handler) return new Response('not found', { status: 404 })
    return handler({ url, init })
  }) as unknown as KbFetch
}

describe('ensureTenantStore', () => {
  it('returns null without config (env unset, no deps)', async () => {
    const out = await ensureTenantStore(TID, 'Biz', { fetchImpl: mkFetch({}) })
    expect(out).toBeNull()
  })

  it('creates a store when none matches', async () => {
    const fetchImpl = mkFetch({
      'GET /v1/stores': () => json({ stores: [] }),
      'POST /v1/stores': () => json({ name: 'fileSearchStores/new', displayName: tenantStoreDisplayName(TID, 'Biz') }),
    })
    const out = await ensureTenantStore(TID, 'Biz', { config: CONFIG, fetchImpl })
    expect(out).toBe('fileSearchStores/new')
  })

  it('reuses an existing store by tenant-keyed display name', async () => {
    const fetchImpl = mkFetch({
      'GET /v1/stores': () =>
        json({ stores: [{ name: 'fileSearchStores/existing', displayName: tenantStoreDisplayName(TID, 'Renamed') }] }),
    })
    const out = await ensureTenantStore(TID, 'Biz', { config: CONFIG, fetchImpl })
    expect(out).toBe('fileSearchStores/existing')
  })

  it('never throws on KB error', async () => {
    const fetchImpl = mkFetch({ 'GET /v1/stores': () => new Response('boom', { status: 500 }) })
    await expect(ensureTenantStore(TID, 'Biz', { config: CONFIG, fetchImpl })).resolves.toBeNull()
  })
})

describe('addDocumentToTenantStore', () => {
  it('uploads markdown and returns the kb document id', async () => {
    const upload = vi.fn(() => json({ name: 'fileSearchStores/s1/documents/doc1' }))
    const fetchImpl = mkFetch({
      'GET /v1/stores/s1/documents': () => json({ documents: [] }),
      'POST /v1/stores/s1/upload': upload,
    })
    const out = await addDocumentToTenantStore(
      { tenantId: TID, storeId: 's1', fileBytes: new TextEncoder().encode('# md'), displayName: 'quote-electrical-x' },
      { config: CONFIG, fetchImpl },
    )
    expect(out).toEqual({ kbDocumentId: 'fileSearchStores/s1/documents/doc1' })
    expect(upload).toHaveBeenCalledOnce()
  })

  it('dedups by displayName (no re-upload)', async () => {
    const upload = vi.fn(() => json({ name: 'should-not-happen' }))
    const fetchImpl = mkFetch({
      'GET /v1/stores/s1/documents': () =>
        json({ documents: [{ name: 'fileSearchStores/s1/documents/existing', displayName: 'quote-electrical-x' }] }),
      'POST /v1/stores/s1/upload': upload,
    })
    const out = await addDocumentToTenantStore(
      { tenantId: TID, storeId: 's1', fileBytes: new TextEncoder().encode('# md'), displayName: 'quote-electrical-x' },
      { config: CONFIG, fetchImpl },
    )
    expect(out).toEqual({ kbDocumentId: 'fileSearchStores/s1/documents/existing' })
    expect(upload).not.toHaveBeenCalled()
  })

  it('returns null on empty bytes', async () => {
    const out = await addDocumentToTenantStore(
      { tenantId: TID, storeId: 's1', fileBytes: new Uint8Array(0), displayName: 'd' },
      { config: CONFIG, fetchImpl: mkFetch({}) },
    )
    expect(out).toBeNull()
  })
})

describe('searchTenantStore', () => {
  it('returns empty result without config', async () => {
    const out = await searchTenantStore({ storeId: 's1', query: 'q' }, { fetchImpl: mkFetch({}) })
    expect(out.answer).toBe('')
    expect(out.passages).toEqual([])
  })

  it('passes the tenant persona and returns the answer', async () => {
    const fetchImpl = mkFetch({
      'POST /v1/search': ({ init }) => {
        const body = JSON.parse(String(init?.body ?? '{}'))
        expect(body.store).toBe('s1')
        expect(typeof body.systemInstruction).toBe('string')
        return json({ answer: 'You quoted $1,100 for downlights.', passages: [] })
      },
    })
    const out = await searchTenantStore({ storeId: 's1', query: 'downlights?' }, { config: CONFIG, fetchImpl })
    expect(out.answer).toContain('downlights')
  })
})
