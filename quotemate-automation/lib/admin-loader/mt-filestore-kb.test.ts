// Tests for the mt-filestore-kb HTTP client.
// Uses an injected fetch mock so no real network calls happen.

import { describe, expect, it, vi } from 'vitest'
import {
  KbHttpError,
  kbListStores,
  kbListDocuments,
  kbSearch,
  loadKbConfigFromEnv,
  parseSearchResponse,
  type KbConfig,
  type KbFetch,
} from './mt-filestore-kb'

const config: KbConfig = {
  url: 'https://kb.example.com',
  apiKey: 'test-api-key',
}

function mockOk(body: unknown): KbFetch {
  return vi.fn().mockResolvedValue(
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  ) as unknown as KbFetch
}

function mockStatus(status: number, body = 'error body'): KbFetch {
  return vi.fn().mockResolvedValue(
    new Response(body, { status }),
  ) as unknown as KbFetch
}

describe('kbListStores', () => {
  it('GETs /v1/stores with the api-key header', async () => {
    const f = mockOk({ stores: [{ name: 'fileSearchStores/abc' }] })
    const stores = await kbListStores(config, f)
    expect(stores).toHaveLength(1)
    expect(stores[0].name).toBe('fileSearchStores/abc')
    expect(f).toHaveBeenCalledOnce()
    const [url, init] = (f as any).mock.calls[0]
    expect(url).toBe('https://kb.example.com/v1/stores')
    expect((init.headers as Headers).get('x-api-key')).toBe('test-api-key')
    expect(init.method).toBe('GET')
  })

  it('returns empty array when API returns no stores key', async () => {
    const f = mockOk({})
    const stores = await kbListStores(config, f)
    expect(stores).toEqual([])
  })

  it('throws KbHttpError on a 401', async () => {
    const f = mockStatus(401, 'bad key')
    await expect(kbListStores(config, f)).rejects.toThrow(KbHttpError)
  })

  it('throws KbHttpError on a 500', async () => {
    const f = mockStatus(500)
    await expect(kbListStores(config, f)).rejects.toThrow(KbHttpError)
  })
})

describe('kbListDocuments', () => {
  it('GETs /v1/stores/{id}/documents and URL-encodes the id', async () => {
    const f = mockOk({ documents: [{ name: 'docA' }] })
    const docs = await kbListDocuments(config, 'fileSearchStores/abc', f)
    expect(docs).toHaveLength(1)
    const [url] = (f as any).mock.calls[0]
    expect(url).toBe(
      'https://kb.example.com/v1/stores/fileSearchStores%2Fabc/documents',
    )
  })

  it('throws when storeId is empty', async () => {
    const f = mockOk({ documents: [] })
    await expect(kbListDocuments(config, '', f)).rejects.toThrow('storeId is required')
  })

  it('returns empty array when documents key is missing', async () => {
    const f = mockOk({})
    const docs = await kbListDocuments(config, 'abc', f)
    expect(docs).toEqual([])
  })
})

