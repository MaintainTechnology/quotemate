// Route-level tests for PATCH /api/tenant/me (R31).
//
// Focus: when a service-offering or custom-service TOGGLE is written, the
// route fires a DEFINED cache-invalidation bump — it stamps a fresh
// `service_version` into every pricing_book row's overlays jsonb, preserving
// any existing overlay keys (e.g. early_bird). This is the explicit signal
// the SMS dialog's service-freshness contract pairs with (the dialog renders
// the service list outside its cached prefix and version-stamps it; see
// lib/sms/service-toggle-freshness.test.ts for that half of the mechanism).
//
// Also asserts the inverse: a PATCH that does NOT touch services (e.g. only
// pricing) does NOT bump service_version, so we don't churn the stamp on
// unrelated writes.
//
// Pattern mirrors app/api/tenant/bom/fork/route.test.ts: mock
// @supabase/supabase-js BEFORE importing the route, because the route's
// module-level `const supabase = createClient(...)` runs at import time.

import { describe, it, expect, vi, beforeEach } from 'vitest'

type Row = Record<string, unknown>

// ── Mutable per-test fixtures + recorder the supabase stub reads/writes ──
const state: {
  user: { id: string } | null
  tenant: Row | null
  pricingBooks: Row[]
  // recorder
  offeringsUpserts: Row[][]
  customAssemblyUpdates: Array<{ payload: Row; ids: string[] }>
  pricingBookOverlayWrites: Array<{ id: string; overlays: Row }>
} = {
  user: { id: 'user-1' },
  tenant: { id: 'tenant-1', owner_user_id: 'user-1' },
  pricingBooks: [],
  offeringsUpserts: [],
  customAssemblyUpdates: [],
  pricingBookOverlayWrites: [],
}

