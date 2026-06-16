import { describe, expect, it, vi, type Mock } from 'vitest'
import type { KbConfig, KbFetch, KbStoreSummary } from '../admin-loader/mt-filestore-kb'
import {
  ESTIMATOR_CHAT_SYSTEM,
  addDocumentsToSessionStore,
  ensureSessionStore,
  searchSessionStore,
} from './session-store'

const config: KbConfig = { url: 'https://kb.example.com', apiKey: 'k' }

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

type FetchMock = Mock<(url: string, init?: RequestInit) => Promise<Response>>

/** A routing fetch mock that mirrors the mt-filestore-kb endpoints. */
function kbRouter(opts: {
  stores?: KbStoreSummary[]
  createdName?: string
  documents?: { displayName?: string }[]
  search?: unknown
  failOn?: (url: string, method: string) => number | null
}): FetchMock {
  return vi.fn(async (url: string, init: RequestInit = {}): Promise<Response> => {
    const method = (init.method ?? 'GET').toUpperCase()
    const u = new URL(url)
    const fail = opts.failOn?.(url, method)
    if (fail) return new Response('err', { status: fail })
    if (u.pathname === '/v1/stores' && method === 'GET') return json({ stores: opts.stores ?? [] })
    if (u.pathname === '/v1/stores' && method === 'POST') {
      const body = JSON.parse(init.body as string)
      return json({ name: opts.createdName ?? 'fileSearchStores/created', displayName: body.displayName })
    }
    if (u.pathname.endsWith('/documents') && method === 'GET') return json({ documents: opts.documents ?? [] })
    if (u.pathname.endsWith('/upload') && method === 'POST') {
      return json({ document: { name: 'fileSearchStores/x/documents/d', displayName: 'uploaded' } })
    }
    if (u.pathname === '/v1/search' && method === 'POST') return json(opts.search ?? { answer: '', passages: [] })
    return new Response(`unhandled ${method} ${u.pathname}`, { status: 404 })
  })
}

/** Cast the typed mock to KbFetch for injection (structurally compatible). */
const asFetch = (f: FetchMock): KbFetch => f as unknown as KbFetch

function bodies(f: FetchMock, predicate: (url: string, method: string) => boolean): Record<string, unknown>[] {
  return f.mock.calls
    .filter(([url, init]) => predicate(url, (init?.method ?? 'GET').toUpperCase()))
    .map(([, init]) => JSON.parse((init?.body as string) ?? '{}'))
}

describe('ensureSessionStore', () => {
  it('returns an existing store matched by deterministic display name (no create)', async () => {
    const f = kbRouter({
      stores: [{ name: 'fileSearchStores/existing', displayName: 'qm-paint-run1 john' }],
    })
    const r = await ensureSessionStore(config, 'paint', 'run1', 'John', asFetch(f))
    expect(r).toEqual({ ok: true, storeName: 'fileSearchStores/existing', created: false })
    // no POST /v1/stores happened
    expect(bodies(f, (_u, m) => m === 'POST')).toHaveLength(0)
  })

  it('creates a store with the canonical display name when none exists', async () => {
    const f = kbRouter({ stores: [], createdName: 'fileSearchStores/new' })
    const r = await ensureSessionStore(config, 'electrical', 'ext-9', 'Acme', asFetch(f))
    expect(r).toEqual({ ok: true, storeName: 'fileSearchStores/new', created: true })
    const created = bodies(f, (u, m) => u.endsWith('/v1/stores') && m === 'POST')
    expect(created[0].displayName).toBe('qm-electrical-ext-9 acme')
  })

  it('degrades to ok:false (never throws) when the list call fails', async () => {
    const f = kbRouter({ failOn: (u, m) => (u.endsWith('/v1/stores') && m === 'GET' ? 500 : null) })
    const r = await ensureSessionStore(config, 'paint', 'run1', null, asFetch(f))
    expect(r.ok).toBe(false)
  })
})

