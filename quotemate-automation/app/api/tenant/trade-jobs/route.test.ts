// /api/tenant/trade-jobs — GET summaries + tenant-scoped DELETE.
//
// The supabase-js client is mocked at the module boundary (same spirit as
// app/api/tenant/historical-quotes/routes-isolation.test.ts): a chainable
// builder records every (table, op, args) and, when awaited, resolves the
// next queued result. Tests assert auth gating, the trade→table allowlist,
// and that DELETE always filters on BOTH id and tenant_id.

import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => {
  type Result = { data: unknown; error: unknown }
  type Op = { op: string; args: unknown[] }
  const results: Result[] = []
  const queries: { table: string; ops: Op[] }[] = []
  const getUser = vi.fn()

  function from(table: string) {
    const record = { table, ops: [] as Op[] }
    const builder: Record<string, unknown> = {}
    for (const op of ['select', 'delete', 'eq', 'is', 'order', 'limit', 'maybeSingle']) {
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

  return { results, queries, getUser, client: { auth: { getUser }, from } }
})

vi.mock('@supabase/supabase-js', () => ({ createClient: () => h.client }))
vi.mock('@/lib/stripe/checkout', () => ({
  expireCheckoutSession: vi.fn(async () => ({ ok: true })),
}))

import { GET, DELETE } from './route'
import { expireCheckoutSession } from '@/lib/stripe/checkout'

beforeEach(() => {
  h.results.length = 0
  h.queries.length = 0
  h.getUser.mockReset()
  vi.mocked(expireCheckoutSession).mockClear()
})

function authedUser() {
  h.getUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
}

function delReq(body?: unknown, withAuth = true) {
  return new Request('http://localhost/api/tenant/trade-jobs', {
    method: 'DELETE',
    headers: {
      ...(withAuth ? { authorization: 'Bearer token-1' } : {}),
      'content-type': 'application/json',
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
}

describe('GET /api/tenant/trade-jobs', () => {
  it('401 without a bearer token', async () => {
    const res = await GET(new Request('http://localhost/api/tenant/trade-jobs'))
    expect(res.status).toBe(401)
  })

  it('401 when the token resolves no user', async () => {
    h.getUser.mockResolvedValue({ data: { user: null }, error: { message: 'bad' } })
    const res = await GET(delReq(undefined, true))
    expect(res.status).toBe(401)
  })

  it('merges per-trade rows into TradeJobSummary jobs', async () => {
    authedUser()
    h.results.push(
      { data: { id: 'tenant-1' }, error: null }, // tenants lookup
      {
        data: [
          {
            id: 'r1',
            address: '1 Smith St',
            combined_area_m2: 101.4,
            public_token: 'tok-roof',
            confirmed_at: null,
            routing: 'inspection_required',
            created_at: '2026-01-02T00:00:00Z',
          },
        ],
        error: null,
      }, // roofing_measurements
      { data: [], error: null }, // solar_estimates
      { data: [], error: null }, // painting_measurements
      { data: [], error: null }, // paint_runs
    )
    const res = await GET(
      new Request('http://localhost/api/tenant/trade-jobs', {
        headers: { authorization: 'Bearer token-1' },
      }),
    )
    expect(res.status).toBe(200)
    const json = (await res.json()) as { jobs: Array<Record<string, unknown>> }
    expect(json.jobs).toHaveLength(1)
    expect(json.jobs[0]).toMatchObject({
      id: 'r1',
      trade: 'roofing',
      status: 'inspection',
      headline: '101 m²',
      href: '/q/roof/tok-roof',
    })
  })
})

describe('DELETE /api/tenant/trade-jobs', () => {
  it('401 without a bearer token', async () => {
    const res = await DELETE(delReq({ trade: 'roofing', id: 'r1' }, false))
    expect(res.status).toBe(401)
  })

  it('404 when no tenant resolves for the user', async () => {
    authedUser()
    h.results.push({ data: null, error: null }) // tenants lookup misses
    const res = await DELETE(delReq({ trade: 'roofing', id: 'r1' }))
    expect(res.status).toBe(404)
    expect(await res.json()).toMatchObject({ error: 'no_tenant' })
  })

  it('400 on a body that is not JSON', async () => {
    authedUser()
    h.results.push({ data: { id: 'tenant-1' }, error: null })
    const res = await DELETE(delReq()) // no body at all
    expect(res.status).toBe(400)
  })

  it('400 on a trade outside the allowlist', async () => {
    authedUser()
    h.results.push({ data: { id: 'tenant-1' }, error: null })
    const res = await DELETE(delReq({ trade: 'electrical', id: 'r1' }))
    expect(res.status).toBe(400)
  })

  it('400 on Object.prototype keys — the allowlist is own-keys only', async () => {
    for (const trade of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
      h.results.length = 0
      authedUser()
      h.results.push({ data: { id: 'tenant-1' }, error: null })
      const res = await DELETE(delReq({ trade, id: 'r1' }))
      expect(res.status, `trade=${trade}`).toBe(400)
    }
  })

  it('400 on a missing id', async () => {
    authedUser()
    h.results.push({ data: { id: 'tenant-1' }, error: null })
    const res = await DELETE(delReq({ trade: 'roofing' }))
    expect(res.status).toBe(400)
  })

  it('deletes from the mapped table, filtered by id AND tenant_id', async () => {
    authedUser()
    h.results.push(
      { data: { id: 'tenant-1' }, error: null }, // tenants lookup
      { data: [{ id: 'r1' }], error: null }, // delete result
    )
    const res = await DELETE(delReq({ trade: 'roofing', id: 'r1' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true })

    const del = h.queries[h.queries.length - 1]
    expect(del.table).toBe('roofing_measurements')
    expect(del.ops.some((o) => o.op === 'delete')).toBe(true)
    expect(del.ops).toContainEqual({ op: 'eq', args: ['id', 'r1'] })
    expect(del.ops).toContainEqual({ op: 'eq', args: ['tenant_id', 'tenant-1'] })
  })

  it("404 when the row doesn't exist for this tenant (cross-tenant or stale id)", async () => {
    authedUser()
    h.results.push(
      { data: { id: 'tenant-1' }, error: null },
      { data: [], error: null }, // delete matched nothing
    )
    const res = await DELETE(delReq({ trade: 'roofing', id: 'someone-elses' }))
    expect(res.status).toBe(404)
    const del = h.queries[h.queries.length - 1]
    expect(del.table).toBe('roofing_measurements')
  })

  it('409 on a painting job whose deposit was paid — payment record is immutable', async () => {
    authedUser()
    h.results.push(
      { data: { id: 'tenant-1' }, error: null }, // tenants lookup
      {
        data: { id: 'p1', paid_at: '2026-06-30T00:00:00Z', stripe_links: null },
        error: null,
      }, // painting pre-select
    )
    const res = await DELETE(delReq({ trade: 'painting', id: 'p1' }))
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ error: 'job_already_paid' })
  })

  it('deletes an unpaid painting job: expires its Checkout Sessions, delete is guarded by paid_at IS NULL', async () => {
    authedUser()
    h.results.push(
      { data: { id: 'tenant-1' }, error: null }, // tenants lookup
      {
        data: {
          id: 'p1',
          paid_at: null,
          stripe_links: { good: 'https://stripe/pg', better: 'https://stripe/pb' },
        },
        error: null,
      }, // painting pre-select
      { data: [{ id: 'p1' }], error: null }, // delete
    )
    const res = await DELETE(delReq({ trade: 'painting', id: 'p1' }))
    expect(res.status).toBe(200)
    expect(vi.mocked(expireCheckoutSession)).toHaveBeenCalledTimes(2)
    expect(vi.mocked(expireCheckoutSession)).toHaveBeenCalledWith('https://stripe/pg')
    expect(vi.mocked(expireCheckoutSession)).toHaveBeenCalledWith('https://stripe/pb')

    const del = h.queries[h.queries.length - 1]
    expect(del.table).toBe('painting_measurements')
    expect(del.ops).toContainEqual({ op: 'is', args: ['paid_at', null] })
    expect(del.ops).toContainEqual({ op: 'eq', args: ['tenant_id', 'tenant-1'] })
  })

  it('409 on a solar estimate linked to a PAID quote', async () => {
    authedUser()
    h.results.push(
      { data: { id: 'tenant-1' }, error: null }, // tenants lookup
      { data: { id: 's1', quote_id: 'q9' }, error: null }, // solar pre-select
      { data: { paid_at: '2026-06-30T00:00:00Z' }, error: null }, // linked quote
    )
    const res = await DELETE(delReq({ trade: 'solar', id: 's1' }))
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ error: 'job_already_paid' })
  })

  it('deletes a solar estimate with no linked quote', async () => {
    authedUser()
    h.results.push(
      { data: { id: 'tenant-1' }, error: null }, // tenants lookup
      { data: { id: 's1', quote_id: null }, error: null }, // solar pre-select
      { data: [{ id: 's1' }], error: null }, // delete
    )
    const res = await DELETE(delReq({ trade: 'solar', id: 's1' }))
    expect(res.status).toBe(200)
    const del = h.queries[h.queries.length - 1]
    expect(del.table).toBe('solar_estimates')
    expect(del.ops).toContainEqual({ op: 'eq', args: ['id', 's1'] })
    expect(del.ops).toContainEqual({ op: 'eq', args: ['tenant_id', 'tenant-1'] })
  })

  it('404 when a painting/solar pre-select finds no row for this tenant', async () => {
    authedUser()
    h.results.push(
      { data: { id: 'tenant-1' }, error: null },
      { data: null, error: null }, // pre-select misses
    )
    const res = await DELETE(delReq({ trade: 'painting', id: 'ghost' }))
    expect(res.status).toBe(404)
    expect(await res.json()).toMatchObject({ error: 'not_found' })
  })
})
