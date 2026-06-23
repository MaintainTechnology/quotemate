// GET /api/tenant/historical-quotes/batches/[batchId] — 401 without a tenant,
// 404 for another tenant's batch (no existence leak), 200 when owned. Asserts
// the lookup is scoped to the authed tenant_id. Mocks repo + auth.

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/estimation/auth', () => ({ tenantFromBearer: vi.fn() }))
vi.mock('@/lib/historical-quotes/repo', () => ({ getBatch: vi.fn(), getBatchRows: vi.fn() }))

import { tenantFromBearer } from '@/lib/estimation/auth'
import { getBatch, getBatchRows } from '@/lib/historical-quotes/repo'
import { GET } from './route'

const TENANT = { id: 'tenant-A', trade: 'electrical', trades: ['electrical'] }
const ctx = { params: Promise.resolve({ batchId: 'batch-1' }) }

function req(auth = true) {
  return new Request('http://localhost/x', { headers: auth ? { authorization: 'Bearer t' } : {} })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(tenantFromBearer).mockResolvedValue(TENANT as never)
  vi.mocked(getBatchRows).mockResolvedValue([] as never)
})

describe('GET batch', () => {
  it('401 without a tenant', async () => {
    vi.mocked(tenantFromBearer).mockResolvedValue(null)
    expect((await GET(req(false), ctx)).status).toBe(401)
  })

  it("404 for another tenant's batch (no existence leak), scoped to tenant_id", async () => {
    vi.mocked(getBatch).mockResolvedValue(null)
    const res = await GET(req(), ctx)
    expect(res.status).toBe(404)
    expect(getBatch).toHaveBeenCalledWith('tenant-A', 'batch-1')
  })

  it('returns the batch + rows when owned', async () => {
    vi.mocked(getBatch).mockResolvedValue({ id: 'batch-1', status: 'awaiting_review' } as never)
    const res = await GET(req(), ctx)
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.batch.id).toBe('batch-1')
  })
})
