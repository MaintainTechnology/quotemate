// Pure retention/purge contract for semantic edge analysis evidence.
//
// The eventual worker supplies the storage deletion callback and persists the
// returned state. Keeping this module I/O-free makes the legal retention rule
// independently testable before any provider adapter is added.

import type { RoofEdgeRetentionMode } from './edge-analysis'

export type RoofEdgeRetentionRecord<TPayload = unknown> = {
  retentionMode: RoofEdgeRetentionMode
  retentionExpiresAt: string | null
  purgedAt: string | null
  purgeState?: 'not_required' | 'pending' | 'purging' | 'purged' | 'failed'
  candidatePayload?: TPayload | null
  retainedAssetKeys?: string[]
}

export type PurgeExpiredRoofEdgeAnalysisOptions = {
  now?: Date
  deleteAsset: (key: string) => Promise<void>
}

export type RoofEdgeAnalysisReadRecord = Pick<
  RoofEdgeRetentionRecord,
  'retentionMode' | 'retentionExpiresAt' | 'purgedAt'
> & {
  // Read callers must join the durable source-approval record; a stale
  // analysis cannot remain visible after its approval is revoked or expires.
  sourceApprovalStatus: 'active' | 'revoked' | 'expired'
  sourceApprovalValidUntil: string | null
}

function isExpired(
  record: Pick<RoofEdgeRetentionRecord, 'retentionMode' | 'retentionExpiresAt'>,
  now: Date,
): boolean {
  if (record.retentionMode !== 'expires') return false
  if (!record.retentionExpiresAt || !Number.isFinite(Date.parse(record.retentionExpiresAt))) {
    return true
  }
  return Date.parse(record.retentionExpiresAt) <= now.getTime()
}

// Expired and purged evidence is unavailable even before the worker runs.
export function isRoofEdgeAnalysisReadable(
  record: RoofEdgeAnalysisReadRecord,
  now = new Date(),
): boolean {
  const sourceApprovalExpired =
    record.sourceApprovalValidUntil !== null &&
    (!Number.isFinite(Date.parse(record.sourceApprovalValidUntil)) ||
      Date.parse(record.sourceApprovalValidUntil) <= now.getTime())

  return (
    record.retentionMode !== 'none' &&
    record.purgedAt === null &&
    record.sourceApprovalStatus === 'active' &&
    !sourceApprovalExpired &&
    !isExpired(record, now)
  )
}

// Delete internal assets first, then return the redacted persistence state.
export async function purgeExpiredRoofEdgeAnalysis<TPayload>(
  record: RoofEdgeRetentionRecord<TPayload>,
  options: PurgeExpiredRoofEdgeAnalysisOptions,
): Promise<RoofEdgeRetentionRecord<TPayload>> {
  const now = options.now ?? new Date()
  if (record.purgedAt || !isExpired(record, now)) {
    return {
      ...record,
      retainedAssetKeys: record.retainedAssetKeys ? [...record.retainedAssetKeys] : record.retainedAssetKeys,
    }
  }

  for (const key of record.retainedAssetKeys ?? []) {
    await options.deleteAsset(key)
  }

  return {
    ...record,
    candidatePayload: null,
    retainedAssetKeys: [],
    purgeState: 'purged',
    purgedAt: now.toISOString(),
  }
}