describe('addDocumentsToSessionStore', () => {
  it('uploads new files and skips ones already indexed by display name', async () => {
    const f = kbRouter({
      stores: [{ name: 'fileSearchStores/s1', displayName: 'qm-electrical-ext1' }],
      documents: [{ displayName: 'plan.pdf' }],
    })
    const r = await addDocumentsToSessionStore({
      config,
      estimator: 'electrical',
      sessionId: 'ext1',
      documents: [
        { name: 'plan.pdf', bytes: new Uint8Array([1, 2, 3]) },
        { name: 'result.pdf', bytes: new Uint8Array([4, 5, 6]) },
      ],
      fetchImpl: asFetch(f),
    })
    expect(r.ok).toBe(true)
    expect(r.uploaded).toBe(1)
    expect(r.skipped).toBe(1)
    const uploads = f.mock.calls.filter(
      ([u, i]) => u.endsWith('/upload') && (i?.method ?? '').toUpperCase() === 'POST',
    )
    expect(uploads).toHaveLength(1)
  })

  it('is a no-op (no network) when there are no documents', async () => {
    const f = kbRouter({})
    const r = await addDocumentsToSessionStore({
      config,
      estimator: 'paint',
      sessionId: 'run1',
      documents: [],
      fetchImpl: asFetch(f),
    })
    expect(r).toEqual({ ok: true, uploaded: 0, skipped: 0, errors: [] })
    expect(f.mock.calls).toHaveLength(0)
  })

  it('never throws when an upload fails — swallows and reports counts', async () => {
    const f = kbRouter({
      stores: [{ name: 'fileSearchStores/s1', displayName: 'qm-paint-run1' }],
      documents: [],
      failOn: (u, m) => (u.endsWith('/upload') && m === 'POST' ? 500 : null),
    })
    const r = await addDocumentsToSessionStore({
      config,
      estimator: 'paint',
      sessionId: 'run1',
      documents: [{ name: 'a.pdf', bytes: new Uint8Array([1]) }],
      fetchImpl: asFetch(f),
    })
    expect(r.ok).toBe(true)
    expect(r.uploaded).toBe(0)
    // the swallowed upload failure is now surfaced for logging
    expect(r.errors).toHaveLength(1)
    expect(r.errors[0]).toContain('a.pdf')
  })
})

describe('searchSessionStore', () => {
  it('searches the session store, defaults to the estimate-assistant system prompt, maps passages to citations', async () => {
    const f = kbRouter({
      stores: [{ name: 'fileSearchStores/s1', displayName: 'qm-paint-run1' }],
      search: {
        answer: 'The ceiling costs more because it is a larger area.',
        passages: [{ text: 'Ceiling 40 m2', page: 2, documentTitle: 'plan.pdf' }],
      },
    })
    const r = await searchSessionStore({
      config,
      estimator: 'paint',
      sessionId: 'run1',
      query: 'Why is the ceiling priced higher?',
      fetchImpl: asFetch(f),
    })
    expect(r.ok).toBe(true)
    expect(r.storeFound).toBe(true)
    expect(r.answer).toContain('larger area')
    expect(r.citations[0]).toEqual({ title: 'plan.pdf', page: 2, snippet: 'Ceiling 40 m2' })
    const searchBody = bodies(f, (u, m) => u.endsWith('/v1/search') && m === 'POST')[0]
    expect(searchBody.systemInstruction).toBe(ESTIMATOR_CHAT_SYSTEM)
    expect(searchBody.store).toBe('fileSearchStores/s1')
  })

  it('returns storeFound:false (and does not search) when the session has no store yet', async () => {
    const f = kbRouter({ stores: [] })
    const r = await searchSessionStore({
      config,
      estimator: 'electrical',
      sessionId: 'ext1',
      query: 'anything',
      fetchImpl: asFetch(f),
    })
    expect(r).toEqual({ ok: true, storeFound: false, answer: '', citations: [] })
    expect(bodies(f, (u) => u.endsWith('/v1/search'))).toHaveLength(0)
  })

  it('forwards a caller-supplied system instruction override', async () => {
    const f = kbRouter({
      stores: [{ name: 'fileSearchStores/s1', displayName: 'qm-paint-run1' }],
      search: { answer: 'ok', passages: [] },
    })
    await searchSessionStore({
      config,
      estimator: 'paint',
      sessionId: 'run1',
      query: 'q',
      systemInstruction: 'CUSTOM FRAMING',
      fetchImpl: asFetch(f),
    })
    const searchBody = bodies(f, (u, m) => u.endsWith('/v1/search') && m === 'POST')[0]
    expect(searchBody.systemInstruction).toBe('CUSTOM FRAMING')
  })

  it('degrades to ok:false (never throws) when the search call fails', async () => {
    const f = kbRouter({
      stores: [{ name: 'fileSearchStores/s1', displayName: 'qm-paint-run1' }],
      failOn: (u, m) => (u.endsWith('/v1/search') && m === 'POST' ? 502 : null),
    })
    const r = await searchSessionStore({ config, estimator: 'paint', sessionId: 'run1', query: 'q', fetchImpl: asFetch(f) })
    expect(r.ok).toBe(false)
    expect(r.storeFound).toBe(false)
  })
})