describe('kbSearch', () => {
  it('POSTs the right body shape with the api-key header', async () => {
    const f = mockOk({ answer: 'hello world' })
    const r = await kbSearch(
      config,
      { store: 'fileSearchStores/abc', query: 'extract everything', model: 'gemini-2.5-pro' },
      f,
    )
    expect(r.answer).toBe('hello world')
    const [url, init] = (f as any).mock.calls[0]
    expect(url).toBe('https://kb.example.com/v1/search')
    expect(init.method).toBe('POST')
    expect((init.headers as Headers).get('x-api-key')).toBe('test-api-key')
    expect((init.headers as Headers).get('content-type')).toBe('application/json')
    const body = JSON.parse(init.body as string)
    expect(body.store).toBe('fileSearchStores/abc')
    expect(body.query).toBe('extract everything')
    expect(body.model).toBe('gemini-2.5-pro')
  })

  it('omits optional fields when not provided', async () => {
    const f = mockOk({ answer: 'ok' })
    await kbSearch(config, { store: 'abc', query: 'q' }, f)
    const [, init] = (f as any).mock.calls[0]
    const body = JSON.parse(init.body as string)
    expect(body.model).toBeUndefined()
    expect(body.metadataFilter).toBeUndefined()
  })

  it('includes metadataFilter when provided', async () => {
    const f = mockOk({ answer: 'ok' })
    await kbSearch(
      config,
      { store: 'abc', query: 'q', metadataFilter: 'author="X"' },
      f,
    )
    const [, init] = (f as any).mock.calls[0]
    const body = JSON.parse(init.body as string)
    expect(body.metadataFilter).toBe('author="X"')
  })

  it('throws when store is missing', async () => {
    const f = mockOk({})
    await expect(kbSearch(config, { store: '', query: 'q' }, f)).rejects.toThrow('store is required')
  })

  it('throws when query is missing', async () => {
    const f = mockOk({})
    await expect(kbSearch(config, { store: 'abc', query: '' }, f)).rejects.toThrow('query is required')
  })

  it('throws KbHttpError on a 404 store-not-found', async () => {
    const f = mockStatus(404, '{"error":"store not found"}')
    await expect(kbSearch(config, { store: 'abc', query: 'q' }, f)).rejects.toThrow(KbHttpError)
  })

  it('parses Gemini-shaped responses with candidates[].content.parts[].text', async () => {
    const geminiShape = {
      candidates: [
        {
          content: {
            parts: [{ text: 'part A' }, { text: 'part B' }],
          },
        },
      ],
    }
    const f = mockOk(geminiShape)
    const r = await kbSearch(config, { store: 'abc', query: 'q' }, f)
    expect(r.answer).toBe('part A\npart B')
  })

  it('parses passages array when present', async () => {
    const f = mockOk({
      answer: 'hello',
      passages: [
        { text: 'p1', page: 3, documentTitle: 'doc.pdf' },
        { snippet: 'p2', page: 7 },
      ],
    })
    const r = await kbSearch(config, { store: 'abc', query: 'q' }, f)
    expect(r.passages).toHaveLength(2)
    expect(r.passages[0].text).toBe('p1')
    expect(r.passages[0].page).toBe(3)
    expect(r.passages[1].text).toBe('p2')
  })
})

describe('parseSearchResponse', () => {
  it('handles a plain { answer } shape', () => {
    expect(parseSearchResponse({ answer: 'hi' }).answer).toBe('hi')
  })

  it('handles a { text } shape (older SDK fallback)', () => {
    expect(parseSearchResponse({ text: 'fallback' }).answer).toBe('fallback')
  })

  it('returns empty answer + empty passages for null', () => {
    const r = parseSearchResponse(null)
    expect(r.answer).toBe('')
    expect(r.passages).toEqual([])
  })

  it('preserves modelUsed when provided', () => {
    expect(parseSearchResponse({ answer: 'x', modelUsed: 'gemini-2.5-pro' }).modelUsed).toBe('gemini-2.5-pro')
    expect(parseSearchResponse({ answer: 'x', model: 'gemini-2.5-flash' }).modelUsed).toBe('gemini-2.5-flash')
  })
})

describe('loadKbConfigFromEnv', () => {
  it('reads KB_API_URL + KB_API_KEY', () => {
    const cfg = loadKbConfigFromEnv({
      KB_API_URL: 'https://kb.example.com',
      KB_API_KEY: 'k',
    })
    expect(cfg.url).toBe('https://kb.example.com')
    expect(cfg.apiKey).toBe('k')
  })

  it('falls back to MT_FILESTORE_KB_* aliases', () => {
    const cfg = loadKbConfigFromEnv({
      MT_FILESTORE_KB_URL: 'https://alt.example.com',
      MT_FILESTORE_KB_API_KEY: 'alt',
    })
    expect(cfg.url).toBe('https://alt.example.com')
    expect(cfg.apiKey).toBe('alt')
  })

  it('throws a clear error when KB_API_URL is missing', () => {
    expect(() => loadKbConfigFromEnv({ KB_API_KEY: 'k' } as any)).toThrow(/KB_API_URL/)
  })

  it('throws a clear error when KB_API_KEY is missing', () => {
    expect(() => loadKbConfigFromEnv({ KB_API_URL: 'https://x' } as any)).toThrow(/KB_API_KEY/)
  })
})
