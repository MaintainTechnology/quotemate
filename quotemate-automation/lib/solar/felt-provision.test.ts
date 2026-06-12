import { describe, it, expect, vi } from 'vitest'
import {
  deriveFeltStatus,
  buildFeltRecord,
  applySolarFeltMap,
  repairSolarFeltLayers,
  type SolarFeltRecord,
  type SolarFeltLayerState,
} from './felt-provision'
import { makeFixtureEstimate } from './__fixtures__/estimate'
import type { SupabaseClient } from '@supabase/supabase-js'

const DONE: SolarFeltLayerState = { id: 'l', status: 'completed' }
const PROC: SolarFeltLayerState = { id: 'l', status: 'processing' }
const FAIL: SolarFeltLayerState = { id: null, status: 'failed' }
const SKIP: SolarFeltLayerState = { id: null, status: 'skipped' }

describe('deriveFeltStatus', () => {
  it('all attempted completed → ready (skipped ignored)', () => {
    expect(deriveFeltStatus({ panels: DONE, planes: DONE, flux: SKIP, dsm: SKIP })).toBe('ready')
  })
  it('some completed, some processing/failed → partial', () => {
    expect(deriveFeltStatus({ panels: DONE, planes: PROC, flux: SKIP, dsm: SKIP })).toBe('partial')
    expect(deriveFeltStatus({ panels: DONE, planes: FAIL, flux: SKIP, dsm: SKIP })).toBe('partial')
  })
  it('nothing completed → failed', () => {
    expect(deriveFeltStatus({ panels: FAIL, planes: FAIL, flux: SKIP, dsm: SKIP })).toBe('failed')
    expect(deriveFeltStatus({ panels: SKIP, planes: SKIP, flux: SKIP, dsm: SKIP })).toBe('failed')
  })
})

describe('buildFeltRecord', () => {
  it('derives the embed url from the map id', () => {
    const rec = buildFeltRecord({
      mapId: 'm1',
      mapUrl: 'https://felt.com/map/x',
      thumbnailUrl: 't.png',
      status: 'ready',
    })
    expect(rec.embed_url).toBe('https://felt.com/embed/map/m1')
    expect(rec.layers.panels.status).toBe('skipped')
  })
  it('no map id → null embed url', () => {
    const rec = buildFeltRecord({ mapId: null, mapUrl: null, thumbnailUrl: null, status: 'failed' })
    expect(rec.embed_url).toBeNull()
  })
})

// ── applySolarFeltMap integration (fake supabase + fake Felt/Google) ──

type FakeRow = Record<string, unknown>

function makeFakeSupabase(row: FakeRow | null) {
  const updates: Array<Record<string, unknown>> = []
  const supabase = {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: row }),
        }),
      }),
      update: (payload: Record<string, unknown>) => {
        updates.push(payload)
        return { eq: async () => ({ error: null }) }
      },
    }),
  } as unknown as SupabaseClient
  return { supabase, updates }
}

/** Routes every HTTP call the provisioning pipeline makes. */
function makeFeltFetch(overrides: { failMapCreate?: boolean; layerStatus?: string } = {}) {
  const calls: string[] = []
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    calls.push(`${method} ${url}`)

    // Google dataLayers
    if (url.startsWith('https://dl.test/')) {
      return json({
        imageryQuality: 'HIGH',
        imageryDate: { year: 2025, month: 3, day: 14 },
        annualFluxUrl: 'https://tiff.test/flux',
        dsmUrl: 'https://tiff.test/dsm',
        maskUrl: 'https://tiff.test/mask',
        rgbUrl: 'https://tiff.test/rgb',
        monthlyFluxUrl: 'https://tiff.test/monthly',
        hourlyShadeUrls: [],
      })
    }
    // Raw GeoTIFF bytes
    if (url.startsWith('https://tiff.test/')) {
      return new Response(new Uint8Array([0x49, 0x49, 42, 0]), { status: 200 })
    }
    // Felt: map create
    if (url.endsWith('/api/v2/maps') && method === 'POST') {
      if (overrides.failMapCreate) return new Response('nope', { status: 500 })
      return json({ id: 'map1', url: 'https://felt.com/map/map1', thumbnail_url: 'thumb.png' })
    }
    // Felt: map delete
    if (/\/api\/v2\/maps\/[^/]+$/.test(url) && method === 'DELETE') {
      return new Response(null, { status: 204 })
    }
    // Felt: presigned upload request
    if (url.endsWith('/upload') && method === 'POST') {
      return json({
        url: 'https://s3.test/bucket',
        presigned_attributes: { key: 'k' },
        layer_id: `layer_${calls.filter((c) => c.includes('/upload')).length}`,
      })
    }
    // S3
    if (url.startsWith('https://s3.test/')) return new Response(null, { status: 204 })
    // Felt: layer status
    if (/\/layers\/[^/]+$/.test(url) && method === 'GET') {
      return json({ status: overrides.layerStatus ?? 'completed', progress: 100 })
    }
    // Felt: style update
    if (url.endsWith('/update_style')) return json({ ok: true })
    // Felt: elements
    if (url.endsWith('/elements')) return json({ ok: true })
    return new Response('unrouted: ' + url, { status: 404 })
  })
  return { fetchImpl, calls }
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

