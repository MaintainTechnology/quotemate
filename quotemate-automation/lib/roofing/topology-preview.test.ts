import { describe, expect, it } from 'vitest'
import {
  TOPOLOGY_PREVIEW_DISCLAIMER,
  topologyPreviewLocation,
  topologyPreviewStructures,
} from './topology-preview'

describe('topologyPreviewStructures', () => {
  it('projects only dashboard-safe main-dwelling selection fields', () => {
    const structures = topologyPreviewStructures({
      structures: [
        {
          buildingId: 'house-a',
          role: 'primary',
          label: 'House',
          metrics: {
            form: 'hip',
            footprint_m2: 156.4,
            capture_date: '2025-02-14',
            public_token: 'must-not-leak',
          },
          price: { tiers: [{ inc_gst: 9999 }] },
        },
      ],
    })

    expect(structures).toEqual([
      {
        structureIndex: 1,
        hasBuildingId: true,
        label: 'House',
        role: 'primary',
        form: 'hip',
        footprintM2: 156.4,
        captureDate: '2025-02-14',
      },
    ])
    expect(JSON.stringify(structures)).not.toContain('must-not-leak')
    expect(JSON.stringify(structures)).not.toContain('9999')
  })

  it('does not guess from malformed or legacy quote payloads', () => {
    expect(topologyPreviewStructures(null)).toEqual([])
    expect(topologyPreviewStructures({ structures: [{}] })).toEqual([])
  })

  it('normalizes unknown forms and carries a clear non-pricing disclaimer', () => {
    const structures = topologyPreviewStructures({
      structures: [{ role: 'secondary', metrics: { form: 'unrecognised', footprint_m2: -5 } }],
    })
    expect(structures[0]).toMatchObject({ form: 'unknown', footprintM2: null })
    expect(TOPOLOGY_PREVIEW_DISCLAIMER).toMatch(/never used in pricing/i)
  })

  it('does not echo provider URLs or key-shaped values through structure fields', () => {
    const providerUrl = 'https://solar.googleapis.com/v1/dataLayers?key=AIzaSyDangerousExample'
    const schemeRelativeProviderUrl = '//solar.googleapis.com/v1/dataLayers'
    const googleKey = 'AIzaSyDangerousExample'
    const stripeSecret = 'sk_live_exampleSensitiveValue'
    const structures = topologyPreviewStructures({
      structures: [
        {
          buildingId: providerUrl,
          role: 'primary',
          label: providerUrl,
          metrics: {
            buildingId: googleKey,
            form: 'hip',
            footprint_m2: 120,
            capture_date: '2025-02-30',
          },
        },
        {
          buildingId: stripeSecret,
          role: 'secondary',
          label: schemeRelativeProviderUrl,
          metrics: {
            form: 'gable',
            footprint_m2: 30,
            capture_date: 'not-a-date',
          },
        },
      ],
    })

    expect(structures).toMatchObject([
      {
        hasBuildingId: false,
        label: 'Main dwelling',
        captureDate: null,
      },
      {
        hasBuildingId: false,
        label: 'Secondary structure 2',
        captureDate: null,
      },
    ])

    const rendered = JSON.stringify(structures)
    for (const sensitiveValue of [
      providerUrl,
      schemeRelativeProviderUrl,
      googleKey,
      stripeSecret,
      'solar.googleapis.com',
    ]) {
      expect(rendered).not.toContain(sensitiveValue)
    }
  })

  it('only returns a real YYYY-MM-DD capture date and a safe opaque ID presence flag', () => {
    const structures = topologyPreviewStructures({
      structures: [
        {
          buildingId: 'bldaea00f0a464f#1',
          role: 'primary',
          label: 'House #1',
          metrics: { form: 'hip', capture_date: '2024-02-29' },
        },
        {
          buildingId: 'bld-2',
          role: 'secondary',
          label: 'Garage',
          metrics: { form: 'gable', capture_date: '2025-02-14T12:00:00Z' },
        },
        {
          buildingId: 'bld-3',
          role: 'secondary',
          label: 'Shed',
          metrics: { form: 'gable', capture_date: '9999-01-01' },
        },
      ],
    })

    expect(structures.map(({ hasBuildingId, captureDate }) => ({ hasBuildingId, captureDate }))).toEqual([
      { hasBuildingId: true, captureDate: '2024-02-29' },
      { hasBuildingId: true, captureDate: null },
      { hasBuildingId: true, captureDate: null },
    ])
  })
})

describe('topologyPreviewLocation', () => {
  it('only exposes an ordinary AU address projection, never URL or key-shaped values', () => {
    expect(topologyPreviewLocation({
      address: '7 Example Street',
      postcode: '4000',
      state: 'qld',
    })).toEqual({ address: '7 Example Street', postcode: '4000', state: 'QLD' })

    const unsafe = topologyPreviewLocation({
      address: 'https://solar.googleapis.com/v1/dataLayers?key=AIzaSyDangerousExample',
      postcode: 'token-123',
      state: 'secret',
    })
    expect(unsafe).toEqual({ address: null, postcode: null, state: null })
    expect(JSON.stringify(unsafe)).not.toContain('AIza')
  })
})
