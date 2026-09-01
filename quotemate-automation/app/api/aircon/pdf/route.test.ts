import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  after: vi.fn(),
  buildAirconReportHtml: vi.fn(() => '<html>server recommendation</html>'),
  from: vi.fn(),
  loadTenantAcPricingContext: vi.fn(),
  renderPdfFromHtml: vi.fn(async () => Buffer.from('pdf')),
  resolveTenantRequest: vi.fn(),
}))

vi.mock('next/server', () => ({ after: mocks.after }))
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ from: mocks.from }) }))
vi.mock('@/lib/tenant/from-request', () => ({ resolveTenantRequest: mocks.resolveTenantRequest }))
vi.mock('@/lib/pdf/gotenberg', () => ({
  gotenbergConfigured: () => true,
  renderPdfFromHtml: mocks.renderPdfFromHtml,
}))
vi.mock('@/lib/aircon/report-html', () => ({ buildAirconReportHtml: mocks.buildAirconReportHtml }))
vi.mock('@/lib/aircon/pricing-context', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/aircon/pricing-context')>()
  return {
    ...actual,
    loadTenantAcPricingContext: mocks.loadTenantAcPricingContext,
  }
})
vi.mock('@/lib/pdf/branding', () => ({ loadTenantBranding: vi.fn(async () => ({ businessName: 'Tenant Air' })) }))
vi.mock('@/lib/quote/pdf', () => ({ storeQuoteAsset: vi.fn() }))
vi.mock('@/lib/filestore/ingest-quote', () => ({ archiveAndIngestQuote: vi.fn() }))

import { POST } from './route'

const AUTHORITY = {
  source: 'tenant_pricing_book' as const,
  tenant_id: 'tenant-1',
  pricing_book_id: 'book-1',
  revision: 'a'.repeat(64),
}

const storedRecommendation = {
  pricing_status: 'priced',
  pricing_authority: AUTHORITY,
  sizing: {
    rooms: [], conditioned_zones: 3, total_floor_area_m2: 120,
    floor_area_source: 'entered', total_volume_m3: 288, ceiling_height_m: 2.4,
    storeys: 1, volumetric_factor_kw_m3: 0.045, connected_kw: 10,
    connected_kw_low: 9, connected_kw_high: 11, ducted_kw: 8,
    confidence: 'high', notes: [], warnings: [],
  },
  options: [{
    system_type: 'ducted', capacity_kw: 8, price: { low: 10000, high: 12000 },
    pricing: {
      point_estimate_ex_gst: 10000, point_estimate_inc_gst: 11000,
      confidence_band_pct: 10, gst_registered: true, formula: 'tenant card',
      band_reason: 'site conditions', components: [], adjustments: [],
    },
    best_fit: true, pros: ['Whole-home'], cons: ['Roof access'],
  }],
  routing: { decision: 'book_assessment', reason: 'Confirm on site.' },
  confidence: 'high',
}

function installRecommendationRow(row: unknown) {
  const q: Record<string, unknown> = {}
  q.select = vi.fn(() => q)
  q.eq = vi.fn(() => q)
  q.maybeSingle = vi.fn(async () => ({ data: row, error: null }))
  mocks.from.mockReturnValue(q)
  return q
}

function request(body: unknown) {
  return new Request('http://localhost/api/aircon/pdf', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.resolveTenantRequest.mockResolvedValue({
    identity: { provider: 'clerk', userId: 'user-1' },
    tenant: { id: 'tenant-1', business_name: 'Tenant Air', trade: 'aircon' },
  })
  mocks.loadTenantAcPricingContext.mockResolvedValue({
    rateCard: {},
    authority: AUTHORITY,
  })
  installRecommendationRow(null)
})

