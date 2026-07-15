// Read-only semantic roof-edge analysis contract.
//
// Phase 1 deliberately contains no provider I/O, pricing, route, or UI code.
// This module validates and freezes the durable analysis envelope so a later
// source adapter cannot silently alter a measured quote's metrics or totals.

import type { MultiRoofQuote } from './types'
import {
  evaluateRoofingEdgeAnalysisAccess,
  type EdgeAnalysisEnvironment,
} from './edge-analysis-config'

export const ROOF_EDGE_KINDS = ['ridge', 'hip', 'valley', 'eave', 'unknown'] as const
export type RoofEdgeKind = (typeof ROOF_EDGE_KINDS)[number]

export const ROOF_TOPOLOGY_GEOMETRY_SOURCES = [
  'approved_google_solar',
  'licensed_aerial_dsm',
  'licensed_lidar',
] as const
export type RoofTopologyGeometrySource = (typeof ROOF_TOPOLOGY_GEOMETRY_SOURCES)[number]

export const ROOF_EDGE_RETENTION_MODES = ['none', 'expires', 'perpetual'] as const
export type RoofEdgeRetentionMode = (typeof ROOF_EDGE_RETENTION_MODES)[number]

export type RoofEdgeLineString = {
  type: 'LineString'
  coordinates: ReadonlyArray<readonly [number, number]>
}

export type RoofEdgeEvidence = {
  source: RoofTopologyGeometrySource | 'geoscape_footprint' | 'fused'
  // Fused evidence may combine this approved source with Geoscape context only.
  geometrySource: RoofTopologyGeometrySource | null
  supportPixels: number | null
  planeResidualM: number | null
  dihedralDeg: number | null
}

export type RoofEdgeCandidate = {
  id: string
  kind: RoofEdgeKind
  geometry: RoofEdgeLineString
  planLengthM: number
  surfaceLengthM: number | null
  confidence: number
  facetIds: number[]
  reasons: string[]
  evidence: RoofEdgeEvidence
}

export type RoofEdgeSummary = {
  count: number
  planLm: number
  surfaceLm: number | null
}

export type ConfirmedMainDwellingSelection = {
  measurementId: string
  structureIndex: number
  buildingId: string
  confirmed: true
}

export type MainDwellingSelectionRequest = {
  measurementId: string
  structureIndex: number
  buildingId: string
  confirmed: boolean
  structures: ReadonlyArray<{
    structureIndex: number
    buildingId: string | null
    footprintM2: number
  }>
}

export type RoofTopologySourceMetadata = {
  geometrySource: RoofTopologyGeometrySource
  // Durable ID of a vetted written approval/licence record.
  approvalId: string
  // A legal approval or licence record, never a provider key.
  commercialApprovalReference: string | null
  geometryCaptureDate: string | null
  geoscapeCaptureDate: string | null
  retentionMode: RoofEdgeRetentionMode
  retentionExpiresAt: string | null
  // Internal storage-object keys only; never a provider or signed URL.
  retainedAssetKeys: string[]
}

export type CreateReadOnlyRoofEdgeAnalysisInput = {
  tenantId: string
  measurement: {
    id: string
    // Included to prove generation cannot mutate money-path payloads.
    quote: MultiRoofQuote
  }
  selection: ConfirmedMainDwellingSelection
  analysisVersion: string
  generatedAt: string
  access: {
    environment?: EdgeAnalysisEnvironment
    now?: Date
  }
  source: RoofTopologySourceMetadata
  candidates: RoofEdgeCandidate[]
}

export type RoofEdgeAnalysisStatus = 'available' | 'needs_review' | 'unavailable'

export type ReadOnlyRoofEdgeAnalysis = {
  tenantId: string
  measurementId: string
  structureIndex: number
  buildingId: string
  status: RoofEdgeAnalysisStatus
  analysisVersion: string
  generatedAt: string
  sourceMetadata: RoofTopologySourceMetadata & {
    temporalReviewRequired: boolean
    sourceDateDeltaDays: number | null
  }
  candidates: readonly RoofEdgeCandidate[]
  candidateSummary: Record<RoofEdgeKind, RoofEdgeSummary>
}

