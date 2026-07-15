import { describe, expect, it } from 'vitest'
import { priceMultiRoof } from './pricing'
import {
  confirmMainDwellingSelection,
  createReadOnlyRoofEdgeAnalysis,
  type CreateReadOnlyRoofEdgeAnalysisInput,
  type RoofEdgeCandidate,
} from './edge-analysis'
import {
  evaluateRoofingEdgeAnalysisAccess,
  isRoofingEdgeAnalysisEnabled,
} from './edge-analysis-config'
import {
  isRoofEdgeAnalysisReadable,
  purgeExpiredRoofEdgeAnalysis,
} from './edge-analysis-retention'
import {
  ROOF_TOPOLOGY_BENCHMARK_FIXTURES,
  REQUIRED_ROOF_TOPOLOGY_BENCHMARK_SCENARIOS,
} from './edge-analysis-fixtures'
import type { RoofMetrics, RoofUserInputs } from './types'

const NOW = new Date('2026-07-15T00:00:00.000Z')

function metrics(overrides: Partial<RoofMetrics> = {}): RoofMetrics {
  return {
    footprint_m2: 180,
    sloped_area_m2: 200,
    storeys: 1,
    form: 'hip',
    hips: 4,
    valleys: 0,
    ridge_lm: 12,
    polygon_geojson: null,
    capture_date: '2026-06-01',
    ...overrides,
  }
}

function inputs(overrides: Partial<RoofUserInputs> = {}): RoofUserInputs {
  return {
    material: 'colorbond_trimdek',
    pitch: 'standard',
    intent: 'full_reroof',
    ...overrides,
  }
}

function candidate(overrides: Partial<RoofEdgeCandidate> = {}): RoofEdgeCandidate {
  return {
    id: 'valley-01',
    kind: 'valley',
    geometry: {
      type: 'LineString',
      coordinates: [
        [153.155, -27.51],
        [153.1551, -27.5101],
      ],
    },
    planLengthM: 4.4,
    surfaceLengthM: 4.8,
    confidence: 84,
    facetIds: [4, 7],
    reasons: ['plane fit', 'trough sample'],
    evidence: {
      source: 'licensed_lidar',
      geometrySource: 'licensed_lidar',
      supportPixels: 120,
      planeResidualM: 0.08,
      dihedralDeg: 42,
    },
    ...overrides,
  }
}

function baseInput(
  overrides: Partial<CreateReadOnlyRoofEdgeAnalysisInput> = {},
): CreateReadOnlyRoofEdgeAnalysisInput {
  const quote = priceMultiRoof({
    structures: [
      {
        buildingId: 'dwelling',
        role: 'primary',
        metrics: metrics(),
        inputs: inputs(),
      },
      {
        buildingId: 'shed',
        role: 'secondary',
        metrics: metrics({ footprint_m2: 480, sloped_area_m2: 500 }),
        inputs: inputs(),
      },
    ],
  })

  return {
    tenantId: '11111111-1111-4111-8111-111111111111',
    measurement: {
      id: '22222222-2222-4222-8222-222222222222',
      quote,
    },
    selection: {
      measurementId: '22222222-2222-4222-8222-222222222222',
      structureIndex: 1,
      buildingId: 'dwelling',
      confirmed: true,
    },
    analysisVersion: 'edge-analysis-v1',
    generatedAt: '2026-07-15T00:00:00.000Z',
    access: {
      environment: { ROOFING_EDGE_ANALYSIS_ENABLED: 'true' },
      now: NOW,
    },
    source: {
      geometrySource: 'licensed_lidar',
      approvalId: '33333333-3333-4333-8333-333333333333',
      commercialApprovalReference: 'LIC-2026-TOPOLOGY',
      geometryCaptureDate: '2026-06-01',
      geoscapeCaptureDate: '2026-06-02',
      retentionMode: 'perpetual',
      retentionExpiresAt: null,
      retainedAssetKeys: ['roof-edge/analysis-1/evidence.png'],
    },
    candidates: [candidate()],
    ...overrides,
  }
}

