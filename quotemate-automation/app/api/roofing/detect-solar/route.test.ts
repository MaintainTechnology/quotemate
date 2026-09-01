import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  loadTenantRoofingPricingContext: vi.fn(),
  resolveTenantRequest: vi.fn(),
}))

vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({}) }))
vi.mock('@/lib/tenant/from-request', () => ({ resolveTenantRequest: mocks.resolveTenantRequest }))
vi.mock('@/lib/roofing/pricing-authority', () => ({
  loadTenantRoofingPricingContext: mocks.loadTenantRoofingPricingContext,
}))

import { POST } from './route'

const AUTHORITY = {
  source: 'tenant_pricing_book' as const,
  tenant_id: 'tenant-1',
  pricing_book_id: 'book-1',
  revision: 'a'.repeat(64),
}

function request(body: Record<string, unknown> = {}) {
  return new Request('http://localhost/api/roofing/detect-solar', {
    method: 'POST',
    body: JSON.stringify({
      address: '1 Test Street, Brisbane',
      intent: 'full_reroof',
      expected_pricing_revision: AUTHORITY.revision,
      ...body,
    }),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('GOOGLE_MAPS_API_KEY', 'maps-test-key')
  vi.stubEnv('GEMINI_API_KEY', 'gemini-test-key')
  vi.stubGlobal('fetch', vi.fn())
  mocks.resolveTenantRequest.mockResolvedValue({
    identity: { provider: 'clerk', userId: 'user-1' },
    tenant: { id: 'tenant-1', trade: 'roofing' },
  })
  mocks.loadTenantRoofingPricingContext.mockResolvedValue({
    rateCard: {},
    authority: AUTHORITY,
  })
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('roof solar allowance pricing authority', () => {
  it('stops tenant-less or missing pricing setup before any external call', async () => {
    mocks.resolveTenantRequest.mockResolvedValueOnce({
      identity: { provider: 'clerk', userId: 'user-1' },
      tenant: null,
    })
    const tenantless = await POST(request())
    expect(tenantless.status).toBe(422)
    expect(await tenantless.json()).toEqual({ ok: false, error: 'tenant_pricing_required' })

    mocks.loadTenantRoofingPricingContext.mockResolvedValueOnce(null)
    const missing = await POST(request())
    expect(missing.status).toBe(422)
    expect(await missing.json()).toEqual({ ok: false, error: 'tenant_pricing_required' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('rejects a stale measurement revision before satellite or AI I/O', async () => {
    const response = await POST(request({ expected_pricing_revision: 'b'.repeat(64) }))
    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ ok: false, error: 'pricing_stale' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('strictly rejects caller-authored money fields', async () => {
    const response = await POST(request({ allowance: { inc_gst: 1 }, total: 1 }))
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ ok: false, error: 'invalid_request' })
    expect(mocks.loadTenantRoofingPricingContext).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })
})
