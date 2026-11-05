import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ auth: vi.fn(), rates: vi.fn(), engine: vi.fn(), from: vi.fn(), insert: vi.fn() }))
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ from: h.from }) }))
vi.mock('@/lib/tenant/from-request', () => ({ resolveTenantRequest: h.auth }))
vi.mock('@/lib/painting/quote-dispatch', () => ({ loadPaintingRateCard: h.rates }))
vi.mock('@/lib/painting/measure', () => ({ estimatePainting: h.engine }))

import { POST as estimate } from './estimate/route'
import { POST as save } from './save/route'

const inputs = { scopes: ['walls'], coats: 2, condition: 'sound', ceiling_height: 'standard', colour_change: false }
const address = { address: '10 Test Street Sydney', postcode: '2000', state: 'NSW' }
const card = { gst_registered: true, rate_per_unit: { walls: 20 } }
const computed = { provider: 'solar', measurement: { floor_area_m2: 100 }, price: {
  total_area_m2: 200, confidence: 'high', routing: { decision: 'auto_quote' },
  tiers: [{ tier: 'good', inc_gst: 1100 }, { tier: 'better', inc_gst: 2200 }, { tier: 'best', inc_gst: 3300 }],
} }
const request = (extra: object = {}) => new Request('https://example.test/api/painting', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ address, inputs, source: 'mock', estimate: { price: { tiers: [{ inc_gst: 1 }] } }, ...extra }),
})

beforeEach(() => {
  vi.clearAllMocks()
  h.auth.mockResolvedValue({ tenant: { id: 'tenant-a', trade: 'painting', owner_user_id: 'owner-a' },
    identity: { provider: 'supabase', userId: 'owner-a' } })
  h.rates.mockResolvedValue(card)
  h.engine.mockResolvedValue({ ok: true, estimate: structuredClone(computed) })
  const query = { insert: h.insert, select: vi.fn(), single: vi.fn().mockResolvedValue({
    data: { id: 'draft-1', public_token: 'customer-token', estimate_token: 'owner-token' }, error: null,
  }) }
  h.insert.mockReturnValue(query)
  query.select.mockReturnValue(query)
  h.from.mockReturnValue(query)
})

describe('painting API uses server pricing and explicit review for every account', () => {
  it.each([estimate, save])('rejects unauthenticated requests before pricing', async (route) => {
    h.auth.mockResolvedValue(null)
    expect((await route(request())).status).toBe(401)
    expect(h.engine).not.toHaveBeenCalled()
  })
  it.each([estimate, save])('does not use default rates for a user without a tenant', async (route) => {
    h.auth.mockResolvedValue({ tenant: null, identity: { provider: 'supabase', userId: 'orphan-user' } })
    expect((await route(request())).status).toBe(422)
    expect(h.rates).not.toHaveBeenCalled()
    expect(h.engine).not.toHaveBeenCalled()
  })
  it.each([estimate, save])('holds missing or incomplete tenant rate cards', async (route) => {
    h.rates.mockResolvedValue(undefined)
    expect((await route(request())).status).toBe(422)
    expect(h.engine).not.toHaveBeenCalled()
    expect(h.insert).not.toHaveBeenCalled()
  })
  it('calculates using only the authenticated tenant card', async () => {
    const response = await estimate(request({ tenant_id: 'victim-tenant' }))
    expect(response.status).toBe(200)
    expect(h.rates).toHaveBeenCalledWith(expect.anything(), 'tenant-a', 'painting')
    expect(h.engine).toHaveBeenCalledWith(address, inputs, { rateCard: card })
  })
  it('ignores client money/source and saves an unreleased server-calculated snapshot', async () => {
    const response = await save(request({ tenant_id: 'victim-tenant' }))
    expect(response.status).toBe(200)
    expect(h.insert).toHaveBeenCalledWith(expect.objectContaining({ tenant_id: 'tenant-a',
      source: 'solar', released_at: null, better_inc_gst: 2200,
      estimate: { ...computed, pricing_authority: { source: 'tenant_painting_rate_card', tenant_id: 'tenant-a',
        rate_card: card, calculation: 'painting-v1' } },
    }))
    expect(await response.json()).toMatchObject({ status: 'awaiting_tradie_approval',
      reviewUrl: '/dashboard/quote-review?family=paint&id=draft-1' })
  })
  it('does not save a fabricated quote after measurement failure', async () => {
    h.engine.mockResolvedValue({ ok: false, code: 'measurement_provider_required', detail: 'Configure measurement.' })
    expect((await save(request())).status).toBe(422)
    expect(h.insert).not.toHaveBeenCalled()
  })
})
