// Route-level tests for POST /api/tenant/trades/reconcile — the unified
// Account-tab "Save trades" path.
//
// Focus: the reconcile must
//   1. ACTIVATE each newly-selected trade via the activate_trade_for_tenant
//      RPC (the genuine atomic activation),
//   2. DEACTIVATE each deselected managed trade (disable its offerings +
//      drop its pricing_book/licence rows),
//   3. PRESERVE non-managed (non-registry) slugs verbatim,
//   4. reject a slug that is not an activatable registry trade,
//   5. persist the reconciled tenants.trades[] and report activated/deactivated.
//
// Pattern mirrors app/api/tenant/trades/route.test.ts: mock
// @supabase/supabase-js AND the Vapi helper BEFORE importing the route.

import { describe, it, expect, vi, beforeEach } from 'vitest'

type Row = Record<string, unknown>

const state: {
  user: { id: string } | null
  tenant: Row | null
  // registry of manageable trades (active + job_based + has defaults)
  registry: Array<{ name: string; hasDefaults: boolean }>
  // recorders
  rpcCalls: Array<{ fn: string; trade: string }>
  rpcError: { message: string } | null
  tenantUpdates: Row[]
  assembliesQueriedFor: string[]
  offeringsDisabled: boolean
  pricingBookDeletes: string[]
} = {
  user: { id: 'user-1' },
  tenant: null,
  registry: [],
  rpcCalls: [],
  rpcError: null,
  tenantUpdates: [],
  assembliesQueriedFor: [],
  offeringsDisabled: false,
  pricingBookDeletes: [],
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

  if (table === 'trades') {
    // loadManageableTrades: select(...).eq('active',true).eq('is_job_based',true)
    const result = Promise.resolve({
      data: state.registry.map((t) => ({
        name: t.name,
        trade_pricing_defaults: t.hasDefaults ? [{ trade_id: `${t.name}-def` }] : [],
      })),
      error: null,
    })
    return {
      select: () => ({
        eq: () => ({
          eq: () => result,
        }),
      }),
    }
  }

  if (table === 'shared_assemblies') {
    return {
      select: () => ({
        eq: (_col: string, trade: string) => {
          state.assembliesQueriedFor.push(trade)
          return Promise.resolve({ data: [{ id: `asm-${trade}` }], error: null })
        },
      }),
    }
  }

  if (table === 'tenant_service_offerings') {
    return {
      update: () => ({
        eq: () => ({
          in: () => {
            state.offeringsDisabled = true
            return Promise.resolve({ error: null })
          },
        }),
      }),
    }
  }

  if (table === 'pricing_book') {
    return {
      delete: () => ({
        eq: () => ({
          eq: (_col: string, trade: string) => {
            state.pricingBookDeletes.push(trade)
            return Promise.resolve({ error: null })
          },
        }),
      }),
    }
  }

  if (table === 'tenant_licences') {
    return {
      delete: () => ({ eq: () => ({ eq: () => Promise.resolve({ error: null }) }) }),
    }
  }

  throw new Error(`unexpected table in test stub: ${table}`)
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: { getUser: () => Promise.resolve({ data: { user: state.user }, error: null }) },
    from: (table: string) => buildQueryStub(table),
    rpc: (fn: string, args: { p_trade: string }) => {
      state.rpcCalls.push({ fn, trade: args.p_trade })
      return Promise.resolve({ data: { ok: true }, error: state.rpcError })
    },
  }),
}))

vi.mock('@/lib/vapi/update-assistant', () => ({
  updateVapiAssistant: () => Promise.resolve({ ok: true, stubbed: true }),
}))

const { POST } = await import('./route')

