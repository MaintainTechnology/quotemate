import { beforeEach, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn(), rates: vi.fn(), engine: vi.fn(),
  row: {} as Record<string, unknown>, payloads: vi.fn() }))
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ from: h.from, rpc: h.rpc }) }))
vi.mock('next/server', () => ({ after: vi.fn() }))
vi.mock('@/lib/solar/intake', () => ({ runSolarEstimate: h.engine }))
vi.mock('@/lib/solar/config', () => ({ loadSolarConfig: async () => ({ version: 'test-config' }) }))
vi.mock('@/lib/solar/rate-card-overlay', () => ({ loadSolarTenantRates: h.rates, depositPctFromOverlay: () => 25 }))
vi.mock('@/lib/solar/sun-assets', () => ({ applySolarSunAssets: vi.fn() }))
vi.mock('@/lib/solar/geocode', () => ({ geocodeAddress: vi.fn() }))
vi.mock('@/lib/solar/data-layers', () => ({ fetchSolarDataLayers: vi.fn() }))
vi.mock('@/lib/solar/buildings', () => ({ polygonCentroid: () => null }))
vi.mock('@/lib/solar/redraft', () => ({ reconstructSolarInputs: () => ({
  input: { address: 'Test Street', postcode: '2000', state: 'NSW' }, phase: 'single', panelType: 'standard_panels',
}) }))
vi.mock('@/lib/solar/persist-helpers', () => ({ buildSolarRowPayloads: h.payloads }))
vi.mock('@/lib/solar/quote-page-row', () => ({ resolveSolarQuoteView: () => ({ confirmed: false, showPrices: false }) }))

import { POST } from './route'
const target = { lat: -33.8, lng: 151.2 }
const card = { gst_registered: true, install_rate_per_kw: { standard_panels: 1234 } }
const fresh = { token: 'new-generated-token', coverage_source: 'google', context: { location: target },
  price: { tiers: [{ net_inc_gst: 5500 }] } }
const request = () => new Request('https://example.test/api/solar/q/token-1234/select-building', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ building_id: 'roof-b' }),
})
const context = { params: Promise.resolve({ token: 'token-1234' }) }

beforeEach(() => {
  vi.clearAllMocks()
  h.row = { id: 'solar-row', tenant_id: 'tenant-b', public_token: 'token-1234', confirmed_at: null, paid_at: null,
    selected_building_id: 'roof-a', estimate: { context: { location: { lat: 0, lng: 0 } } },
    buildings: [{ building_id: 'roof-b', centroid: target, footprint: null, solar_status: 'ready' }] }
  h.from.mockImplementation((table) => {
    // A legacy cache could contain default rates or another pricing revision.
    // Reading it is itself a regression, even if its numbers look plausible.
    if (table !== 'solar_estimates') throw new Error(`Unapproved price-cache read: ${table}`)
    const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: h.row, error: null }) }
    return query
  })
  h.rates.mockResolvedValue({ config: { version: 'test-config' }, rateCard: card, overlay: { deposit_pct: 25 } })
  h.engine.mockResolvedValue(fresh)
  h.rpc.mockResolvedValue({ data: true, error: null })
  h.payloads.mockImplementation(({ estimate }) => ({ solarEstimate: { estimate }, quote: { total_inc_gst: 5500 } }))
})

it('reprices a selected building with current tenant rates instead of restoring unversioned cached money', async () => {
  const response = await POST(request(), context)
  expect(response.status).toBe(200)
  expect(h.rates).toHaveBeenCalledWith(expect.anything(), 'tenant-b', { version: 'test-config' })
  expect(h.engine).toHaveBeenCalledWith(expect.objectContaining({ rateCard: card,
    opts: expect.objectContaining({ targetLocation: target }) }))
  expect(h.rpc).toHaveBeenCalledWith('sms_redraft_solar_owned', expect.objectContaining({
    p_tenant_id: 'tenant-b', p_expected: h.row,
    p_changes: expect.objectContaining({ estimate: { ...fresh, token: 'token-1234' } }),
  }))
})
it('blocks missing tenant prices before engine, cache or writes', async () => {
  h.rates.mockRejectedValue(new Error('Complete tenant card'))
  const response = await POST(request(), context)
  expect(response.status).toBe(422)
  expect(await response.json()).toMatchObject({ error: 'tenant_pricing_required' })
  expect(h.engine).not.toHaveBeenCalled()
  expect(h.rpc).not.toHaveBeenCalled()
})
it('keeps an owner-approved estimate immutable', async () => {
  h.row.confirmed_at = '2026-09-23T00:00:00Z'
  expect((await POST(request(), context)).status).toBe(409)
  expect(h.engine).not.toHaveBeenCalled()
  expect(h.rpc).not.toHaveBeenCalled()
})
