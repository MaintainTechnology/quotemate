// POST /api/aircon/recommend — spec quotes-tab-sync A3: a successful
// recommendation for a tenant-linked caller persists one
// aircon_recommendations row (the migration-144 TODO) so the job can
// surface on the Quotes tab via /api/tenant/trade-jobs and the customer
// page /q/aircon/[token]. The insert is best-effort: a failure never
// breaks the recommendation response.
//
// Supabase-js mocked with the chainable-builder pattern
// (app/api/tenant/trade-jobs/route.test.ts); the dual-auth resolver and
// the Google location-evidence call are mocked at the module boundary.

import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => {
  type Result = { data: unknown; error: unknown }
  type Op = { op: string; args: unknown[] }
  const results: Result[] = []
  const queries: { table: string; ops: Op[] }[] = []

  function from(table: string) {
    const record = { table, ops: [] as Op[] }
    const builder: Record<string, unknown> = {}
    for (const op of ['select', 'insert', 'eq', 'limit', 'maybeSingle', 'single']) {
      builder[op] = (...args: unknown[]) => {
        record.ops.push({ op, args })
        return builder
      }
    }
    builder.then = (
      resolve: (r: Result) => unknown,
      reject?: (e: unknown) => unknown,
    ) => {
      queries.push(record)
      const r = results.shift() ?? { data: null, error: null }
      return Promise.resolve(r).then(resolve, reject)
    }
    return builder
  }

  return { results, queries, client: { from } }
})

vi.mock('@supabase/supabase-js', () => ({ createClient: () => h.client }))
vi.mock('@/lib/tenant/from-request', () => ({ resolveTenantRequest: vi.fn() }))
vi.mock('@/lib/aircon/location', () => ({
  resolveAcLocationEvidence: vi.fn(async () => ({
    building: { ok: false },
  })),
}))

import { POST } from './route'
import { resolveTenantRequest } from '@/lib/tenant/from-request'

beforeEach(() => {
  h.results.length = 0
  h.queries.length = 0
  vi.mocked(resolveTenantRequest).mockReset()
})

const validBody = {
  address: { address: '12 Example St, Sydney', postcode: '2000', state: 'NSW' },
  inputs: {
    bedrooms: 3,
    bathrooms: 2,
    living_spaces: 2,
    storeys: 1,
    floor_area_m2: 150,
    ceiling_height: 'standard',
    insulation: 'average',
    current_situation: 'replacing',
  },
}