describe('ROOFING_EDGE_ANALYSIS_ENABLED', () => {
  it('is default-off and independent from Solar pitch enrichment', () => {
    expect(isRoofingEdgeAnalysisEnabled({})).toBe(false)
    expect(
      isRoofingEdgeAnalysisEnabled({
        ROOFING_SOLAR_ENRICHMENT: 'true',
        GOOGLE_MAPS_API_KEY: 'key-alone-must-not-enable-topology',
      }),
    ).toBe(false)
    expect(
      isRoofingEdgeAnalysisEnabled({
        ROOFING_EDGE_ANALYSIS_ENABLED: 'true',
        ROOFING_SOLAR_ENRICHMENT: 'false',
      }),
    ).toBe(true)
  })

  it('requires a recorded lawful source gate in addition to the feature flag', () => {
    expect(
      evaluateRoofingEdgeAnalysisAccess({
        environment: { ROOFING_EDGE_ANALYSIS_ENABLED: 'true' },
        geometrySource: 'approved_google_solar',
        sourceApprovalId: 'recorded-google-approval',
        commercialApprovalReference: null,
        retentionMode: 'expires',
        retentionExpiresAt: '2026-08-01T00:00:00.000Z',
        now: NOW,
      }),
    ).toMatchObject({ allowed: false, reason: 'commercial_approval_missing' })

    expect(
      evaluateRoofingEdgeAnalysisAccess({
        environment: { ROOFING_EDGE_ANALYSIS_ENABLED: 'true' },
        geometrySource: 'approved_google_solar',
        sourceApprovalId: 'recorded-google-approval',
        commercialApprovalReference: 'GOOGLE-WRITTEN-APPROVAL-2026-07',
        retentionMode: 'expires',
        retentionExpiresAt: '2026-07-01T00:00:00.000Z',
        now: NOW,
      }),
    ).toMatchObject({ allowed: false, reason: 'retention_expired' })

    expect(
      evaluateRoofingEdgeAnalysisAccess({
        environment: { ROOFING_EDGE_ANALYSIS_ENABLED: 'true' },
        geometrySource: 'licensed_lidar',
        sourceApprovalId: 'recorded-lidar-approval',
        commercialApprovalReference: 'LIC-2026-TOPOLOGY',
        retentionMode: 'perpetual',
        retentionExpiresAt: null,
        now: NOW,
      }),
    ).toMatchObject({ allowed: true })

    expect(
      evaluateRoofingEdgeAnalysisAccess({
        environment: { ROOFING_EDGE_ANALYSIS_ENABLED: 'true' },
        geometrySource: 'unapproved_source' as never,
        sourceApprovalId: 'recorded-invalid-approval',
        commercialApprovalReference: 'not-a-valid-source',
        retentionMode: 'perpetual',
        retentionExpiresAt: null,
        now: NOW,
      }),
    ).toMatchObject({ allowed: false, reason: 'source_invalid' })

    expect(
      evaluateRoofingEdgeAnalysisAccess({
        environment: { ROOFING_EDGE_ANALYSIS_ENABLED: 'true' },
        geometrySource: 'licensed_lidar',
        sourceApprovalId: null,
        commercialApprovalReference: 'LIC-2026-TOPOLOGY',
        retentionMode: 'perpetual',
        retentionExpiresAt: null,
        now: NOW,
      }),
    ).toMatchObject({ allowed: false, reason: 'source_approval_missing' })
  })
})

