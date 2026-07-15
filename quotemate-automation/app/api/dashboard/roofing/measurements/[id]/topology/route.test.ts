import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => {
  type Result = { data: unknown; error: unknown }
  type Op = { op: string; args: unknown[] }
  const results: Result[] = []
  const queries: { table: string; ops: Op[] }[] = []

  function from(table: string) {
    const record = { table, ops: [] as Op[] }
    const builder: Record<string, unknown> = {}
    for (const op of ['select', 'eq', 'order', 'limit', 'maybeSingle']) {
      builder[op] = (...args: unknown[]) => {
        record.ops.push({ op, args })
        return builder
      }
    }
    builder.then = (
      resolve: (result: Result) => unknown,
      reject?: (reason: unknown) => unknown,
    ) => {
      queries.push(record)
      return Promise.resolve(results.shift() ?? { data: null, error: null }).then(resolve, reject)
    }
    return builder
  }

  return { results, queries, client: { from } }
})

vi.mock('@supabase/supabase-js', () => ({ createClient: () => h.client }))
vi.mock('@/lib/features/guard', () => ({ requireFeature: vi.fn() }))

import { GET } from './route'
import { requireFeature } from '@/lib/features/guard'

const ID = 'a0000000-0000-4000-8000-000000000001'

function request() {
  return new Request(`http://localhost/api/dashboard/roofing/measurements/${ID}/topology`, {
    headers: { authorization: 'Bearer token-1' },
  })
}

function context(id = ID) {
  return { params: Promise.resolve({ id }) }
}

function allowRoofing() {
  vi.mocked(requireFeature).mockResolvedValue({
    ok: true,
    tenant: { id: 'tenant-1', trades: ['roofing'], trade: 'roofing' },
  })
}

function measurementRow(overrides: Record<string, unknown> = {}) {
  return {
    id: ID,
    tenant_id: 'tenant-1',
    address: '7 Example Street',
    postcode: '4000',
    state: 'QLD',
    created_at: '2026-07-15T00:00:00.000Z',
    quote: {
      structures: [
        {
          buildingId: 'building-house',
          role: 'primary',
          label: 'Main dwelling',
          metrics: { form: 'hip', footprint_m2: 132.5, capture_date: '2025-06-01' },
          price: { tiers: [{ inc_gst: 10000 }] },
        },
      ],
    },
    public_token: 'must-not-leak',
    measure_token: 'must-not-leak-either',
    ...overrides,
  }
}

beforeEach(() => {
  h.results.length = 0
  h.queries.length = 0
  vi.mocked(requireFeature).mockReset()
  delete process.env.ROOFING_EDGE_ANALYSIS_ENABLED
})

describe('GET /api/dashboard/roofing/measurements/[id]/topology', () => {
  it('returns the feature guard response before reading measurements', async () => {
    vi.mocked(requireFeature).mockResolvedValue({
      ok: false,
      status: 401,
      body: { ok: false, error: 'unauthorized' },
    })
    const res = await GET(request(), context())
    expect(res.status).toBe(401)
    expect(h.queries).toEqual([])
  })

  it('uses an opaque dashboard projection and scopes the measurement read to the tenant', async () => {
    allowRoofing()
    h.results.push({ data: measurementRow(), error: null })

    const res = await GET(request(), context())
    expect(res.status).toBe(200)
    const json = await res.json() as Record<string, unknown>
    expect(JSON.stringify(json)).not.toContain('must-not-leak')
    expect(JSON.stringify(json)).not.toContain('10000')
    expect(json).toMatchObject({
      ok: true,
      topology: { gate: 'feature_disabled', fixturePreview: true },
      measurement: { id: ID, structures: [{ hasBuildingId: true, form: 'hip' }] },
    })

    const measurementQuery = h.queries.find((query) => query.table === 'roofing_measurements')
    expect(measurementQuery).toBeTruthy()
    expect(measurementQuery!.ops).toEqual(expect.arrayContaining([
      { op: 'eq', args: ['id', ID] },
      { op: 'eq', args: ['tenant_id', 'tenant-1'] },
    ]))
  })

  it('returns the same not-found response for invalid and missing measurements', async () => {
    allowRoofing()
    const invalid = await GET(request(), context('not-a-uuid'))
    expect(invalid.status).toBe(404)
    expect(h.queries).toEqual([])

    h.results.push({ data: null, error: null })
    const missing = await GET(request(), context())
    expect(missing.status).toBe(404)
  })

  it('does not treat the feature flag as a source approval', async () => {
    process.env.ROOFING_EDGE_ANALYSIS_ENABLED = 'true'
    allowRoofing()
    h.results.push(
      { data: measurementRow(), error: null },
      { data: null, error: null },
    )

    const res = await GET(request(), context())
    const json = await res.json() as { topology: { gate: string } }
    expect(json.topology.gate).toBe('source_approval_required')
    expect(h.queries.some((query) => query.table === 'roof_topology_source_approvals')).toBe(true)
  })

  it('recognises an eligible licensed source approval without selecting or calling a source', async () => {
    process.env.ROOFING_EDGE_ANALYSIS_ENABLED = 'true'
    allowRoofing()
    h.results.push(
      { data: measurementRow(), error: null },
      {
        data: [{
          approval_status: 'active',
          allows_derived_geometry: true,
          valid_until: null,
          retention_policy: 'perpetual',
          max_retention_expires_at: null,
        }],
        error: null,
      },
    )

    const res = await GET(request(), context())
    const json = await res.json() as { topology: { gate: string } }
    expect(json.topology.gate).toBe('source_approval_recorded')

    const approvalQuery = h.queries.find((query) => query.table === 'roof_topology_source_approvals')
    expect(approvalQuery?.ops).not.toEqual(expect.arrayContaining([
      { op: 'eq', args: ['geometry_source', 'approved_google_solar'] },
    ]))
  })

  it('does not report readiness for expired or no-retention approval terms', async () => {
    process.env.ROOFING_EDGE_ANALYSIS_ENABLED = 'true'
    allowRoofing()
    h.results.push(
      { data: measurementRow(), error: null },
      {
        data: [{
          approval_status: 'active',
          allows_derived_geometry: true,
          valid_until: null,
          retention_policy: 'expires',
          max_retention_expires_at: '2020-01-01T00:00:00.000Z',
        }],
        error: null,
      },
    )

    const expired = await GET(request(), context())
    expect((await expired.json() as { topology: { gate: string } }).topology.gate)
      .toBe('source_approval_expired')

    h.results.push(
      { data: measurementRow(), error: null },
      {
        data: [{
          approval_status: 'active',
          allows_derived_geometry: true,
          valid_until: null,
          retention_policy: 'none',
          max_retention_expires_at: null,
        }],
        error: null,
      },
    )

    const noRetention = await GET(request(), context())
    expect((await noRetention.json() as { topology: { gate: string } }).topology.gate)
      .toBe('source_approval_required')
  })
})