function post(body: unknown = validBody) {
  return POST(
    new Request('http://localhost/api/aircon/recommend', {
      method: 'POST',
      headers: {
        authorization: 'Bearer token-1',
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    }),
  )
}

// created_by is a uuid → auth.users FK. A Clerk identity id ('user_…') is NOT
// a valid uuid, so the route must stamp the tenant's owner_user_id instead —
// the trap app/api/roofing/save/route.ts documents.
const OWNER_UUID = 'b0000000-0000-4000-8000-000000000001'
const completeRateCard = {
  split: {
    per_head: { '2.5': 1200, '3.5': 1500, '5': 2000, '7': 2700, '8': 3200 },
    multi_head_discount_pct: 0.05,
  },
  ducted: { rate_per_kw: 1250, base_ex_gst: 4500, per_zone: 400, min_ex_gst: 8500 },
  gst_registered: true,
}
const overlayRow = (gstRegistered: boolean) => ({
  id: 'book-electrical',
  trade: 'electrical',
  overlays: { aircon_rate_card: { ...completeRateCard, gst_registered: gstRegistered } },
})

function authedWithTenant() {
  vi.mocked(resolveTenantRequest).mockResolvedValue({
    identity: { provider: 'clerk', userId: 'user_2abc', email: null },
    tenant: { id: 'tenant-1', trade: 'electrical', owner_user_id: OWNER_UUID },
  } as never)
}

describe('POST /api/aircon/recommend', () => {
  it('401 when unauthenticated', async () => {
    vi.mocked(resolveTenantRequest).mockResolvedValue(null)
    const res = await post()
    expect(res.status).toBe(401)
  })

  it('persists an aircon_recommendations row for a tenant-linked caller', async () => {
    authedWithTenant()
    h.results.push(
      { data: [overlayRow(true)], error: null }, // tenant pricing-book read
      { data: { id: 'rec-1' }, error: null }, // aircon_recommendations insert
    )
    const res = await post()
    expect(res.status).toBe(200)
    const json = (await res.json()) as {
      ok: boolean
      recommendation: { pricing_status: string; options: { pricing: { gst_registered: boolean } }[] }
      saved: { id: string; public_token: string } | null
    }
    expect(json.ok).toBe(true)
    expect(json.recommendation).toBeTruthy()
    expect(json.recommendation.pricing_status).toBe('priced')
    expect(json.recommendation.options.every((o) => o.pricing.gst_registered)).toBe(true)
    expect(json.saved?.id).toBe('rec-1')
    expect(typeof json.saved?.public_token).toBe('string')
    expect(json.saved!.public_token.length).toBeGreaterThan(10)

    const insert = h.queries.find(
      (q) => q.table === 'aircon_recommendations' && q.ops.some((o) => o.op === 'insert'),
    )
    expect(insert, 'expected an aircon_recommendations insert').toBeTruthy()
    const payload = insert!.ops.find((o) => o.op === 'insert')!.args[0] as Record<string, unknown>
    expect(payload.tenant_id).toBe('tenant-1')
    expect(payload.created_by).toBe(OWNER_UUID)
    expect(payload.address).toBe('12 Example St, Sydney')
    expect(payload.postcode).toBe('2000')
    expect(payload.state).toBe('NSW')
    expect(payload.recommendation).toBeTruthy()
    expect(typeof payload.routing).toBe('string')
    expect(payload.public_token).toBe(json.saved!.public_token)
  })

  it('fails closed without exposing priced money when persistence fails', async () => {
    authedWithTenant()
    h.results.push(
      { data: [overlayRow(true)], error: null }, // tenant pricing-book read
      { data: null, error: { message: 'boom' } }, // insert fails
    )
    const res = await post()
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ ok: false, error: 'pricing_persistence_failed' })
  })

  it('a legacy Supabase caller with no owner link stamps their own auth id', async () => {
    vi.mocked(resolveTenantRequest).mockResolvedValue({
      identity: { provider: 'supabase', userId: 'c0000000-0000-4000-8000-000000000002', email: null },
      tenant: { id: 'tenant-1', trade: 'electrical', owner_user_id: null },
    } as never)
    h.results.push(
      { data: [overlayRow(true)], error: null }, // tenant pricing-book read
      { data: { id: 'rec-2' }, error: null }, // insert
    )
    const res = await post()
    expect(res.status).toBe(200)
    const insert = h.queries.find((q) => q.table === 'aircon_recommendations')
    const payload = insert!.ops.find((o) => o.op === 'insert')!.args[0] as Record<string, unknown>
    expect(payload.created_by).toBe('c0000000-0000-4000-8000-000000000002')
  })

  it('does not insert for an authed caller with no tenant row', async () => {
    vi.mocked(resolveTenantRequest).mockResolvedValue({
      identity: { provider: 'supabase', userId: 'user-9', email: null },
      tenant: null,
    } as never)
    const res = await post()
    expect(res.status).toBe(200)
    const json = (await res.json()) as { ok: boolean; saved: unknown; recommendation: Record<string, unknown> }
    expect(json.ok).toBe(true)
    expect(json.saved).toBeNull()
    expect(json.recommendation.pricing_status).toBe('tenant_pricing_required')
    expect('options' in json.recommendation).toBe(false)
    expect(h.queries.some((q) => q.table === 'aircon_recommendations')).toBe(false)
  })

  it('returns an unpriced recommendation and skips persistence when the overlay is absent', async () => {
    authedWithTenant()
    h.results.push({ data: [], error: null })
    const res = await post()
    const json = (await res.json()) as { recommendation: Record<string, unknown>; saved: unknown }
    expect(json.recommendation.pricing_status).toBe('tenant_pricing_required')
    expect('options' in json.recommendation).toBe(false)
    expect(json.saved).toBeNull()
    expect(h.queries.some((q) => q.table === 'aircon_recommendations')).toBe(false)
  })

  it('uses the complete tenant card GST-unregistered state and persists the priced result', async () => {
    authedWithTenant()
    h.results.push(
      { data: [overlayRow(false)], error: null },
      { data: { id: 'rec-no-gst' }, error: null },
    )
    const res = await post()
    const json = (await res.json()) as {
      recommendation: { pricing_status: string; options: { pricing: { gst_registered: boolean } }[] }
      saved: { id: string } | null
    }
    expect(json.recommendation.pricing_status).toBe('priced')
    expect(json.recommendation.options.every((o) => !o.pricing.gst_registered)).toBe(true)
    expect(json.saved?.id).toBe('rec-no-gst')
  })

  it('400 on an invalid body — nothing persisted', async () => {
    authedWithTenant()
    const res = await post({ address: { address: 'x', postcode: 'nope', state: 'NSW' } })
    expect(res.status).toBe(400)
    expect(h.queries.some((q) => q.table === 'aircon_recommendations')).toBe(false)
  })
})