describe('aircon PDF pricing authority', () => {
  it('rejects a caller-authored priced recommendation instead of rendering money', async () => {
    const response = await POST(request({
        address: '1 Test St',
        climateZone: 'subtropical',
        recommendation: {
          pricing_status: 'priced',
          sizing: {},
          options: [{ price: { low: 1, high: 999999 } }],
          routing: {},
        },
      }))

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ ok: false, error: 'invalid_recommendation_id' })
    expect(mocks.buildAirconReportHtml).not.toHaveBeenCalled()
    expect(mocks.renderPdfFromHtml).not.toHaveBeenCalled()
  })

  it('renders only the tenant-scoped server-owned priced recommendation', async () => {
    const q = installRecommendationRow({
      id: 'rec-1', tenant_id: 'tenant-1', address: '1 Server St',
      postcode: '4000', state: 'QLD', recommendation: storedRecommendation,
    })

    const response = await POST(request({ recommendationId: 'rec-1' }))

    expect(response.status).toBe(200)
    expect(q.eq).toHaveBeenCalledWith('id', 'rec-1')
    expect(q.eq).toHaveBeenCalledWith('tenant_id', 'tenant-1')
    expect(mocks.buildAirconReportHtml).toHaveBeenCalledWith(expect.objectContaining({
      address: '1 Server St',
      recommendation: storedRecommendation,
      climateZone: 'subtropical',
    }))
  })

  it('does not render a cross-tenant or missing recommendation id', async () => {
    installRecommendationRow(null)

    const response = await POST(request({ recommendationId: 'rec-other-tenant' }))

    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({ ok: false, error: 'recommendation_not_found' })
    expect(mocks.renderPdfFromHtml).not.toHaveBeenCalled()
  })

  it('blocks refetch/reopen after the tenant pricing revision changes or disappears', async () => {
    installRecommendationRow({
      id: 'rec-1', tenant_id: 'tenant-1', address: '1 Server St',
      postcode: '4000', state: 'QLD', recommendation: storedRecommendation,
    })
    mocks.loadTenantAcPricingContext.mockResolvedValueOnce({
      rateCard: {},
      authority: { ...AUTHORITY, revision: 'b'.repeat(64) },
    })
    const stale = await POST(request({ recommendationId: 'rec-1' }))
    expect(stale.status).toBe(409)
    expect(await stale.json()).toEqual({ ok: false, error: 'pricing_stale' })
    expect(mocks.renderPdfFromHtml).not.toHaveBeenCalled()

    mocks.loadTenantAcPricingContext.mockResolvedValueOnce(null)
    const missing = await POST(request({ recommendationId: 'rec-1' }))
    expect(missing.status).toBe(409)
    expect(await missing.json()).toEqual({ ok: false, error: 'pricing_stale' })
    expect(mocks.renderPdfFromHtml).not.toHaveBeenCalled()
  })

  it('fails closed when the stored recommendation is malformed or unpriced', async () => {
    installRecommendationRow({
      id: 'rec-1', tenant_id: 'tenant-1', address: '1 Server St',
      postcode: '4000', state: 'QLD',
      recommendation: { pricing_status: 'tenant_pricing_required', sizing: {}, routing: {} },
    })

    const response = await POST(request({ recommendationId: 'rec-1' }))

    expect(response.status).toBe(422)
    expect(await response.json()).toMatchObject({ ok: false, error: 'tenant_pricing_required' })
    expect(mocks.renderPdfFromHtml).not.toHaveBeenCalled()
  })

  it('fails closed for a caller without a tenant', async () => {
    mocks.resolveTenantRequest.mockResolvedValue({
      identity: { provider: 'clerk', userId: 'user-1' },
      tenant: null,
    })

    const response = await POST(request({ recommendationId: 'rec-1' }))

    expect(response.status).toBe(422)
    expect(await response.json()).toMatchObject({ ok: false, error: 'tenant_pricing_required' })
    expect(mocks.from).not.toHaveBeenCalled()
    expect(mocks.renderPdfFromHtml).not.toHaveBeenCalled()
  })
})
