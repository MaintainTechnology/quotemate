// Calibration: preview is READ-ONLY (writes nothing); apply upserts ONLY the
// approved job types, with prices recomputed server-side (spec R13/R14). Mocks
// repo data access; the calibration math runs for real inside the routes.

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/estimation/auth', () => ({ tenantFromBearer: vi.fn() }))
vi.mock('@/lib/historical-quotes/repo', () => ({
  getAnalyticsRows: vi.fn(),
  getExistingCustomAssemblyPrices: vi.fn(),
  upsertCustomAssemblies: vi.fn(),
}))

import { tenantFromBearer } from '@/lib/estimation/auth'
import {
  getAnalyticsRows,
  getExistingCustomAssemblyPrices,
  upsertCustomAssemblies,
} from '@/lib/historical-quotes/repo'
import { POST as PREVIEW } from './preview/route'
import { POST as APPLY } from './apply/route'

const TENANT = { id: 'tenant-A', trade: 'electrical', trades: ['electrical'] }

function confirmedDownlights(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    job_type: 'downlights',
    trade: 'electrical',
    price_inc_gst: 110,
    price_ex_gst: 100,
    quoted_at: `2026-0${(i % 9) + 1}-01`,
    status: 'confirmed',
  }))
}

function postReq(body: unknown, auth = true) {
  return new Request('http://localhost/x', {
    method: 'POST',
    headers: { ...(auth ? { authorization: 'Bearer t' } : {}), 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(tenantFromBearer).mockResolvedValue(TENANT as never)
  vi.mocked(getAnalyticsRows).mockResolvedValue(confirmedDownlights(4) as never)
  vi.mocked(getExistingCustomAssemblyPrices).mockResolvedValue(new Map())
  vi.mocked(upsertCustomAssemblies).mockResolvedValue(1)
})

describe('calibration preview', () => {
  it('returns proposals and writes NOTHING', async () => {
    const res = await PREVIEW(postReq({}))
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.proposals).toHaveLength(1)
    expect(json.proposals[0].job_type).toBe('downlights')
    expect(json.proposals[0].proposed_unit_price_ex_gst).toBe(100)
    expect(upsertCustomAssemblies).not.toHaveBeenCalled()
  })

  it('401 without a tenant', async () => {
    vi.mocked(tenantFromBearer).mockResolvedValue(null)
    expect((await PREVIEW(postReq({}))).status).toBe(401)
  })
})

describe('calibration apply', () => {
  it('upserts ONLY the approved, qualifying job types', async () => {
    const res = await APPLY(postReq({ job_types: ['downlights'] }))
    expect(res.status).toBe(200)
    expect(upsertCustomAssemblies).toHaveBeenCalledTimes(1)
    const arg = vi.mocked(upsertCustomAssemblies).mock.calls[0][0]
    expect(arg).toHaveLength(1)
    expect(arg[0]).toMatchObject({ tenant_id: 'tenant-A', trade: 'electrical', default_unit_price_ex_gst: 100 })
    expect(arg[0].name).toMatch(/downlight/i)
  })

  it('writes nothing when the approved job type has no qualifying history', async () => {
    await APPLY(postReq({ job_types: ['hot_water'] }))
    const arg = vi.mocked(upsertCustomAssemblies).mock.calls[0][0]
    expect(arg).toHaveLength(0)
  })

  it('400 on an invalid payload', async () => {
    expect((await APPLY(postReq({}))).status).toBe(400)
  })
})
