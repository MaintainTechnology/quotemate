import { describe, expect, it, vi } from 'vitest'

// The production module uses Next's server-only marker. Unit tests exercise
// its pure transport seam in Node, so replace only that marker package.
vi.mock('server-only', () => ({}))

import {
  acquireGoogleSolarImageryLayers,
  isGoogleSolarDataLayersTopologyEnabled,
  parseGoogleSolarDataLayersMetadata,
  type GoogleSolarTopologySourceApproval,
  type GoogleSolarDataLayersTransport,
} from './google-solar-data-layers.server'

const ENABLED_ENV = {
  ROOFING_EDGE_ANALYSIS_ENABLED: 'true',
  ROOFING_GOOGLE_SOLAR_DATA_LAYERS_ENABLED: 'true',
} as const

const LAYER_URLS = {
  dsm: 'https://solar.googleapis.com/v1/geoTiff:get?layer=dsm',
  rgb: 'https://solar.googleapis.com/v1/geoTiff:get?layer=rgb',
  mask: 'https://solar.googleapis.com/v1/geoTiff:get?layer=mask',
} as const

const APPROVED_SOURCE: GoogleSolarTopologySourceApproval = {
  tenantId: 'tenant-1',
  sourceApprovalId: 'approval-1',
  geometrySource: 'approved_google_solar',
  commercialApprovalReference: 'google-solar-roofing-approval-2026',
  approvalStatus: 'active',
  allowsDerivedGeometry: true,
  retentionMode: 'none',
  retentionExpiresAt: null,
}

function dataLayersBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    imageryQuality: 'HIGH',
    imageryDate: { year: 2025, month: 2, day: 14 },
    imageryProcessedDate: { year: 2025, month: 2, day: 20 },
    dsmUrl: LAYER_URLS.dsm,
    rgbUrl: LAYER_URLS.rgb,
    maskUrl: LAYER_URLS.mask,
    // A response may include this field, but this seam never downloads it.
    annualFluxUrl: 'https://solar.googleapis.com/v1/geoTiff:get?layer=annual-flux',
    ...overrides,
  }
}

function fixtureTransport(
  body: Record<string, unknown> = dataLayersBody(),
): { transport: GoogleSolarDataLayersTransport; requests: Request[] } {
  const requests: Request[] = []
  const transport = vi.fn(async (request: Request) => {
    requests.push(request)
    const url = new URL(request.url)
    if (url.pathname === '/v1/dataLayers:get') {
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    if (url.pathname === '/v1/geoTiff:get') {
      return new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { 'Content-Type': 'image/tiff' },
      })
    }
    return new Response('', { status: 404 })
  })
  return { transport, requests }
}

function requestInput(transport: GoogleSolarDataLayersTransport) {
  return {
    location: { latitude: -27.5104, longitude: 153.0667 },
    radiusMeters: 75,
    environment: ENABLED_ENV,
    sourceApproval: APPROVED_SOURCE,
    transport,
  }
}

describe('Google Solar topology Data Layers feature gate', () => {
  it('requires both the topology-wide and Google-specific flags, never the pitch enrichment flag', () => {
    expect(isGoogleSolarDataLayersTopologyEnabled({})).toBe(false)
    expect(
      isGoogleSolarDataLayersTopologyEnabled({
        ROOFING_SOLAR_ENRICHMENT: 'true',
        ROOFING_EDGE_ANALYSIS_ENABLED: 'true',
      }),
    ).toBe(false)
    expect(
      isGoogleSolarDataLayersTopologyEnabled({
        ROOFING_GOOGLE_SOLAR_DATA_LAYERS_ENABLED: 'true',
      }),
    ).toBe(false)
    expect(isGoogleSolarDataLayersTopologyEnabled(ENABLED_ENV)).toBe(true)
  })

  it('does not invoke its injected transport while disabled', async () => {
    const transport = vi.fn<GoogleSolarDataLayersTransport>(async () => {
      throw new Error('transport must not be called')
    })

    const result = await acquireGoogleSolarImageryLayers({
      ...requestInput(transport),
      environment: {},
    })

    expect(result).toMatchObject({ ok: false, code: 'feature_disabled' })
    expect(transport).not.toHaveBeenCalled()
  })

  it('does not treat enabled flags or a Solar API capability as approval', async () => {
    const transport = vi.fn<GoogleSolarDataLayersTransport>(async () => {
      throw new Error('transport must not be called')
    })

    const result = await acquireGoogleSolarImageryLayers({
      ...requestInput(transport),
      sourceApproval: null,
    })

    expect(result).toMatchObject({ ok: false, code: 'source_access_denied' })
    expect(transport).not.toHaveBeenCalled()
  })

  it('rejects an expired recorded approval context before transport', async () => {
    const transport = vi.fn<GoogleSolarDataLayersTransport>(async () => {
      throw new Error('transport must not be called')
    })

    const result = await acquireGoogleSolarImageryLayers({
      ...requestInput(transport),
      now: new Date('2026-07-15T00:00:00.000Z'),
      sourceApproval: {
        ...APPROVED_SOURCE,
        retentionMode: 'expires',
        retentionExpiresAt: '2026-07-14T23:59:59.000Z',
      },
    })

    expect(result).toMatchObject({ ok: false, code: 'source_access_denied' })
    expect(transport).not.toHaveBeenCalled()
  })
})