const MAX_SOURCE_DATE_MISMATCH_DAYS = 180
const UNSAFE_PROVIDER_VALUE_PATTERN =
  /(?:(?:https?|gs|s3|ftp|ftps|file|javascript):\/{0,2}|data:|(?:^|[^\w])\/\/|(?:^|[^\w])www\.|AIza[0-9A-Za-z_-]{20,}|(?:api[_-]?key|access[_-]?token|secret|authorization)\s*[:=])/i

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isFiniteNonNegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function isIsoTimestamp(value: string): boolean {
  return Number.isFinite(Date.parse(value))
}

function containsProviderUrl(value: unknown): boolean {
  if (typeof value === 'string') return UNSAFE_PROVIDER_VALUE_PATTERN.test(value)
  if (Array.isArray(value)) return value.some(containsProviderUrl)
  if (!value || typeof value !== 'object') return false
  return Object.values(value as Record<string, unknown>).some(containsProviderUrl)
}

function assertContract(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error('Invalid roof edge analysis: ' + message)
}

function cloneCandidate(candidate: RoofEdgeCandidate): RoofEdgeCandidate {
  return {
    ...candidate,
    geometry: {
      type: candidate.geometry.type,
      coordinates: candidate.geometry.coordinates.map(([x, y]) => [x, y] as [number, number]),
    },
    facetIds: [...candidate.facetIds],
    reasons: [...candidate.reasons],
    evidence: { ...candidate.evidence },
  }
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value
  for (const child of Object.values(value as Record<string, unknown>)) {
    deepFreeze(child)
  }
  return Object.freeze(value)
}

function validateCandidate(
  candidate: RoofEdgeCandidate,
  selectedGeometrySource: RoofTopologyGeometrySource,
): void {
  assertContract(isNonEmptyString(candidate.id), 'candidate id is required')
  assertContract(
    (ROOF_EDGE_KINDS as readonly string[]).includes(candidate.kind),
    'unsupported edge kind ' + String(candidate.kind),
  )
  const geometry = candidate.geometry as unknown as {
    type?: unknown
    coordinates?: unknown
  }
  assertContract(geometry?.type === 'LineString', 'geometry must be a LineString')
  assertContract(
    Array.isArray(geometry.coordinates) && geometry.coordinates.length >= 2,
    'LineString must contain at least two coordinates',
  )
  for (const coordinate of geometry.coordinates) {
    assertContract(
      Array.isArray(coordinate) &&
        coordinate.length === 2 &&
        Number.isFinite(coordinate[0]) &&
        Number.isFinite(coordinate[1]),
      'LineString coordinates must be finite [x, y] pairs',
    )
  }
  assertContract(isFiniteNonNegative(candidate.planLengthM), 'plan length must be finite and non-negative')
  assertContract(
    candidate.surfaceLengthM === null || isFiniteNonNegative(candidate.surfaceLengthM),
    'surface length must be finite, non-negative, or null',
  )
  assertContract(
    typeof candidate.confidence === 'number' &&
      Number.isFinite(candidate.confidence) &&
      candidate.confidence >= 0 &&
      candidate.confidence <= 100,
    'confidence must be between 0 and 100',
  )
  assertContract(
    Array.isArray(candidate.facetIds) &&
      candidate.facetIds.every((id) => Number.isInteger(id) && id >= 0),
    'facet ids must be non-negative integers',
  )
  assertContract(Array.isArray(candidate.reasons), 'reasons must be an array')
  const evidence = candidate.evidence as unknown as Partial<RoofEdgeEvidence>
  assertContract(
    ([
      ...ROOF_TOPOLOGY_GEOMETRY_SOURCES,
      'geoscape_footprint',
      'fused',
    ] as readonly string[]).includes(evidence?.source ?? ''),
    'candidate evidence source is unsupported',
  )
  if ((ROOF_TOPOLOGY_GEOMETRY_SOURCES as readonly string[]).includes(evidence.source ?? '')) {
    assertContract(
      evidence.geometrySource === evidence.source &&
        evidence.geometrySource === selectedGeometrySource,
      'candidate evidence source must match the approved geometry source',
    )
  } else if (evidence.source === 'geoscape_footprint') {
    assertContract(
      false,
      'Geoscape footprint context cannot independently support a semantic roof edge',
    )
  } else {
    assertContract(
      evidence.source === 'fused' && evidence.geometrySource === selectedGeometrySource,
      'fused evidence may only use the approved geometry source with Geoscape context',
    )
  }
  for (const value of [
    evidence.supportPixels,
    evidence.planeResidualM,
    evidence.dihedralDeg,
  ]) {
    assertContract(
      value === null || isFiniteNonNegative(value),
      'evidence values must be finite, non-negative, or null',
    )
  }
  assertContract(!containsProviderUrl(candidate), 'provider URLs are not allowed')
}

