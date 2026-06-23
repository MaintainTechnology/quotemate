// GET /api/tenant/historical-quotes/hint — count:0 on empty history, real
// aggregation otherwise, tenant-scoped, validated job_type. Mocks repo + auth.

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/estimation/auth', () => ({ tenantFromBearer: vi.fn() }))
vi.mock('@/lib/historical-quotes/repo', () => ({ getAnalyticsRows: vi.fn() }))

import { tenantFromBearer } from '@/lib/estimation/auth'
import { getAnalyticsRows } from '@/lib/historical-quotes/repo'
import { GET } from './route'

const TENANT = { id: 'tenant-A', trade: 'electrical', trades: ['electrical'] }

function req(qs: string, auth = true) {
  return new Request(`http://localhost/api/tenant/historical-quotes/hint${qs}`, {
    headers: auth ? { authorization: 'Bearer t' } : {},
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(tenantFromBearer).mockResolvedValue(TENANT as never)
  vi.mocked(getAnalyticsRows).mockResolvedValue([])
})

describe('GET hint', () => {
  it('401 without a tenant', async () => {
    vi.mocked(tenantFromBearer).mockResolvedValue(null)
    expect((await GET(req('?job_type=downlights'))).status).toBe(401)
  })

  it('400 for an invalid job_type', async () => {
    expect((await GET(req('?job_type=not_a_real_job'))).status).toBe(400)
  })

  it('returns count:0 (scoped to the authed tenant) when there is no history', async () => {
    const res = await GET(req('?job_type=downlights'))
    const json = await res.json()
    expect(json.count).toBe(0)
    expect(json.job_type).toBe('downlights')
    expect(getAnalyticsRows).toHaveBeenCalledWith('tenant-A', 'downlights')
  })

  it('aggregates when confirmed history exists', async () => {
    vi.mocked(getAnalyticsRows).mockResolvedValue([
      { job_type: 'downlights', trade: 'electrical', price_inc_gst: 100, price_ex_gst: 90.91, quoted_at: '2026-01-01', status: 'confirmed' },
      { job_type: 'downlights', trade: 'electrical', price_inc_gst: 300, price_ex_gst: 272.73, quoted_at: '2026-02-01', status: 'confirmed' },
    ] as never)
    const json = await (await GET(req('?job_type=downlights'))).json()
    expect(json.count).toBe(2)
    expect(json.avg_price_inc_gst).toBe(200)
  })
})