describe('Google Solar topology Data Layers transport/parser seam', () => {
  it('requests only IMAGERY_LAYERS and returns transient DSM/RGB/mask bytes without provider URLs', async () => {
    const { transport, requests } = fixtureTransport()

    const result = await acquireGoogleSolarImageryLayers(requestInput(transport))

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.acquisition.metadata).toEqual({
      source: 'approved_google_solar',
      view: 'IMAGERY_LAYERS',
      location: { latitude: -27.5104, longitude: 153.0667 },
      radiusMeters: 75,
      pixelSizeMeters: 0.1,
      requiredQuality: 'HIGH',
      imageryQuality: 'HIGH',
      imageryDate: '2025-02-14',
      imageryProcessedDate: '2025-02-20',
    })
    expect([...new Uint8Array(result.acquisition.rasters.dsm)]).toEqual([1, 2, 3])
    expect([...new Uint8Array(result.acquisition.rasters.rgb)]).toEqual([1, 2, 3])
    expect([...new Uint8Array(result.acquisition.rasters.mask)]).toEqual([1, 2, 3])
    expect(Object.keys(result.acquisition)).toEqual(['metadata', 'rasters'])
    expect(JSON.stringify(result.acquisition)).not.toContain('geoTiff:get')
    expect(JSON.stringify(result.acquisition)).not.toContain('annual-flux')

    expect(requests).toHaveLength(4)
    const metadataUrl = new URL(requests[0].url)
    expect(metadataUrl.origin).toBe('https://solar.googleapis.com')
    expect(metadataUrl.pathname).toBe('/v1/dataLayers:get')
    expect(metadataUrl.searchParams.get('view')).toBe('IMAGERY_LAYERS')
    expect(metadataUrl.searchParams.get('radiusMeters')).toBe('75')
    expect(metadataUrl.searchParams.get('pixelSizeMeters')).toBe('0.1')
    expect(metadataUrl.searchParams.get('requiredQuality')).toBe('HIGH')
    expect(metadataUrl.searchParams.get('location.latitude')).toBe('-27.5104000')
    expect(metadataUrl.searchParams.get('location.longitude')).toBe('153.0667000')
    expect(metadataUrl.searchParams.has('key')).toBe(false)
    expect(requests[0].headers.get('authorization')).toBeNull()

    const downloadedLayers = requests.slice(1).map((request) => {
      const url = new URL(request.url)
      return url.searchParams.get('layer')
    })
    expect(downloadedLayers.sort()).toEqual(['dsm', 'mask', 'rgb'])
    expect(downloadedLayers).not.toContain('annual-flux')
  })

  it('parses safe metadata only and keeps temporary provider URLs private', () => {
    const parsed = parseGoogleSolarDataLayersMetadata(dataLayersBody(), {
      location: { latitude: -27.5104, longitude: 153.0667 },
      radiusMeters: 75,
    })

    expect(parsed).toMatchObject({ ok: true })
    if (!parsed.ok) return
    expect(parsed.metadata.imageryDate).toBe('2025-02-14')
    expect(JSON.stringify(parsed)).not.toContain('geoTiff:get')
    expect(JSON.stringify(parsed)).not.toContain('annual-flux')
    expect('candidates' in parsed.metadata).toBe(false)
    expect('edges' in parsed.metadata).toBe(false)
  })

  it('rejects invalid coordinates and unsupported radius/pixel-size combinations before transport', async () => {
    const transport = vi.fn<GoogleSolarDataLayersTransport>(async () => {
      throw new Error('transport must not be called')
    })

    const invalidCoordinate = await acquireGoogleSolarImageryLayers({
      ...requestInput(transport),
      location: { latitude: 91, longitude: 153.0667 },
    })
    const invalidRadius = await acquireGoogleSolarImageryLayers({
      ...requestInput(transport),
      radiusMeters: 101,
      pixelSizeMeters: 0.1,
    })

    expect(invalidCoordinate).toMatchObject({ ok: false, code: 'invalid_request' })
    expect(invalidRadius).toMatchObject({ ok: false, code: 'invalid_request' })
    expect(transport).not.toHaveBeenCalled()
  })

  it('rejects below-minimum imagery quality and untrusted layer URLs before downloads', async () => {
    const lowQuality = fixtureTransport(dataLayersBody({ imageryQuality: 'MEDIUM' }))
    const untrustedUrl = fixtureTransport(
      dataLayersBody({ dsmUrl: 'https://not-google.invalid/geoTiff:get?layer=dsm' }),
    )

    const lowQualityResult = await acquireGoogleSolarImageryLayers(
      requestInput(lowQuality.transport),
    )
    const untrustedUrlResult = await acquireGoogleSolarImageryLayers(
      requestInput(untrustedUrl.transport),
    )

    expect(lowQualityResult).toMatchObject({ ok: false, code: 'invalid_response' })
    expect(untrustedUrlResult).toMatchObject({ ok: false, code: 'invalid_response' })
    // Both performed only the metadata request; neither followed a URL.
    expect(lowQuality.requests).toHaveLength(1)
    expect(untrustedUrl.requests).toHaveLength(1)
  })
})