function validateSourceMetadata(
  source: RoofTopologySourceMetadata,
  generatedAt: string,
): void {
  assertContract(source && typeof source === 'object', 'source metadata is required')
  assertContract(
    (ROOF_TOPOLOGY_GEOMETRY_SOURCES as readonly string[]).includes(source.geometrySource),
    'geometry source is unsupported',
  )
  assertContract(isNonEmptyString(source.approvalId), 'approval id is required')
  assertContract(
    isNonEmptyString(source.commercialApprovalReference),
    'commercial approval reference must be a non-empty string',
  )
  for (const date of [source.geometryCaptureDate, source.geoscapeCaptureDate]) {
    assertContract(date === null || isIsoTimestamp(date), 'capture dates must be valid timestamps or null')
  }
  assertContract(
    (ROOF_EDGE_RETENTION_MODES as readonly string[]).includes(source.retentionMode),
    'retention mode is unsupported',
  )
  if (source.retentionMode === 'expires') {
    assertContract(
      source.retentionExpiresAt !== null && isIsoTimestamp(source.retentionExpiresAt),
      'expiring retention requires a valid expiry timestamp',
    )
    assertContract(
      Date.parse(source.retentionExpiresAt!) > Date.parse(generatedAt),
      'retention expiry must be after generation',
    )
  } else {
    assertContract(source.retentionExpiresAt === null, 'only expiring retention may have an expiry timestamp')
  }
  assertContract(Array.isArray(source.retainedAssetKeys), 'retained asset keys must be an array')
  if (source.retentionMode === 'none') {
    assertContract(source.retainedAssetKeys.length === 0, 'no-retention analysis cannot retain assets')
  }
  assertContract(!containsProviderUrl(source), 'provider URLs are not allowed')
}

function sourceDateAlignment(source: RoofTopologySourceMetadata): {
  temporalReviewRequired: boolean
  sourceDateDeltaDays: number | null
} {
  if (!source.geometryCaptureDate || !source.geoscapeCaptureDate) {
    return { temporalReviewRequired: true, sourceDateDeltaDays: null }
  }
  const deltaDays = Math.abs(
    Date.parse(source.geometryCaptureDate) - Date.parse(source.geoscapeCaptureDate),
  ) / (1000 * 60 * 60 * 24)
  return {
    temporalReviewRequired: deltaDays > MAX_SOURCE_DATE_MISMATCH_DAYS,
    sourceDateDeltaDays: Math.round(deltaDays * 10) / 10,
  }
}

function emptySummary(): Record<RoofEdgeKind, RoofEdgeSummary> {
  return {
    ridge: { count: 0, planLm: 0, surfaceLm: 0 },
    hip: { count: 0, planLm: 0, surfaceLm: 0 },
    valley: { count: 0, planLm: 0, surfaceLm: 0 },
    eave: { count: 0, planLm: 0, surfaceLm: 0 },
    unknown: { count: 0, planLm: 0, surfaceLm: 0 },
  }
}

function summarizeCandidates(candidates: readonly RoofEdgeCandidate[]): Record<RoofEdgeKind, RoofEdgeSummary> {
  const summary = emptySummary()
  const kindsWithUnknownSurfaceLength = new Set<RoofEdgeKind>()
  for (const candidate of candidates) {
    const row = summary[candidate.kind]
    row.count += 1
    row.planLm += candidate.planLengthM
    if (candidate.surfaceLengthM === null) {
      kindsWithUnknownSurfaceLength.add(candidate.kind)
    } else if (row.surfaceLm !== null) {
      row.surfaceLm += candidate.surfaceLengthM
    }
  }
  for (const kind of kindsWithUnknownSurfaceLength) {
    summary[kind].surfaceLm = null
  }
  for (const kind of ROOF_EDGE_KINDS) {
    summary[kind].planLm = Math.round(summary[kind].planLm * 1000) / 1000
    if (summary[kind].surfaceLm !== null) {
      summary[kind].surfaceLm = Math.round(summary[kind].surfaceLm * 1000) / 1000
    }
  }
  return summary
}