function postReq(body: unknown) {
  return new Request('http://localhost/api/tenant/trades/reconcile', {
    method: 'POST',
    headers: { authorization: 'Bearer faketoken', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  state.user = { id: 'user-1' }
  state.tenant = {
    id: 'tenant-1',
    business_name: 'Pilot Sparky',
    trade: 'electrical',
    trades: ['electrical'],
    vapi_assistant_id: null,
  }
  state.registry = [
    { name: 'electrical', hasDefaults: true },
    { name: 'plumbing', hasDefaults: true },
    { name: 'painting', hasDefaults: true },
    { name: 'solar', hasDefaults: true },
    { name: 'commercial_painting', hasDefaults: true },
  ]
  state.rpcCalls = []
  state.rpcError = null
  state.tenantUpdates = []
  state.assembliesQueriedFor = []
  state.offeringsDisabled = false
  state.pricingBookDeletes = []
})

describe('POST /api/tenant/trades/reconcile', () => {
  it('activates newly-selected trades via the RPC and persists the portfolio', async () => {
    const res = await POST(postReq({ trades: ['electrical', 'painting', 'solar'] }))
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.ok).toBe(true)
    expect(json.activated.sort()).toEqual(['painting', 'solar'])
    expect(json.deactivated).toEqual([])
    // Genuine activation — one RPC per new trade.
    expect(state.rpcCalls.map((c) => c.fn)).toEqual([
      'activate_trade_for_tenant',
      'activate_trade_for_tenant',
    ])
    expect(state.rpcCalls.map((c) => c.trade).sort()).toEqual(['painting', 'solar'])
    expect(state.tenantUpdates).toContainEqual({
      trades: ['electrical', 'painting', 'solar'],
      trade: 'electrical',
    })
  })

  it('deactivates a deselected managed trade (offerings + pricing_book)', async () => {
    state.tenant = {
      id: 'tenant-1',
      business_name: 'Pilot Sparky',
      trade: 'electrical',
      trades: ['electrical', 'painting'],
      vapi_assistant_id: null,
    }
    const res = await POST(postReq({ trades: ['electrical'] }))
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.ok).toBe(true)
    expect(json.activated).toEqual([])
    expect(json.deactivated).toEqual(['painting'])
    expect(state.assembliesQueriedFor).toContain('painting')
    expect(state.offeringsDisabled).toBe(true)
    expect(state.pricingBookDeletes).toContain('painting')
    expect(state.tenantUpdates).toContainEqual({
      trades: ['electrical'],
      trade: 'electrical',
    })
    // No activation happened.
    expect(state.rpcCalls).toEqual([])
  })

  it('preserves a non-managed (non-registry) slug verbatim', async () => {
    state.tenant = {
      id: 'tenant-1',
      business_name: 'Pilot Sparky',
      trade: 'electrical',
      trades: ['electrical', 'roofing'], // roofing not in the manageable registry
      vapi_assistant_id: null,
    }
    const res = await POST(postReq({ trades: ['electrical', 'painting'] }))
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.ok).toBe(true)
    expect(json.activated).toEqual(['painting'])
    expect(json.deactivated).toEqual([]) // roofing is NOT deactivated
    expect(json.trades).toEqual(['electrical', 'painting', 'roofing'])
    expect(state.pricingBookDeletes).not.toContain('roofing')
  })

  it('rejects a trade that is not an activatable registry trade', async () => {
    const res = await POST(postReq({ trades: ['electrical', 'gardening'] }))
    const json = await res.json()
    expect(res.status).toBe(400)
    expect(json.ok).toBe(false)
    expect(json.error).toBe('unknown_trade')
    expect(json.unknown).toEqual(['gardening'])
    expect(state.rpcCalls).toEqual([])
  })

  it('surfaces an activation RPC failure as a 400', async () => {
    state.rpcError = { message: 'trade "solar" has no trade_pricing_defaults row' }
    const res = await POST(postReq({ trades: ['electrical', 'solar'] }))
    const json = await res.json()
    expect(res.status).toBe(400)
    expect(json.ok).toBe(false)
    expect(json.error).toBe('activation_failed')
    expect(json.trade).toBe('solar')
  })

  it('is a noop when the desired set equals the current portfolio', async () => {
    const res = await POST(postReq({ trades: ['electrical'] }))
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.ok).toBe(true)
    expect(json.noop).toBe(true)
    expect(state.rpcCalls).toEqual([])
    expect(state.tenantUpdates).toEqual([])
  })

  it('rejects an empty trades[] with a 400', async () => {
    const res = await POST(postReq({ trades: [] }))
    const json = await res.json()
    expect(res.status).toBe(400)
    expect(json.error).toBe('validation_failed')
  })

  it('401 when no user resolves', async () => {
    state.user = null
    const res = await POST(postReq({ trades: ['electrical'] }))
    expect(res.status).toBe(401)
  })
})