describe('main-dwelling selection', () => {
  it('uses the explicitly confirmed dwelling even where a shed is larger', () => {
    const selection = confirmMainDwellingSelection({
      measurementId: '22222222-2222-4222-8222-222222222222',
      structureIndex: 1,
      buildingId: 'dwelling',
      confirmed: true,
      structures: [
        { structureIndex: 1, buildingId: 'dwelling', footprintM2: 180 },
        { structureIndex: 2, buildingId: 'shed', footprintM2: 480 },
      ],
    })

    expect(selection).toMatchObject({
      structureIndex: 1,
      buildingId: 'dwelling',
      confirmed: true,
    })
  })

  it('rejects an unconfirmed or mismatched structure selection', () => {
    expect(() =>
      confirmMainDwellingSelection({
        measurementId: '22222222-2222-4222-8222-222222222222',
        structureIndex: 1,
        buildingId: 'shed',
        confirmed: true,
        structures: [{ structureIndex: 1, buildingId: 'dwelling', footprintM2: 180 }],
      }),
    ).toThrow(/building/i)
  })
})

describe('read-only semantic edge analysis contract', () => {
  it('leaves quote, metrics, tier totals, and customer-facing inputs unchanged', () => {
    const input = baseInput()
    const before = JSON.stringify(input.measurement.quote)

    const analysis = createReadOnlyRoofEdgeAnalysis(input)

    expect(JSON.stringify(input.measurement.quote)).toBe(before)
    expect(analysis.status).toBe('needs_review')
    expect(analysis.candidateSummary.valley).toEqual({
      count: 1,
      planLm: 4.4,
      surfaceLm: 4.8,
    })
    expect(Object.isFrozen(analysis)).toBe(true)
  })

  it('marks a material source-date mismatch as needs_review without altering prices', () => {
    const input = baseInput({
      source: {
        ...baseInput().source,
        geometryCaptureDate: '2024-01-01',
        geoscapeCaptureDate: '2026-06-02',
      },
    })
    const before = JSON.stringify(input.measurement.quote)

    const analysis = createReadOnlyRoofEdgeAnalysis(input)

    expect(analysis.status).toBe('needs_review')
    expect(analysis.sourceMetadata.temporalReviewRequired).toBe(true)
    expect(JSON.stringify(input.measurement.quote)).toBe(before)
  })

  it.each([
    ['a raw provider URL', baseInput({ source: { ...baseInput().source, retainedAssetKeys: ['https://provider.invalid/asset'] } })],
    ['an object-storage provider URL', baseInput({ source: { ...baseInput().source, retainedAssetKeys: ['s3://bucket/asset'] } })],
    ['a data URI', baseInput({ source: { ...baseInput().source, retainedAssetKeys: ['data:image/png;base64,abc'] } })],
    [
      'a credential in an approval reference',
      baseInput({
        source: {
          ...baseInput().source,
          commercialApprovalReference: 'api_key=redacted-secret',
        },
      }),
    ],
    ['a missing approval record', baseInput({ source: { ...baseInput().source, commercialApprovalReference: null } })],
    ['a missing approval id', baseInput({ source: { ...baseInput().source, approvalId: '' } })],
    ['a disabled topology flag', baseInput({ access: { environment: {}, now: NOW } })],
    [
      'Google evidence under a licensed source approval',
      baseInput({
        candidates: [
          candidate({
            evidence: {
              ...candidate().evidence,
              source: 'approved_google_solar',
              geometrySource: 'approved_google_solar',
            },
          }),
        ],
      }),
    ],
    [
      'fused evidence that names a different geometry source',
      baseInput({
        candidates: [
          candidate({
            evidence: {
              ...candidate().evidence,
              source: 'fused',
              geometrySource: 'approved_google_solar',
            },
          }),
        ],
      }),
    ],
    [
      'a Geoscape-only semantic edge',
      baseInput({
        candidates: [
          candidate({
            evidence: {
              ...candidate().evidence,
              source: 'geoscape_footprint',
              geometrySource: null,
            },
          }),
        ],
      }),
    ],
    ['an unsupported gutter edge', baseInput({ candidates: [candidate({ kind: 'gutter' as never })] })],
    ['duplicate candidate ids', baseInput({ candidates: [candidate(), candidate({ surfaceLengthM: 5.2 })] })],
    ['negative lengths', baseInput({ candidates: [candidate({ planLengthM: -1 })] })],
    ['non-finite lengths', baseInput({ candidates: [candidate({ surfaceLengthM: Number.NaN })] })],
    [
      'invalid line geometry',
      baseInput({
        candidates: [
          candidate({
            geometry: { type: 'LineString', coordinates: [[153.155, -27.51]] },
          }),
        ],
      }),
    ],
    ['missing line geometry', baseInput({ candidates: [candidate({ geometry: undefined as never })] })],
  ])('rejects %s', (_label, input) => {
    expect(() => createReadOnlyRoofEdgeAnalysis(input)).toThrow()
  })
})