// A tiny chainable query builder. Each leaf resolves to {data,error}. We only
// implement the subset of the supabase-js builder the PATCH path calls.
function buildQueryStub(table: string) {
  if (table === 'tenants') {
    return {
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({ data: state.tenant, error: null }),
        }),
      }),
      // PATCH may update tenant identity fields; not exercised here but kept safe.
      update: () => ({ eq: () => Promise.resolve({ error: null }) }),
    }
  }

  if (table === 'tenant_service_offerings') {
    return {
      upsert: (rows: Row[]) => {
        state.offeringsUpserts.push(rows)
        return Promise.resolve({ error: null })
      },
    }
  }

  if (table === 'tenant_custom_assemblies') {
    return {
      update: (payload: Row) => ({
        eq: () => ({
          in: (_col: string, ids: string[]) => {
            state.customAssemblyUpdates.push({ payload, ids })
            return Promise.resolve({ error: null })
          },
        }),
      }),
    }
  }

  if (table === 'pricing_book') {
    return {
      // bump READ: select('id, overlays').eq('tenant_id', id)
      select: () => ({
        eq: () => Promise.resolve({ data: state.pricingBooks, error: null }),
      }),
      // bump WRITE: update({ overlays }).eq('id', b.id)
      update: (payload: Row) => ({
        eq: (_col: string, id: string) => {
          if ('overlays' in payload) {
            state.pricingBookOverlayWrites.push({ id, overlays: payload.overlays as Row })
          }
          return Promise.resolve({ error: null })
        },
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

// Import AFTER the mock is registered.
const { PATCH } = await import('./route')

function patchReq(body: unknown) {
  return new Request('http://localhost/api/tenant/me', {
    method: 'PATCH',
    headers: { authorization: 'Bearer faketoken', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

// Valid RFC-4122 UUIDs (version nibble = 4, variant nibble = 8/9/a/b) so
// Zod's z.string().uuid() accepts them.
const ASSEMBLY_ID = 'a0000000-0000-4000-8000-000000000001'
const CUSTOM_ID = 'c0000000-0000-4000-8000-000000000002'

beforeEach(() => {
  state.user = { id: 'user-1' }
  state.tenant = { id: 'tenant-1', owner_user_id: 'user-1' }
  state.pricingBooks = [
    { id: 'pb-electrical', overlays: { early_bird: { enabled: true, discount_pct: 5 } } },
    { id: 'pb-plumbing', overlays: null },
  ]
  state.offeringsUpserts = []
  state.customAssemblyUpdates = []
  state.pricingBookOverlayWrites = []
})

describe('PATCH /api/tenant/me — R31 service-toggle cache bump', () => {
  it('toggling a shared service writes the offering AND bumps service_version on every pricing_book', async () => {
    const res = await PATCH(patchReq({ services: { [ASSEMBLY_ID]: false } }))
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.ok).toBe(true)

    // The toggle itself was written.
    expect(state.offeringsUpserts).toHaveLength(1)
    expect(state.offeringsUpserts[0]).toEqual([
      { tenant_id: 'tenant-1', assembly_id: ASSEMBLY_ID, enabled: false },
    ])

    // The DEFINED bump fired on BOTH pricing_book rows.
    expect(state.pricingBookOverlayWrites.map((w) => w.id).sort()).toEqual([
      'pb-electrical',
      'pb-plumbing',
    ])
    for (const w of state.pricingBookOverlayWrites) {
      expect(typeof w.overlays.service_version).toBe('string')
      expect(w.overlays.service_version as string).toMatch(/^v\d+$/)
    }
  })

  it('the bump PRESERVES other overlay keys (early_bird survives)', async () => {
    await PATCH(patchReq({ services: { [ASSEMBLY_ID]: true } }))
    const electrical = state.pricingBookOverlayWrites.find((w) => w.id === 'pb-electrical')
    expect(electrical).toBeTruthy()
    // early_bird untouched, service_version added.
    expect(electrical!.overlays.early_bird).toEqual({ enabled: true, discount_pct: 5 })
    expect(electrical!.overlays.service_version).toMatch(/^v\d+$/)
  })

  it('a null/array overlays value is replaced with a clean object carrying the stamp', async () => {
    await PATCH(patchReq({ services: { [ASSEMBLY_ID]: true } }))
    const plumbing = state.pricingBookOverlayWrites.find((w) => w.id === 'pb-plumbing')
    expect(plumbing).toBeTruthy()
    expect(plumbing!.overlays.service_version).toMatch(/^v\d+$/)
  })

  it('toggling a CUSTOM service also bumps service_version', async () => {
    const res = await PATCH(patchReq({ custom_services: { [CUSTOM_ID]: false } }))
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.ok).toBe(true)
    expect(state.customAssemblyUpdates).toHaveLength(1)
    expect(state.customAssemblyUpdates[0]).toEqual({ payload: { enabled: false }, ids: [CUSTOM_ID] })
    expect(state.pricingBookOverlayWrites.length).toBeGreaterThan(0)
    expect(state.pricingBookOverlayWrites[0].overlays.service_version).toMatch(/^v\d+$/)
  })

  it('a non-service PATCH (pricing only) does NOT bump service_version', async () => {
    const res = await PATCH(patchReq({ pricing: { hourly_rate: 130 } }))
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.ok).toBe(true)
    // No service toggle → no overlay bump churn.
    expect(state.pricingBookOverlayWrites).toHaveLength(0)
  })

  it('an empty services map does NOT bump (no rows written)', async () => {
    const res = await PATCH(patchReq({ services: {} }))
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.ok).toBe(true)
    expect(state.offeringsUpserts).toHaveLength(0)
    expect(state.pricingBookOverlayWrites).toHaveLength(0)
  })
})

// R36 — per-service delta contract. A single entry or an array upserts ONLY
// the named row(s), in addition to the legacy full-dict path. This is the
// anti-clobber guarantee: a concurrent tab's stale snapshot can no longer
// overwrite a row another tab just flipped, because the delta names exactly
// the rows that changed.
describe('PATCH /api/tenant/me — R36 per-service delta', () => {
  it('a single shared service_delta upserts ONLY that row + bumps', async () => {
    const res = await PATCH(
      patchReq({ service_delta: { assembly_id: ASSEMBLY_ID, enabled: true } }),
    )
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.ok).toBe(true)
    expect(state.offeringsUpserts).toEqual([
      [{ tenant_id: 'tenant-1', assembly_id: ASSEMBLY_ID, enabled: true }],
    ])
    expect(state.pricingBookOverlayWrites.length).toBe(2)
  })

  it('an ARRAY service_delta upserts each shared row in one bulk upsert', async () => {
    const OTHER = 'a0000000-0000-4000-8000-00000000000a'
    const res = await PATCH(
      patchReq({
        service_delta: [
          { assembly_id: ASSEMBLY_ID, enabled: false },
          { assembly_id: OTHER, enabled: true },
        ],
      }),
    )
    expect(res.status).toBe(200)
    expect(state.offeringsUpserts).toHaveLength(1)
    expect(state.offeringsUpserts[0]).toEqual([
      { tenant_id: 'tenant-1', assembly_id: ASSEMBLY_ID, enabled: false },
      { tenant_id: 'tenant-1', assembly_id: OTHER, enabled: true },
    ])
  })

  it('a custom service_delta (is_custom:true) routes to tenant_custom_assemblies', async () => {
    const res = await PATCH(
      patchReq({ service_delta: { assembly_id: CUSTOM_ID, enabled: false, is_custom: true } }),
    )
    expect(res.status).toBe(200)
    expect(state.offeringsUpserts).toHaveLength(0)
    expect(state.customAssemblyUpdates).toEqual([
      { payload: { enabled: false }, ids: [CUSTOM_ID] },
    ])
    expect(state.pricingBookOverlayWrites.length).toBeGreaterThan(0)
  })

  it('delta + legacy dict in one PATCH: delta WINS on the same key', async () => {
    const res = await PATCH(
      patchReq({
        services: { [ASSEMBLY_ID]: false },
        service_delta: { assembly_id: ASSEMBLY_ID, enabled: true },
      }),
    )
    expect(res.status).toBe(200)
    // Single merged upsert; the delta's `true` wins over the legacy `false`.
    expect(state.offeringsUpserts).toHaveLength(1)
    expect(state.offeringsUpserts[0]).toEqual([
      { tenant_id: 'tenant-1', assembly_id: ASSEMBLY_ID, enabled: true },
    ])
  })

  it('a malformed service_delta is a 400 (not silently ignored)', async () => {
    const res = await PATCH(patchReq({ service_delta: { assembly_id: 'not-a-uuid', enabled: true } }))
    const json = await res.json()
    expect(res.status).toBe(400)
    expect(json.error).toBe('invalid_payload')
    expect(state.offeringsUpserts).toHaveLength(0)
  })
})
