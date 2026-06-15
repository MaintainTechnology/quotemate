import { describe, expect, it, vi } from 'vitest'
import { supplementTakeoffViaKb } from './kb-runner'
import type { KbConfig, KbFetch } from '../admin-loader/mt-filestore-kb'
import type { PaintTakeoffItem } from './types'

const config: KbConfig = { url: 'https://kb.example.com', apiKey: 'k' }

function item(overrides: Partial<PaintTakeoffItem> = {}): PaintTakeoffItem {
  return {
    surface: 'Retail ceiling',
    room: 'Retail',
    substrate: 'plasterboard',
    system: 'low_sheen',
    unit: 'm2',
    quantity: 100,
    coats: 2,
    confidence: 'low',
    source: 'plan',
    ...overrides,
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

/** A fetch mock that routes by URL + method and records every call. */
function routerFetch(opts: { searchAnswer?: unknown; searchStatus?: number }): {
  fetch: KbFetch
  calls: { url: string; method: string }[]
} {
  const calls: { url: string; method: string }[] = []
  const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url)
    const method = (init?.method ?? 'GET').toUpperCase()
    calls.push({ url: u, method })
    if (method === 'POST' && u.endsWith('/v1/stores')) {
      return json({ name: 'fileSearchStores/temp1', displayName: 'paint-temp' })
    }
    if (method === 'POST' && u.includes('/upload')) {
      return json({ name: 'fileSearchStores/temp1/documents/d1', state: 'active' })
    }
    if (method === 'GET' && u.includes('/documents')) {
      return json({ documents: [{ name: 'fileSearchStores/temp1/documents/d1', state: 'active' }] })
    }
    if (method === 'POST' && u.endsWith('/v1/search')) {
      const status = opts.searchStatus ?? 200
      return json(opts.searchAnswer ?? { answer: '' }, status)
    }
    if (method === 'DELETE' && u.includes('/v1/stores/')) {
      return json({ deleted: true })
    }
    return json({}, 404)
  }) as unknown as KbFetch
  return { fetch, calls }
}

const fastDeps = (fetchImpl: KbFetch) => ({
  fetchImpl,
  sleep: async () => {},
  maxIndexWaitMs: 10,
  pollIntervalMs: 5,
})

describe('supplementTakeoffViaKb', () => {
  it('creates a store, uploads, searches, applies findings, and deletes the store', async () => {
    const answer = JSON.stringify({
      missing_items: [{ surface: 'Dock soffit', room: 'BOH', unit: 'm2', quantity: 60, page: 9 }],
      corrections: [{ surface: 'Retail ceiling', room: 'Retail', field: 'quantity', value: 250 }],
    })
    const { fetch, calls } = routerFetch({ searchAnswer: { answer } })
    const res = await supplementTakeoffViaKb({
      config,
      items: [item({ confidence: 'low' })],
      displayName: 'paint-temp-run1',
      files: [{ name: 'plan.pdf', bytes: Buffer.from('PDF') }],
      deps: fastDeps(fetch),
    })

    expect(res.usedKb).toBe(true)
    // low-confidence quantity filled, missing item appended
    expect(res.items.find((i) => i.surface === 'Retail ceiling')!.quantity).toBe(250)
    expect(res.items.some((i) => i.surface === 'Dock soffit')).toBe(true)
    expect(res.flags.length).toBeGreaterThan(0)

    const methods = calls.map((c) => `${c.method} ${c.url}`)
    expect(methods.some((m) => m.startsWith('POST') && m.endsWith('/v1/stores'))).toBe(true)
    expect(methods.some((m) => m.includes('/upload'))).toBe(true)
    expect(methods.some((m) => m.includes('/v1/search'))).toBe(true)
    // store deleted with force
    expect(calls.some((c) => c.method === 'DELETE' && c.url.includes('force=true'))).toBe(true)
  })

  it('still deletes the temp store when the search step fails', async () => {
    const { fetch, calls } = routerFetch({ searchStatus: 500, searchAnswer: 'boom' })
    const items = [item({ quantity: 100 })]
    const res = await supplementTakeoffViaKb({
      config,
      items,
      displayName: 'paint-temp-run2',
      files: [{ name: 'plan.pdf', bytes: Buffer.from('PDF') }],
      deps: fastDeps(fetch),
    })

    expect(res.usedKb).toBe(false)
    expect(res.items).toEqual(items) // unchanged fallback
    expect(calls.some((c) => c.method === 'DELETE' && c.url.includes('force=true'))).toBe(true)
  })

  it('skips entirely when there are no files', async () => {
    const { fetch, calls } = routerFetch({})
    const items = [item()]
    const res = await supplementTakeoffViaKb({
      config,
      items,
      displayName: 'paint-temp-run3',
      files: [],
      deps: fastDeps(fetch),
    })
    expect(res.usedKb).toBe(false)
    expect(res.items).toEqual(items)
    expect(calls).toHaveLength(0)
  })
})