describe('retention contract', () => {
  it('does not serve no-retention, expired, or purged analysis evidence', () => {
    expect(
      isRoofEdgeAnalysisReadable(
        {
          retentionMode: 'none',
          retentionExpiresAt: null,
          purgedAt: null,
          sourceApprovalStatus: 'active',
          sourceApprovalValidUntil: null,
        },
        NOW,
      ),
    ).toBe(false)
    expect(
      isRoofEdgeAnalysisReadable(
        {
          retentionMode: 'perpetual',
          retentionExpiresAt: null,
          purgedAt: null,
          sourceApprovalStatus: 'revoked',
          sourceApprovalValidUntil: null,
        },
        NOW,
      ),
    ).toBe(false)
    expect(
      isRoofEdgeAnalysisReadable(
        {
          retentionMode: 'perpetual',
          retentionExpiresAt: null,
          purgedAt: null,
          sourceApprovalStatus: 'active',
          sourceApprovalValidUntil: '2026-07-01T00:00:00.000Z',
        },
        NOW,
      ),
    ).toBe(false)
    expect(
      isRoofEdgeAnalysisReadable(
        {
          retentionMode: 'expires',
          retentionExpiresAt: '2026-07-01T00:00:00.000Z',
          purgedAt: null,
          sourceApprovalStatus: 'active',
          sourceApprovalValidUntil: null,
        },
        NOW,
      ),
    ).toBe(false)
    expect(
      isRoofEdgeAnalysisReadable(
        {
          retentionMode: 'perpetual',
          retentionExpiresAt: null,
          purgedAt: '2026-07-01T00:00:00.000Z',
          sourceApprovalStatus: 'active',
          sourceApprovalValidUntil: null,
        },
        NOW,
      ),
    ).toBe(false)
  })

  it('deletes retained assets before clearing an expired payload', async () => {
    const deleted: string[] = []
    const purged = await purgeExpiredRoofEdgeAnalysis(
      {
        retentionMode: 'expires',
        retentionExpiresAt: '2026-07-01T00:00:00.000Z',
        purgedAt: null,
        purgeState: 'pending',
        candidatePayload: { candidates: [{ id: 'valley-01' }] },
        retainedAssetKeys: ['roof-edge/analysis-1/evidence.png'],
      },
      {
        now: NOW,
        deleteAsset: async (key) => {
          deleted.push(key)
        },
      },
    )

    expect(deleted).toEqual(['roof-edge/analysis-1/evidence.png'])
    expect(purged).toMatchObject({
      candidatePayload: null,
      retainedAssetKeys: [],
      purgeState: 'purged',
    })
    expect(purged.purgedAt).toBe(NOW.toISOString())
  })
})

describe('benchmark fixtures', () => {
  it('covers the seven required source-independent cases without provider assets', () => {
    expect(ROOF_TOPOLOGY_BENCHMARK_FIXTURES).toHaveLength(7)
    expect(ROOF_TOPOLOGY_BENCHMARK_FIXTURES.map((fixture) => fixture.scenario).sort()).toEqual(
      [...REQUIRED_ROOF_TOPOLOGY_BENCHMARK_SCENARIOS].sort(),
    )
    for (const fixture of ROOF_TOPOLOGY_BENCHMARK_FIXTURES) {
      expect(fixture.dataOrigin).toMatch(/^(synthetic|licensed)$/)
      expect(JSON.stringify(fixture)).not.toMatch(/https?:\/\//i)
      expect(JSON.stringify(fixture)).not.toMatch(/googleapis/i)
    }
  })
})
