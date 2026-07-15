// Server-only feature/source gate for semantic edge analysis.
//
// This is deliberately separate from ROOFING_SOLAR_ENRICHMENT. The existing
// Solar flag controls pitch enrichment; it is not evidence of permission to
// call a topology source or persist derivative roof-edge data.

import type {
  RoofEdgeRetentionMode,
  RoofTopologyGeometrySource,
} from './edge-analysis'

export type EdgeAnalysisEnvironment = Readonly<Record<string, string | undefined>>

const VALID_GEOMETRY_SOURCES: readonly RoofTopologyGeometrySource[] = [
  'approved_google_solar',
  'licensed_aerial_dsm',
  'licensed_lidar',
]
const VALID_RETENTION_MODES: readonly RoofEdgeRetentionMode[] = [
  'none',
  'expires',
  'perpetual',
]

export type RoofingEdgeAnalysisAccessInput = {
  environment?: EdgeAnalysisEnvironment
  geometrySource: RoofTopologyGeometrySource | null
  sourceApprovalId: string | null
  commercialApprovalReference: string | null
  retentionMode: RoofEdgeRetentionMode
  retentionExpiresAt: string | null
  now?: Date
}

export type RoofingEdgeAnalysisAccessDecision =
  | { allowed: true }
  | {
      allowed: false
      reason:
        | 'feature_disabled'
        | 'source_missing'
        | 'source_invalid'
        | 'source_approval_missing'
        | 'commercial_approval_missing'
        | 'retention_metadata_invalid'
        | 'retention_expiry_missing'
        | 'retention_expired'
    }

// Default-off. This intentionally ignores every Solar feature/key variable.
export function isRoofingEdgeAnalysisEnabled(
  environment: EdgeAnalysisEnvironment = process.env,
): boolean {
  return environment.ROOFING_EDGE_ANALYSIS_ENABLED === 'true'
}

// Checks future source-adapter authorisation without contacting a provider.
export function evaluateRoofingEdgeAnalysisAccess(
  input: RoofingEdgeAnalysisAccessInput,
): RoofingEdgeAnalysisAccessDecision {
  if (!isRoofingEdgeAnalysisEnabled(input.environment)) {
    return { allowed: false, reason: 'feature_disabled' }
  }
  if (!input.geometrySource) {
    return { allowed: false, reason: 'source_missing' }
  }
  if (!(VALID_GEOMETRY_SOURCES as readonly string[]).includes(input.geometrySource)) {
    return { allowed: false, reason: 'source_invalid' }
  }
  if (!input.sourceApprovalId?.trim()) {
    return { allowed: false, reason: 'source_approval_missing' }
  }
  if (!input.commercialApprovalReference?.trim()) {
    return { allowed: false, reason: 'commercial_approval_missing' }
  }
  if (!(VALID_RETENTION_MODES as readonly string[]).includes(input.retentionMode)) {
    return { allowed: false, reason: 'retention_metadata_invalid' }
  }
  if (input.retentionMode !== 'expires') {
    if (input.retentionExpiresAt !== null) {
      return { allowed: false, reason: 'retention_metadata_invalid' }
    }
    return { allowed: true }
  }
  if (!input.retentionExpiresAt || !Number.isFinite(Date.parse(input.retentionExpiresAt))) {
    return { allowed: false, reason: 'retention_expiry_missing' }
  }
  if (Date.parse(input.retentionExpiresAt) <= (input.now ?? new Date()).getTime()) {
    return { allowed: false, reason: 'retention_expired' }
  }
  return { allowed: true }
}
