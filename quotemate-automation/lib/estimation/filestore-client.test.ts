import { describe, it, expect } from 'vitest'
import {
  isFileStoreConfigured,
  resolveFileStoreConfig,
  bareStoreId,
  createFileStoreClient,
  FileStoreError,
  type FileStoreConfig,
} from './filestore-client'

// Minimal Response-like stub for the injected fetch.
function res(body: unknown, { ok = true, status = 200 }: { ok?: boolean; status?: number } = {}) {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  } as unknown as Response
}

type Call = { url: string; init: RequestInit | undefined }

function fakeFetch(handler: (url: string, init?: RequestInit) => Response) {
  const calls: Call[] = []
  const fn = (async (url: unknown, init?: RequestInit) => {
    calls.push({ url: String(url), init })
    return handler(String(url), init)
  }) as unknown as typeof fetch
  return { fn, calls }
}

const BASE = 'https://kb.example.test'
const KEY = 'secret-key'
function cfg(fetchImpl: typeof fetch): FileStoreConfig {
  return { baseUrl: BASE, apiKey: KEY, fetchImpl }
}

describe('isFileStoreConfigured', () => {
  it('is true only when both URL and key are present and non-blank', () => {
    expect(isFileStoreConfigured({ KB_FILESTORE_URL: BASE, KB_API_KEY: KEY })).toBe(true)
    expect(isFileStoreConfigured({ KB_FILESTORE_URL: BASE })).toBe(false)
    expect(isFileStoreConfigured({ KB_API_KEY: KEY })).toBe(false)
    expect(isFileStoreConfigured({ KB_FILESTORE_URL: '  ', KB_API_KEY: KEY })).toBe(false)
    expect(isFileStoreConfigured({})).toBe(false)
  })
})

describe('resolveFileStoreConfig', () => {
  it('strips trailing slashes and returns null when unconfigured', () => {
    const c = resolveFileStoreConfig({ KB_FILESTORE_URL: BASE + '/', KB_API_KEY: KEY })
    expect(c).not.toBeNull()
    expect(c!.baseUrl).toBe(BASE)
    expect(resolveFileStoreConfig({})).toBeNull()
  })
})

describe('bareStoreId', () => {
  it('reduces the full resource name to the bare id', () => {
    expect(bareStoreId('fileSearchStores/abc123')).toBe('abc123')
    expect(bareStoreId('abc123')).toBe('abc123')
  })
})

describe('createFileStoreClient', () => {
  it('createStore POSTs to /v1/stores with the api key and displayName', async () => {
    const { fn, calls } = fakeFetch(() => res({ name: 'fileSearchStores/s1' }))
    const out = await createFileStoreClient(cfg(fn)).createStore('run-1')
    expect(out).toEqual({ name: 'fileSearchStores/s1' })
    expect(calls[0].url).toBe(`${BASE}/v1/stores`)
    expect(calls[0].init?.method).toBe('POST')
    expect((calls[0].init?.headers as Record<string, string>)['x-api-key']).toBe(KEY)
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ displayName: 'run-1' })
  })

  it('uploadPdf POSTs multipart with field "file" to the bare store id', async () => {
    const { fn, calls } = fakeFetch(() => res({ indexed: true, document: { name: 'doc1', state: 'ACTIVE' } }))
    const out = await createFileStoreClient(cfg(fn)).uploadPdf(
      'fileSearchStores/s1',
      new Uint8Array([1, 2, 3]),
      'plan.pdf',
    )
    expect(out.document).toMatchObject({ name: 'doc1' })
    expect(calls[0].url).toBe(`${BASE}/v1/stores/s1/upload`)
    expect(calls[0].init?.method).toBe('POST')
    const body = calls[0].init?.body
    expect(body).toBeInstanceOf(FormData)
    const file = (body as FormData).get('file')
    expect(file).toBeInstanceOf(Blob)
    // multipart must NOT carry a hand-set content-type (boundary is derived)
    expect((calls[0].init?.headers as Record<string, string>)['content-type']).toBeUndefined()
  })

  it('search POSTs to /v1/search and defaults missing citations to []', async () => {
    const { fn, calls } = fakeFetch(() => res({ answer: 'persona text', citations: [{ snippet: 'GPO: 42' }] }))
    const out = await createFileStoreClient(cfg(fn)).search('fileSearchStores/s1', 'how many GPO?')
    expect(out.answer).toBe('persona text')
    expect(out.citations).toEqual([{ snippet: 'GPO: 42' }])
    expect(calls[0].url).toBe(`${BASE}/v1/search`)
    expect(JSON.parse(String(calls[0].init?.body))).toMatchObject({ store: 'fileSearchStores/s1', query: 'how many GPO?' })

    const { fn: fn2 } = fakeFetch(() => res({ answer: 'x' })) // no citations key
    const out2 = await createFileStoreClient(cfg(fn2)).search('s1', 'q')
    expect(out2.citations).toEqual([])
  })

  it('deleteStore DELETEs the bare id with ?force=true', async () => {
    const { fn, calls } = fakeFetch(() => res({ deleted: true }))
    const out = await createFileStoreClient(cfg(fn)).deleteStore('fileSearchStores/s1')
    expect(out).toEqual({ deleted: true })
    expect(calls[0].url).toBe(`${BASE}/v1/stores/s1?force=true`)
    expect(calls[0].init?.method).toBe('DELETE')
  })

  it('throws FileStoreError carrying the HTTP status on a non-ok response', async () => {
    const { fn } = fakeFetch(() => res('upstream boom', { ok: false, status: 503 }))
    await expect(createFileStoreClient(cfg(fn)).createStore('x')).rejects.toMatchObject({
      name: 'FileStoreError',
      status: 503,
    })
    await expect(createFileStoreClient(cfg(fn)).createStore('x')).rejects.toBeInstanceOf(FileStoreError)
  })
})
