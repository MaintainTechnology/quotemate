// Tenant isolation: every historical-quotes route returns 401 when no tenant
// resolves from the bearer token (spec R16 / Definition of done). The repo +
// auth + import-run modules are mocked so importing the routes never touches a
// live Supabase client.

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/estimation/auth', () => ({ tenantFromBearer: vi.fn() }))
vi.mock('@/lib/historical-quotes/import-run', () => ({ runHistoricalImport: vi.fn() }))
vi.mock('next/server', () => ({ after: (fn: () => unknown) => fn }))
vi.mock('@/lib/historical-quotes/repo', () => ({
  createImportBatch: vi.fn(),
  updateBatch: vi.fn(),
  getBatch: vi.fn(),
  getBatchRows: vi.fn(),
  insertHistoricalQuotes: vi.fn(),
  listConfirmed: vi.fn(),
  getAnalyticsRows: vi.fn(),
  applyReview: vi.fn(),
  getExistingCustomAssemblyPrices: vi.fn(),
  upsertCustomAssemblies: vi.fn(),
  uploadHistoricalPdf: vi.fn(),
  registerFileDocument: vi.fn(),
}))

import { tenantFromBearer } from '@/lib/estimation/auth'

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(tenantFromBearer).mockResolvedValue(null)
})

function jsonReq(method: string, body?: unknown) {
  return new Request('http://localhost/api/tenant/historical-quotes', {
    method,
    ...(body
      ? { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }
      : {}),
  })
}

describe('historical-quotes routes — 401 without a resolved tenant', () => {
  it('import POST → 401', async () => {
    const { POST } = await import('./import/route')
    expect((await POST(new Request('http://localhost', { method: 'POST' }))).status).toBe(401)
  })

  it('browse GET → 401', async () => {
    const { GET } = await import('./route')
    expect((await GET(jsonReq('GET'))).status).toBe(401)
  })

  it('analytics GET → 401', async () => {
    const { GET } = await import('./analytics/route')
    expect((await GET(jsonReq('GET'))).status).toBe(401)
  })

  it('hint GET → 401', async () => {
    const { GET } = await import('./hint/route')
    const req = new Request('http://localhost/api/tenant/historical-quotes/hint?job_type=downlights')
    expect((await GET(req)).status).toBe(401)
  })

  it('batches GET → 401', async () => {
    const { GET } = await import('./batches/[batchId]/route')
    const res = await GET(jsonReq('GET'), { params: Promise.resolve({ batchId: 'b1' }) })
    expect(res.status).toBe(401)
  })

  it('review POST → 401', async () => {
    const { POST } = await import('./review/route')
    expect((await POST(jsonReq('POST', { updates: [] }))).status).toBe(401)
  })

  it('calibration preview POST → 401', async () => {
    const { POST } = await import('./calibration/preview/route')
    expect((await POST(jsonReq('POST'))).status).toBe(401)
  })

  it('calibration apply POST → 401', async () => {
    const { POST } = await import('./calibration/apply/route')
    expect((await POST(jsonReq('POST', { job_types: ['downlights'] }))).status).toBe(401)
  })
})
