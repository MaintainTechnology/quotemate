// GET /api/dashboard/roofing/measurements/[id]/topology
//
// Tenant-authenticated, dashboard-only topology evidence entry point. The
// initial delivery returns a synthetic preview contract only; it intentionally
// performs no Google/Geoscape topology request and never returns quote, price,
// capability-token, imagery, provider URL, or approval-document data.

import { createClient } from '@supabase/supabase-js'
import {
  isRoofingEdgeAnalysisEnabled,
} from '@/lib/roofing/edge-analysis-config'
import {
  TOPOLOGY_PREVIEW_DISCLAIMER,
  topologyPreviewLocation,
  topologyPreviewStructures,
  type RoofTopologyPreviewResponse,
  type TopologyPreviewGate,
} from '@/lib/roofing/topology-preview'
import { requireFeature } from '@/lib/features/guard'

export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

type MeasurementRow = {
  id: string
  tenant_id: string | null
  address: string | null
  postcode: string | null
  state: string | null
  quote: unknown
  created_at: string | null
}

type SourceApprovalRow = {
  approval_status: 'active' | 'revoked' | 'expired'
  allows_derived_geometry: boolean
  valid_until: string | null
  retention_policy: 'none' | 'expires' | 'perpetual'
  max_retention_expires_at: string | null
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

function hasExpiredOrInvalidDate(value: string | null, now = Date.now()): boolean {
  return value !== null && (!Number.isFinite(Date.parse(value)) || Date.parse(value) <= now)
}

function canSupportRetainedCandidateEvidence(row: SourceApprovalRow, now = Date.now()): boolean {
  if (
    row.approval_status !== 'active' ||
    !row.allows_derived_geometry ||
    hasExpiredOrInvalidDate(row.valid_until, now)
  ) {
    return false
  }

  if (row.retention_policy === 'perpetual') {
    return row.max_retention_expires_at === null
  }

  return (
    row.retention_policy === 'expires' &&
    row.max_retention_expires_at !== null &&
    !hasExpiredOrInvalidDate(row.max_retention_expires_at, now)
  )
}

function hasExpiredApprovalWindow(row: SourceApprovalRow, now = Date.now()): boolean {
  return (
    row.approval_status === 'active' &&
    row.allows_derived_geometry &&
    (hasExpiredOrInvalidDate(row.valid_until, now) ||
      (row.retention_policy === 'expires' &&
        (row.max_retention_expires_at === null ||
          hasExpiredOrInvalidDate(row.max_retention_expires_at, now))))
  )
}

async function topologyGateForTenant(tenantId: string): Promise<TopologyPreviewGate> {
  if (!isRoofingEdgeAnalysisEnabled()) return 'feature_disabled'

  // Migration 172 owns this table. A missing table is a setup condition, not
  // permission to call a provider or construct topology candidates.
  const { data, error } = await supabase
    .from('roof_topology_source_approvals')
    .select('approval_status, allows_derived_geometry, valid_until, retention_policy, max_retention_expires_at')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })
    .limit(20)

  if (error) return 'source_setup_required'
  const approvals = Array.isArray(data) ? (data as SourceApprovalRow[]) : []
  if (approvals.some((approval) => canSupportRetainedCandidateEvidence(approval))) {
    // This is intentionally non-authorizing: a future live action must choose
    // one source row, validate its durable terms, and bind it to the run.
    return 'source_approval_recorded'
  }
  if (approvals.some((approval) => hasExpiredApprovalWindow(approval))) {
    return 'source_approval_expired'
  }

  return 'source_approval_required'
}

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const gate = await requireFeature(req, 'roofing')
  if (!gate.ok) return Response.json(gate.body, { status: gate.status })

  const { id } = await ctx.params
  // Same response for malformed, missing, tenantless, and cross-tenant IDs so
  // this private route cannot be used to enumerate saved measurements.
  if (!isUuid(id)) return Response.json({ ok: false, error: 'not_found' }, { status: 404 })

  const { data: measurement, error } = await supabase
    .from('roofing_measurements')
    .select('id, tenant_id, address, postcode, state, quote, created_at')
    .eq('id', id)
    .eq('tenant_id', gate.tenant.id)
    .maybeSingle<MeasurementRow>()

  if (error || !measurement || measurement.tenant_id !== gate.tenant.id) {
    return Response.json({ ok: false, error: 'not_found' }, { status: 404 })
  }

  const structures = topologyPreviewStructures(measurement.quote)
  if (structures.length === 0) {
    return Response.json({ ok: false, error: 'measurement_unavailable' }, { status: 422 })
  }
  const location = topologyPreviewLocation(measurement)

  const response: RoofTopologyPreviewResponse = {
    ok: true,
    measurement: {
      id: measurement.id,
      address: location.address,
      postcode: location.postcode,
      state: location.state,
      createdAt: measurement.created_at,
      structures,
    },
    topology: {
      gate: await topologyGateForTenant(gate.tenant.id),
      fixturePreview: true,
      disclaimer: TOPOLOGY_PREVIEW_DISCLAIMER,
    },
  }

  return Response.json(response)
}
