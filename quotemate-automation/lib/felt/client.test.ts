import { describe, it, expect, vi } from 'vitest'
import {
  feltTabEnabled,
  feltEmbedUrl,
  createFeltMap,
  deleteFeltMap,
  uploadFeltLayerBuffer,
  uploadFeltGeoJson,
  getFeltLayerStatus,
  updateFeltLayerStyle,
  createFeltElements,
  __test_only__,
} from './client'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('feltTabEnabled', () => {
  it('requires the env gate AND a key', () => {
    expect(feltTabEnabled({ FELT_TAB_ENABLED: 'true', FELT_API_KEY: 'k' })).toBe(true)
    expect(feltTabEnabled({ FELT_TAB_ENABLED: '1', FELT_API_KEY: 'k' })).toBe(true)
    expect(feltTabEnabled({ FELT_TAB_ENABLED: 'true' })).toBe(false)
    expect(feltTabEnabled({ FELT_API_KEY: 'k' })).toBe(false)
    expect(feltTabEnabled({ FELT_TAB_ENABLED: 'false', FELT_API_KEY: 'k' })).toBe(false)
    expect(feltTabEnabled({})).toBe(false)
  })
})

describe('feltEmbedUrl', () => {
  it('builds the tokenless embed URL', () => {
    expect(feltEmbedUrl('AbC123')).toBe('https://felt.com/embed/map/AbC123')
  })
})

describe('createFeltMap', () => {
  it('creates a satellite view_only map by default', async () => {
    const fetchImpl = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      expect(String(url)).toBe('https://felt.com/api/v2/maps')
      const body = JSON.parse(String(init?.body))
      expect(body.basemap).toBe('satellite')
      expect(body.public_access).toBe('view_only')
      expect(body.zoom).toBe(20)
      return jsonResponse({ id: 'map1', url: 'https://felt.com/map/x', thumbnail_url: 't.png' })
    })
    const res = await createFeltMap(
      { title: 'Solar — Test', lat: -33.8, lon: 151.2 },
      { apiKey: 'k', fetchImpl: fetchImpl as unknown as typeof fetch },
    )
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.data.id).toBe('map1')
      expect(res.data.thumbnail_url).toBe('t.png')
    }
  })

  it('sends the Bearer key', async () => {
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string>
      expect(headers.Authorization).toBe('Bearer secret')
      return jsonResponse({ id: 'map1' })
    })
    const res = await createFeltMap(
      { title: 't', lat: 0, lon: 0 },
      { apiKey: 'secret', fetchImpl: fetchImpl as unknown as typeof fetch },
    )
    expect(res.ok).toBe(true)
  })

  it('missing key → disabled, never throws', async () => {
    const original = process.env.FELT_API_KEY
    delete process.env.FELT_API_KEY
    try {
      const res = await createFeltMap({ title: 't', lat: 0, lon: 0 }, {})
      expect(res.ok).toBe(false)
      if (!res.ok) expect(res.code).toBe('disabled')
    } finally {
      if (original !== undefined) process.env.FELT_API_KEY = original
    }
  })

  it('HTTP error → http_error result', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ errors: [] }, 401))
    const res = await createFeltMap(
      { title: 't', lat: 0, lon: 0 },
      { apiKey: 'k', fetchImpl: fetchImpl as unknown as typeof fetch },
    )
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.code).toBe('http_error')
  })

  it('network error → network_error result', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('boom')
    })
    const res = await createFeltMap(
      { title: 't', lat: 0, lon: 0 },
      { apiKey: 'k', fetchImpl: fetchImpl as unknown as typeof fetch },
    )
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.code).toBe('network_error')
  })

  it('response without id → invalid_response', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ nope: true }))
    const res = await createFeltMap(
      { title: 't', lat: 0, lon: 0 },
      { apiKey: 'k', fetchImpl: fetchImpl as unknown as typeof fetch },
    )
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.code).toBe('invalid_response')
  })
})