// Uses an explicit tradie confirmation. Area is intentionally never a tie-breaker.
export function confirmMainDwellingSelection(
  request: MainDwellingSelectionRequest,
): ConfirmedMainDwellingSelection {
  assertContract(isNonEmptyString(request.measurementId), 'measurement id is required')
  assertContract(request.confirmed === true, 'main dwelling must be explicitly confirmed')
  assertContract(
    Number.isInteger(request.structureIndex) && request.structureIndex >= 1,
    'structure index must be a positive integer',
  )
  assertContract(isNonEmptyString(request.buildingId), 'building id is required')
  const selected = request.structures.find(
    (structure) => structure.structureIndex === request.structureIndex,
  )
  assertContract(selected, 'selected structure does not exist')
  assertContract(selected.buildingId === request.buildingId, 'selected building does not match structure')
  return deepFreeze({
    measurementId: request.measurementId,
    structureIndex: request.structureIndex,
    buildingId: request.buildingId,
    confirmed: true as const,
  })
}

// Builds a detached, immutable envelope. It performs no I/O or pricing.
export function createReadOnlyRoofEdgeAnalysis(
  input: CreateReadOnlyRoofEdgeAnalysisInput,
): ReadOnlyRoofEdgeAnalysis {
  assertContract(isNonEmptyString(input.tenantId), 'tenant id is required')
  assertContract(isNonEmptyString(input.measurement?.id), 'measurement id is required')
  assertContract(isNonEmptyString(input.analysisVersion), 'analysis version is required')
  assertContract(isIsoTimestamp(input.generatedAt), 'generated timestamp is invalid')
  assertContract(
    input.selection?.measurementId === input.measurement.id,
    'selection must belong to the measurement',
  )
  assertContract(input.selection.confirmed === true, 'main dwelling must be explicitly confirmed')
  assertContract(
    Number.isInteger(input.selection.structureIndex) && input.selection.structureIndex >= 1,
    'selection structure index must be a positive integer',
  )
  const selectedStructure = input.measurement.quote?.structures?.[input.selection.structureIndex - 1]
  assertContract(selectedStructure, 'selection structure does not exist in the measurement quote')
  assertContract(
    selectedStructure.buildingId === input.selection.buildingId,
    'selection building does not match the measurement quote',
  )
  validateSourceMetadata(input.source, input.generatedAt)
  const access = evaluateRoofingEdgeAnalysisAccess({
    environment: input.access?.environment,
    geometrySource: input.source.geometrySource,
    sourceApprovalId: input.source.approvalId,
    commercialApprovalReference: input.source.commercialApprovalReference,
    retentionMode: input.source.retentionMode,
    retentionExpiresAt: input.source.retentionExpiresAt,
    now: input.access?.now,
  })
  assertContract(
    access.allowed,
    'edge analysis source access is denied: ' + (access.allowed ? '' : access.reason),
  )

  const candidateIds = new Set<string>()
  for (const item of input.candidates) {
    validateCandidate(item, input.source.geometrySource)
    assertContract(!candidateIds.has(item.id), 'candidate ids must be unique')
    candidateIds.add(item.id)
  }

  const alignment = sourceDateAlignment(input.source)
  const copiedCandidates = input.candidates.map(cloneCandidate)
  const analysis: ReadOnlyRoofEdgeAnalysis = {
    tenantId: input.tenantId,
    measurementId: input.measurement.id,
    structureIndex: input.selection.structureIndex,
    buildingId: input.selection.buildingId,
    // Phase 1 has no calibrated candidate engine or approval workflow. Every
    // envelope remains review-required even when its source dates align.
    status: 'needs_review',
    analysisVersion: input.analysisVersion,
    generatedAt: input.generatedAt,
    sourceMetadata: {
      ...input.source,
      retainedAssetKeys: [...input.source.retainedAssetKeys],
      ...alignment,
    },
    candidates: copiedCandidates,
    candidateSummary: summarizeCandidates(copiedCandidates),
  }
  return deepFreeze(analysis)
}
