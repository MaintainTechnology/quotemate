// Route-level tests for POST /api/tenant/trades (R39).
//
// Focus: activating a NEW trade must
//   1. insert a pricing_book row for it,
//   2. seed its service offerings,
//   3. seed an EMPTY tenant_licences slot for it (so GET /api/tenant/me can
//      render a blank licence fieldset — the R39-client contract), and
//   4. return the updated trades[] in the success envelope.
//
// Pattern mirrors app/api/tenant/me/route.test.ts: mock @supabase/supabase-js
// AND the Vapi update helper BEFORE importing the route, because the route's
// module-level createClient(...) runs at import time.

import { describe, it, expect, vi, beforeEach } from 'vitest'

type Row = Record<string, unknown>

const state: {
  user: { id: string } | null
  tenant: Row | null
  // recorder
  pricingBookInserts: Row[][]
  offeringsUpserts: Row[][]
  licenceUpserts: Row[][]
  tenantUpdates: Row[]
  // what shared_assemblies returns for the added trades
  sharedAssemblies: Row[]
  // existing pricing_book rows for the toAdd "already have" check
  existingPricingBookTrades: string[]
} = {
  user: { id: 'user-1' },
  tenant: null,
  pricingBookInserts: [],
  offeringsUpserts: [],
  licenceUpserts: [],
  tenantUpdates: [],
  sharedAssemblies: [],
  existingPricingBookTrades: [],
}