describe('uploadFeltLayerBuffer', () => {
  it('two-step presigned upload: form fields then file last', async () => {
    const calls: string[] = []
    const fetchImpl = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push(String(url))
      if (String(url).endsWith('/upload')) {
        return jsonResponse({
          url: 'https://s3.example.com/bucket',
          presigned_attributes: { key: 'abc', policy: 'p' },
          layer_id: 'layer9',
        })
      }
      // S3 step — verify the form has the file appended after attrs.
      const form = init?.body as FormData
      const keys = [...form.keys()]
      expect(keys[keys.length - 1]).toBe('file')
      return new Response(null, { status: 204 })
    })
    const res = await uploadFeltLayerBuffer(
      {
        mapId: 'm1',
        layerName: 'Panels',
        fileName: 'panels.geojson',
        bytes: new TextEncoder().encode('{}'),
        contentType: 'application/geo+json',
      },
      { apiKey: 'k', fetchImpl: fetchImpl as unknown as typeof fetch },
    )
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.data.layerId).toBe('layer9')
    expect(calls).toHaveLength(2)
  })

  it('rejects empty and oversized buffers without calling Felt', async () => {
    const fetchImpl = vi.fn()
    const empty = await uploadFeltLayerBuffer(
      { mapId: 'm', layerName: 'x', fileName: 'x', bytes: new Uint8Array(0), contentType: 'a/b' },
      { apiKey: 'k', fetchImpl: fetchImpl as unknown as typeof fetch },
    )
    expect(empty.ok).toBe(false)
    if (!empty.ok) expect(empty.code).toBe('too_large')

    const big = await uploadFeltLayerBuffer(
      {
        mapId: 'm',
        layerName: 'x',
        fileName: 'x',
        bytes: new Uint8Array(__test_only__.MAX_UPLOAD_BYTES + 1),
        contentType: 'a/b',
      },
      { apiKey: 'k', fetchImpl: fetchImpl as unknown as typeof fetch },
    )
    expect(big.ok).toBe(false)
    if (!big.ok) expect(big.code).toBe('too_large')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('incomplete presign response → invalid_response', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ layer_id: 'l' }))
    const res = await uploadFeltLayerBuffer(
      { mapId: 'm', layerName: 'x', fileName: 'x', bytes: new Uint8Array(2), contentType: 'a/b' },
      { apiKey: 'k', fetchImpl: fetchImpl as unknown as typeof fetch },
    )
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.code).toBe('invalid_response')
  })

  it('S3 failure → http_error', async () => {
    const fetchImpl = vi.fn(async (url: RequestInfo | URL) => {
      if (String(url).endsWith('/upload')) {
        return jsonResponse({
          url: 'https://s3.example.com/b',
          presigned_attributes: { k: 'v' },
          layer_id: 'l1',
        })
      }
      return new Response('denied', { status: 403 })
    })
    const res = await uploadFeltLayerBuffer(
      { mapId: 'm', layerName: 'x', fileName: 'x', bytes: new Uint8Array(2), contentType: 'a/b' },
      { apiKey: 'k', fetchImpl: fetchImpl as unknown as typeof fetch },
    )
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.code).toBe('http_error')
  })
})

describe('uploadFeltGeoJson', () => {
  it('serializes the FeatureCollection into the buffer upload', async () => {
    const fetchImpl = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      if (String(url).endsWith('/upload')) {
        return jsonResponse({
          url: 'https://s3.example.com/b',
          presigned_attributes: { k: 'v' },
          layer_id: 'l2',
        })
      }
      const form = init?.body as FormData
      const file = form.get('file') as File
      const text = await file.text()
      expect(JSON.parse(text)).toEqual({ type: 'FeatureCollection', features: [] })
      return new Response(null, { status: 204 })
    })
    const res = await uploadFeltGeoJson(
      {
        mapId: 'm',
        layerName: 'Panels',
        fileName: 'panels.geojson',
        geojson: { type: 'FeatureCollection', features: [] },
      },
      { apiKey: 'k', fetchImpl: fetchImpl as unknown as typeof fetch },
    )
    expect(res.ok).toBe(true)
  })
})

describe('getFeltLayerStatus', () => {
  it('normalises known statuses and progress', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ status: 'completed', progress: 100 }))
    const res = await getFeltLayerStatus(
      { mapId: 'm', layerId: 'l' },
      { apiKey: 'k', fetchImpl: fetchImpl as unknown as typeof fetch },
    )
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.data.status).toBe('completed')
      expect(res.data.progress).toBe(100)
    }
  })

  it('unknown status string → unknown', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ status: 'wat' }))
    const res = await getFeltLayerStatus(
      { mapId: 'm', layerId: 'l' },
      { apiKey: 'k', fetchImpl: fetchImpl as unknown as typeof fetch },
    )
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.data.status).toBe('unknown')
  })
})

describe('updateFeltLayerStyle', () => {
  it('POSTs the FSL under a style key', async () => {
    const fetchImpl = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      expect(String(url)).toContain('/maps/m/layers/l/update_style')
      const body = JSON.parse(String(init?.body))
      expect(body.style.type).toBe('numeric')
      return jsonResponse({ ok: true })
    })
    const res = await updateFeltLayerStyle(
      { mapId: 'm', layerId: 'l', style: { type: 'numeric' } },
      { apiKey: 'k', fetchImpl: fetchImpl as unknown as typeof fetch },
    )
    expect(res.ok).toBe(true)
  })
})

describe('deleteFeltMap / createFeltElements', () => {
  it('delete returns ok on 204', async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 204 }))
    const res = await deleteFeltMap('m1', {
      apiKey: 'k',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(res.ok).toBe(true)
  })

  it('elements POST forwards the FeatureCollection', async () => {
    const fetchImpl = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      expect(String(url)).toContain('/maps/m1/elements')
      const body = JSON.parse(String(init?.body))
      expect(body.type).toBe('FeatureCollection')
      return jsonResponse({ ok: true })
    })
    const res = await createFeltElements(
      { mapId: 'm1', featureCollection: { type: 'FeatureCollection', features: [] } },
      { apiKey: 'k', fetchImpl: fetchImpl as unknown as typeof fetch },
    )
    expect(res.ok).toBe(true)
  })
})