function makeFeltRow(overrides: FakeRow = {}): FakeRow {
  return {
    id: 'row1',
    estimate: makeFixtureEstimate(),
    address: '1 Test St, Sydney',
    state: 'NSW',
    postcode: '2570',
    quote_variant: 'felt',
    felt: null,
    ...overrides,
  }
}

const OPTS = (fetchImpl: typeof fetch) => ({
  forceEnabled: true,
  feltOpts: { apiKey: 'felt_k', fetchImpl },
  googleApiKey: 'goog_k',
  fetchImpl: fetchImpl as (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
  dataLayersBaseUrl: 'https://dl.test/get',
  pollAttempts: 2,
  pollIntervalMs: 1,
})

describe('applySolarFeltMap', () => {
  it('full happy path → ready record with all four layers styled', async () => {
    const { supabase, updates } = makeFakeSupabase(makeFeltRow())
    const { fetchImpl, calls } = makeFeltFetch()
    await applySolarFeltMap(
      supabase,
      { publicToken: 'tok', location: { lat: -33.8688, lng: 151.2093 } },
      OPTS(fetchImpl as unknown as typeof fetch),
    )

    // Two persists: provisioning, then final.
    expect(updates.length).toBe(2)
    const provisional = updates[0].felt as SolarFeltRecord
    expect(provisional.status).toBe('provisioning')
    expect(provisional.map_id).toBe('map1')
    expect(provisional.embed_url).toBe('https://felt.com/embed/map/map1')

    const final = updates[1].felt as SolarFeltRecord
    expect(final.status).toBe('ready')
    expect(final.layers.panels.status).toBe('completed')
    expect(final.layers.planes.status).toBe('completed')
    expect(final.layers.flux.status).toBe('completed')
    expect(final.layers.dsm.status).toBe('completed')
    expect(final.thumbnail_url).toBe('thumb.png')
    expect(final.provisioned_at).toBeTruthy()

    // FSL applied to each completed layer + property pin dropped.
    expect(calls.filter((c) => c.includes('/update_style'))).toHaveLength(4)
    expect(calls.some((c) => c.includes('/elements'))).toBe(true)
  })

  it('non-felt variant rows are untouched', async () => {
    const { supabase, updates } = makeFakeSupabase(makeFeltRow({ quote_variant: 'instant' }))
    const { fetchImpl } = makeFeltFetch()
    await applySolarFeltMap(
      supabase,
      { publicToken: 'tok', location: null },
      OPTS(fetchImpl as unknown as typeof fetch),
    )
    expect(updates).toHaveLength(0)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('map create failure → failed record, never throws', async () => {
    const { supabase, updates } = makeFakeSupabase(makeFeltRow())
    const { fetchImpl } = makeFeltFetch({ failMapCreate: true })
    await applySolarFeltMap(
      supabase,
      { publicToken: 'tok', location: { lat: -33.8, lng: 151.2 } },
      OPTS(fetchImpl as unknown as typeof fetch),
    )
    expect(updates).toHaveLength(1)
    const rec = updates[0].felt as SolarFeltRecord
    expect(rec.status).toBe('failed')
    expect(rec.error).toContain('Map create failed')
  })

  it('layers still processing at poll budget → partial', async () => {
    const { supabase, updates } = makeFakeSupabase(makeFeltRow())
    const { fetchImpl } = makeFeltFetch({ layerStatus: 'processing' })
    await applySolarFeltMap(
      supabase,
      { publicToken: 'tok', location: { lat: -33.8, lng: 151.2 } },
      OPTS(fetchImpl as unknown as typeof fetch),
    )
    const final = updates[updates.length - 1].felt as SolarFeltRecord
    expect(final.status).toBe('partial')
    expect(final.layers.panels.status).toBe('processing')
  })

  it('manual-path estimate (no panels, no google) → map + pin only, failed layers record', async () => {
    const estimate = makeFixtureEstimate({
      coverage_source: 'manual',
      roof: { ...makeFixtureEstimate().roof, source: 'manual', panels: [], planes: [] },
    })
    const { supabase, updates } = makeFakeSupabase(makeFeltRow({ estimate }))
    const { fetchImpl, calls } = makeFeltFetch()
    await applySolarFeltMap(
      supabase,
      { publicToken: 'tok', location: { lat: -33.8, lng: 151.2 } },
      OPTS(fetchImpl as unknown as typeof fetch),
    )
    const final = updates[updates.length - 1].felt as SolarFeltRecord
    // No layers attempted → 'failed' record, but the map + pin exist for
    // the satellite-only view (page still embeds when map_id present).
    expect(final.map_id).toBe('map1')
    expect(final.status).toBe('failed')
    expect(calls.some((c) => c.includes('/elements'))).toBe(true)
    expect(calls.some((c) => c.includes('/upload'))).toBe(false)
  })

  it('re-draft deletes the previous map first', async () => {
    const previous = buildFeltRecord({
      mapId: 'oldmap',
      mapUrl: 'https://felt.com/map/oldmap',
      thumbnailUrl: null,
      status: 'ready',
    })
    const { supabase } = makeFakeSupabase(makeFeltRow({ felt: previous }))
    const { fetchImpl, calls } = makeFeltFetch()
    await applySolarFeltMap(
      supabase,
      { publicToken: 'tok', location: { lat: -33.8, lng: 151.2 } },
      OPTS(fetchImpl as unknown as typeof fetch),
    )
    expect(calls.some((c) => c.startsWith('DELETE') && c.includes('/maps/oldmap'))).toBe(true)
  })

  it('no location anywhere → failed record without calling Felt', async () => {
    const estimate = makeFixtureEstimate()
    estimate.context.location = null
    const { supabase, updates } = makeFakeSupabase(makeFeltRow({ estimate }))
    const { fetchImpl } = makeFeltFetch()
    await applySolarFeltMap(
      supabase,
      { publicToken: 'tok', location: null },
      OPTS(fetchImpl as unknown as typeof fetch),
    )
    const rec = updates[0].felt as SolarFeltRecord
    expect(rec.status).toBe('failed')
    expect(rec.error).toContain('No location')
  })
})

describe('repairSolarFeltLayers', () => {
  it('styles late-completing layers and upgrades partial → ready', async () => {
    const partial: SolarFeltRecord = {
      ...buildFeltRecord({
        mapId: 'map1',
        mapUrl: 'u',
        thumbnailUrl: null,
        status: 'partial',
        layers: {
          panels: { id: 'lp', status: 'completed' },
          planes: { id: 'lm', status: 'processing' },
          flux: { id: null, status: 'skipped' },
          dsm: { id: null, status: 'skipped' },
        },
      }),
      status: 'partial',
    }
    const { supabase, updates } = makeFakeSupabase(
      makeFeltRow({ felt: partial }),
    )
    const { fetchImpl, calls } = makeFeltFetch({ layerStatus: 'completed' })
    const next = await repairSolarFeltLayers(
      supabase,
      { publicToken: 'tok' },
      OPTS(fetchImpl as unknown as typeof fetch),
    )
    expect(next).not.toBeNull()
    expect(next!.status).toBe('ready')
    expect(next!.layers.planes.status).toBe('completed')
    expect(calls.filter((c) => c.includes('/update_style'))).toHaveLength(1)
    expect(updates).toHaveLength(1)
  })

  it('ready records are left alone', async () => {
    const ready = buildFeltRecord({
      mapId: 'map1',
      mapUrl: 'u',
      thumbnailUrl: null,
      status: 'ready',
      layers: {
        panels: { id: 'lp', status: 'completed' },
        planes: { id: 'lm', status: 'completed' },
        flux: { id: null, status: 'skipped' },
        dsm: { id: null, status: 'skipped' },
      },
    })
    const { supabase, updates } = makeFakeSupabase(makeFeltRow({ felt: { ...ready, status: 'ready' } }))
    const { fetchImpl } = makeFeltFetch()
    const next = await repairSolarFeltLayers(
      supabase,
      { publicToken: 'tok' },
      OPTS(fetchImpl as unknown as typeof fetch),
    )
    expect(next).toBeNull()
    expect(updates).toHaveLength(0)
  })
})