function buildQueryStub(table: string) {
  if (table === 'tenants') {
    return {
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({ data: state.tenant, error: null }),
        }),
      }),
      update: (payload: Row) => ({
        eq: () => {
          state.tenantUpdates.push(payload)
          return Promise.resolve({ error: null })
        },
      }),
    }
  }

  if (table === 'pricing_book') {
    return {
      // Two distinct selects in the route:
      //   a) templateRates: select(...).eq(tenant_id).limit(1).maybeSingle()
      //   b) existing toAdd check: select('trade').eq(tenant_id).in('trade', toAdd)
      select: () => ({
        eq: () => ({
          limit: () => ({
            maybeSingle: () => Promise.resolve({ data: null, error: null }),
          }),
          in: (_col: string, _trades: string[]) =>
            Promise.resolve({
              data: state.existingPricingBookTrades.map((t) => ({ trade: t })),
              error: null,
            }),
        }),
      }),
      insert: (rows: Row | Row[]) => {
        state.pricingBookInserts.push(Array.isArray(rows) ? rows : [rows])
        return Promise.resolve({ error: null })
      },
      delete: () => ({ eq: () => ({ in: () => Promise.resolve({ error: null }) }) }),
    }
  }

  if (table === 'shared_assemblies') {
    return {
      select: () => ({
        in: () => Promise.resolve({ data: state.sharedAssemblies, error: null }),
      }),
    }
  }

  if (table === 'tenant_service_offerings') {
    return {
      upsert: (rows: Row[]) => {
        state.offeringsUpserts.push(rows)
        return Promise.resolve({ error: null })
      },
      update: () => ({ eq: () => ({ in: () => Promise.resolve({ error: null }) }) }),
    }
  }

  if (table === 'tenant_licences') {
    return {
      upsert: (rows: Row[]) => {
        state.licenceUpserts.push(rows)
        return Promise.resolve({ error: null })
      },
      delete: () => ({ eq: () => ({ in: () => Promise.resolve({ error: null }) }) }),
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

// Vapi update is non-fatal + network-bound — stub it so the test stays offline.
vi.mock('@/lib/vapi/update-assistant', () => ({
  updateVapiAssistant: () => Promise.resolve({ ok: true, stubbed: true }),
}))

const { POST } = await import('./route')

function postReq(body: unknown) {
  return new Request('http://localhost/api/tenant/trades', {
    method: 'POST',
    headers: { authorization: 'Bearer faketoken', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  state.user = { id: 'user-1' }
  // Electrical-only tenant; we add plumbing.
  state.tenant = {
    id: 'tenant-1',
    business_name: 'Pilot Sparky',
    trade: 'electrical',
    trades: ['electrical'],
    vapi_assistant_id: null,
    state: 'NSW',
  }
  state.pricingBookInserts = []
  state.offeringsUpserts = []
  state.licenceUpserts = []
  state.tenantUpdates = []
  state.sharedAssemblies = [
    { id: 'asm-plumb-1', default_enabled: true },
    { id: 'asm-plumb-2', default_enabled: false },
  ]
  state.existingPricingBookTrades = []
})

describe('POST /api/tenant/trades — R39 activate a new trade', () => {
  it('adds plumbing: inserts pricing_book + seeds offerings + seeds an EMPTY licence slot + returns trades[]', async () => {
    const res = await POST(postReq({ trades: ['electrical', 'plumbing'] }))
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.ok).toBe(true)
    expect(json.trades).toEqual(['electrical', 'plumbing'])
    expect(json.added).toEqual(['plumbing'])
    expect(json.removed).toEqual([])

    // 1. pricing_book row inserted for plumbing
    expect(state.pricingBookInserts).toHaveLength(1)
    expect(state.pricingBookInserts[0].map((r) => r.trade)).toEqual(['plumbing'])

    // 2. service offerings seeded (default_enabled honoured)
    expect(state.offeringsUpserts).toHaveLength(1)
    expect(state.offeringsUpserts[0]).toEqual([
      { tenant_id: 'tenant-1', assembly_id: 'asm-plumb-1', enabled: true },
      { tenant_id: 'tenant-1', assembly_id: 'asm-plumb-2', enabled: false },
    ])

    // 3. EMPTY licence slot seeded for plumbing — this is what lets GET
    //    /api/tenant/me render a blank licence fieldset (R39-client).
    expect(state.licenceUpserts).toHaveLength(1)
    expect(state.licenceUpserts[0]).toEqual([
      { tenant_id: 'tenant-1', trade: 'plumbing', licence_state: 'NSW' },
    ])

    // 4. tenants.trades + scalar trade kept in sync
    expect(state.tenantUpdates).toContainEqual({
      trades: ['electrical', 'plumbing'],
      trade: 'electrical',
    })
  })

  it('preserves a feature trade (painting) when adding a labour trade', async () => {
    // Tenant signed up for electrical + painting; now adds plumbing. Painting
    // must survive the reconcile — this endpoint manages only labour trades.
    state.tenant = {
      id: 'tenant-1',
      business_name: 'Pilot Sparky',
      trade: 'electrical',
      trades: ['electrical', 'painting'],
      vapi_assistant_id: null,
      state: 'NSW',
    }
    const res = await POST(postReq({ trades: ['electrical', 'plumbing'] }))
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.ok).toBe(true)
    expect(json.added).toEqual(['plumbing'])
    expect(json.removed).toEqual([])
    expect(json.trades).toEqual(['electrical', 'plumbing', 'painting'])
    expect(state.tenantUpdates).toContainEqual({
      trades: ['electrical', 'plumbing', 'painting'],
      trade: 'electrical',
    })
  })

  it('does not drop painting when a labour trade is removed', async () => {
    state.tenant = {
      id: 'tenant-1',
      business_name: 'Pilot Sparky',
      trade: 'electrical',
      trades: ['electrical', 'plumbing', 'painting'],
      vapi_assistant_id: null,
      state: 'NSW',
    }
    const res = await POST(postReq({ trades: ['electrical'] }))
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.ok).toBe(true)
    expect(json.removed).toEqual(['plumbing'])
    expect(json.trades).toEqual(['electrical', 'painting'])
    expect(state.tenantUpdates).toContainEqual({
      trades: ['electrical', 'painting'],
      trade: 'electrical',
    })
  })

  it('noop preserves an existing feature trade in the reported portfolio', async () => {
    state.tenant = {
      id: 'tenant-1',
      business_name: 'Pilot Sparky',
      trade: 'electrical',
      trades: ['electrical', 'painting'],
      vapi_assistant_id: null,
      state: 'NSW',
    }
    const res = await POST(postReq({ trades: ['electrical'] }))
    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(json.noop).toBe(true)
    expect(json.trades).toEqual(['electrical', 'painting'])
    expect(state.pricingBookInserts).toHaveLength(0)
  })

  it('noop when desired equals current (no seeding, no licence slot churn)', async () => {
    const res = await POST(postReq({ trades: ['electrical'] }))
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.ok).toBe(true)
    expect(json.noop).toBe(true)
    expect(state.pricingBookInserts).toHaveLength(0)
    expect(state.offeringsUpserts).toHaveLength(0)
    expect(state.licenceUpserts).toHaveLength(0)
  })

  it('rejects an empty trades[] with a 400', async () => {
    const res = await POST(postReq({ trades: [] }))
    const json = await res.json()
    expect(res.status).toBe(400)
    expect(json.ok).toBe(false)
    expect(json.error).toBe('validation_failed')
  })

  it('401 when no tenant resolves for the user', async () => {
    state.user = null
    const res = await POST(postReq({ trades: ['plumbing'] }))
    expect(res.status).toBe(401)
  })
})
