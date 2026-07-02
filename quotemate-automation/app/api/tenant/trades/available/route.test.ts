// Route-level tests for GET /api/tenant/trades/available — the read behind
// the Account-tab Trades card.
//
// Focus (the regression that shipped): with the REAL PostgREST embed shape
// (trade_pricing_defaults as a one-to-one `object | null`, not an array),
// the route must still return every activatable registry trade in
// `manageable`, tagged with ownership, plus the not-yet-owned subset in
// `available`. The original code Array.isArray-checked the embed and
// filtered out ALL trades in production.
//
// Pattern mirrors app/api/tenant/trades/reconcile/route.test.ts: mock
// @supabase/supabase-js BEFORE importing the route.

import { describe, it, expect, vi, beforeEach } from 'vitest'

type Row = Record<string, unknown>

const state: {
  user: { id: string } | null
  tenant: Row | null
  registry: Array<{ name: string; displayName: string; hasDefaults: boolean }>
  registryError: { message: string } | null
} = {
  user: { id: 'user-1' },
  tenant: null,
  registry: [],
  registryError: null,
}

function buildQueryStub(table: string) {
  if (table === 'tenants') {
    return {
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({ data: state.tenant, error: null }),
        }),
      }),
    }
  }

  if (table === 'trades') {
    // listManageableTrades: select(...).eq('active',true).eq('is_job_based',true)
    // One-to-one embed → `object | null`, the live PostgREST shape.
    const result = Promise.resolve({
      data: state.registryError
        ? null
        : state.registry.map((t) => ({
            name: t.name,
            display_name: t.displayName,
            trade_pricing_defaults: t.hasDefaults ? { trade_id: `${t.name}-def` } : null,
          })),
      error: state.registryError,
    })
    return {
      select: () => ({
        eq: () => ({
          eq: () => result,
        }),
      }),
    }
  }

  throw new Error(`unexpected table in test stub: ${table}`)
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: { getUser: () => Promise.resolve({ data: { user: state.user }, error: null }) },
    from: (table: string) => buildQueryStub(table),
  }),
}))

const { GET } = await import('./route')

function getReq() {
  return new Request('http://localhost/api/tenant/trades/available', {
    headers: { authorization: 'Bearer faketoken' },
  })
}

beforeEach(() => {
  state.user = { id: 'user-1' }
  state.tenant = {
    id: 'tenant-1',
    trade: 'electrical',
    trades: ['electrical', 'painting', 'roofing'],
  }
  state.registry = [
    { name: 'commercial_painting', displayName: 'Commercial painting', hasDefaults: true },
    { name: 'electrical', displayName: 'Electrical', hasDefaults: true },
    { name: 'painting', displayName: 'Painting', hasDefaults: true },
    { name: 'plumbing', displayName: 'Plumbing', hasDefaults: true },
    { name: 'solar', displayName: 'Solar', hasDefaults: true },
    // registered + active + job-based but NO pricing defaults → not activatable
    { name: 'aircon', displayName: 'Air Conditioning', hasDefaults: false },
  ]
  state.registryError = null
})

describe('GET /api/tenant/trades/available', () => {
  it('lists every activatable registry trade in `manageable`, tagged with ownership', async () => {
    const res = await GET(getReq())
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.ok).toBe(true)
    // All five defaults-carrying trades appear — none are lost to the
    // one-to-one embed shape. aircon (no defaults) is excluded.
    expect(json.manageable).toEqual([
      { name: 'commercial_painting', displayName: 'Commercial painting', owned: false },
      { name: 'electrical', displayName: 'Electrical', owned: true },
      { name: 'painting', displayName: 'Painting', owned: true },
      { name: 'plumbing', displayName: 'Plumbing', owned: false },
      { name: 'solar', displayName: 'Solar', owned: false },
    ])
  })

  it('returns the not-yet-owned subset as `available` (legacy consumer contract)', async () => {
    const res = await GET(getReq())
    const json = await res.json()
    expect(json.available).toEqual([
      { name: 'commercial_painting', displayName: 'Commercial painting' },
      { name: 'plumbing', displayName: 'Plumbing' },
      { name: 'solar', displayName: 'Solar' },
    ])
    // Non-registry slugs the tenant owns (roofing) are reported in `owned`
    // but never invent a manageable row.
    expect(json.owned).toContain('roofing')
    expect(json.manageable.map((t: { name: string }) => t.name)).not.toContain('roofing')
  })

  it('500s (not an empty list) when the registry read fails', async () => {
    state.registryError = { message: 'relation "trades" does not exist' }
    const res = await GET(getReq())
    const json = await res.json()
    expect(res.status).toBe(500)
    expect(json.ok).toBe(false)
  })

  it('404s when the user has no tenant', async () => {
    state.tenant = null
    const res = await GET(getReq())
    expect(res.status).toBe(404)
  })

  it('401s when no user resolves', async () => {
    state.user = null
    const res = await GET(getReq())
    expect(res.status).toBe(401)
  })
})
