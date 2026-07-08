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

    // Spec quote-sync-and-roofing-workflow-fix F1 — promoted measurements
    // (quote_share_token set) are excluded: their quotes row, served by
    // /api/tenant/me, is the single source of truth after promotion.
    const roofing = h.queries.find((q) => q.table === 'roofing_measurements')
    expect(roofing!.ops).toContainEqual({ op: 'is', args: ['quote_share_token', null] })
  })

  // Spec quotes-tab-sync A4 — aircon recommendations (migration 144) join the
  // saved-jobs summaries so they surface on the Quotes tab like the other
  // measure-tool trades.
  it('merges aircon recommendations into TradeJobSummary jobs', async () => {
    authedUser()
    h.results.push(
      { data: { id: 'tenant-1' }, error: null }, // tenants lookup
      { data: [], error: null }, // roofing_measurements
      { data: [], error: null }, // solar_estimates
      { data: [], error: null }, // painting_measurements
      { data: [], error: null }, // paint_runs
      {
        data: [
          {
            id: 'a1',
            address: '7 Cool St',
            routing: 'book_assessment',
            public_token: 'tok-ac',
            created_at: '2026-07-01T00:00:00Z',
          },
          {
            // routing is a free-text column; today the engine only emits
            // 'book_assessment', so this row exercises the fallback badge a
            // future routing value would get.
            id: 'a2',
            address: '9 Breeze Ave',
            routing: 'auto_quote',
            public_token: null,
            created_at: '2026-06-30T00:00:00Z',
          },
        ],
        error: null,
      }, // aircon_recommendations
    )
    const res = await GET(
      new Request('http://localhost/api/tenant/trade-jobs', {
        headers: { authorization: 'Bearer token-1' },
      }),
    )
    expect(res.status).toBe(200)
    const json = (await res.json()) as { jobs: Array<Record<string, unknown>> }
    expect(json.jobs).toHaveLength(2)
    expect(json.jobs[0]).toMatchObject({
      id: 'a1',
      trade: 'aircon',
      status: 'inspection', // book_assessment routes to a site visit
      headline: 'AC recommendation',
      href: '/q/aircon/tok-ac',
    })
    expect(json.jobs[1]).toMatchObject({
      id: 'a2',
      trade: 'aircon',
      status: 'draft',
      href: null,
    })

    const airconQuery = h.queries.find((q) => q.table === 'aircon_recommendations')
    expect(airconQuery, 'expected an aircon_recommendations query').toBeTruthy()
    expect(airconQuery!.ops).toContainEqual({ op: 'eq', args: ['tenant_id', 'tenant-1'] })
  })

  // Spec tradie-onsite-quote-editing R1 — roofing/painting rows also carry the
  // TRADIE detail link (/m and /p, keyed by their second capability token) so
  // the dashboard can open the editable review page, not just the customer view.
  it('adds tradieHref for roofing (/m) and painting (/p); null elsewhere', async () => {
    authedUser()
    h.results.push(
      { data: { id: 'tenant-1' }, error: null }, // tenants lookup
      {
        data: [
          {
            id: 'r1',
            address: '126 Greens Road',
            combined_area_m2: 180,
            public_token: 'tok-roof',
            measure_token: 'tok-measure',
            confirmed_at: null,
            routing: 'inspection_required',
            created_at: '2026-07-03T00:00:00Z',
          },
          {
            id: 'r2',
            address: '9 No Token St',
            combined_area_m2: 90,
            public_token: 'tok-roof-2',
            measure_token: null,
            confirmed_at: null,
            routing: 'tradie_review',
            created_at: '2026-07-02T00:00:00Z',
          },
        ],
        error: null,
      }, // roofing_measurements
      { data: [], error: null }, // solar_estimates
      {
        data: [
          {
            id: 'p1',
            address: '4 Brush Lane',
            better_inc_gst: 8400,
            routing: 'auto_quote',
            public_token: 'tok-paint',
            estimate_token: 'tok-estimate',
            created_at: '2026-07-01T00:00:00Z',
          },
        ],
        error: null,
      }, // painting_measurements
      { data: [], error: null }, // paint_runs
      {
        data: [
          {
            id: 'a1',
            address: '7 Cool St',
            routing: 'auto_quote',
            public_token: 'tok-ac',
            created_at: '2026-06-30T00:00:00Z',
          },
        ],
        error: null,
      }, // aircon_recommendations
    )
    const res = await GET(
      new Request('http://localhost/api/tenant/trade-jobs', {
        headers: { authorization: 'Bearer token-1' },
      }),
    )
    expect(res.status).toBe(200)
    const json = (await res.json()) as { jobs: Array<Record<string, unknown>> }
    expect(json.jobs).toHaveLength(4)
    expect(json.jobs[0]).toMatchObject({ id: 'r1', trade: 'roofing', tradieHref: '/m/tok-measure' })
    expect(json.jobs[1]).toMatchObject({ id: 'r2', trade: 'roofing', tradieHref: null })
    expect(json.jobs[2]).toMatchObject({ id: 'p1', trade: 'painting', tradieHref: '/p/tok-estimate' })
    expect(json.jobs[3]).toMatchObject({ id: 'a1', trade: 'aircon', tradieHref: null })
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
      { data: { id: 'r1', quote_id: null }, error: null }, // roofing pre-select (money guard)
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
      { data: null, error: null }, // roofing pre-select misses
    )
    const res = await DELETE(delReq({ trade: 'roofing', id: 'someone-elses' }))
    expect(res.status).toBe(404)
    const del = h.queries[h.queries.length - 1]
    expect(del.table).toBe('roofing_measurements')
  })

  // Spec quote-sync-and-roofing-workflow-fix — a roofing measurement
  // promoted to a PAID quote (mig 168 link) is that payment's source data;
  // deletion is refused, mirroring the solar guard.
  it('409 on a roofing measurement whose promoted quote was paid', async () => {
    authedUser()
    h.results.push(
      { data: { id: 'tenant-1' }, error: null }, // tenants lookup
      { data: { id: 'r1', quote_id: 'q9' }, error: null }, // roofing pre-select
      { data: { paid_at: '2026-07-01T00:00:00Z' }, error: null }, // linked quote
    )
    const res = await DELETE(delReq({ trade: 'roofing', id: 'r1' }))
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ error: 'job_already_paid' })
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

  // Spec quotes-tab-sync A4 — aircon joins the DELETE allowlist. No money
  // guard: aircon recommendations never take a deposit.
  it('deletes an aircon recommendation, filtered by id AND tenant_id', async () => {
    authedUser()
    h.results.push(
      { data: { id: 'tenant-1' }, error: null }, // tenants lookup
      { data: [{ id: 'a1' }], error: null }, // delete result
    )
    const res = await DELETE(delReq({ trade: 'aircon', id: 'a1' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true })

    const del = h.queries[h.queries.length - 1]
    expect(del.table).toBe('aircon_recommendations')
    expect(del.ops.some((o) => o.op === 'delete')).toBe(true)
    expect(del.ops).toContainEqual({ op: 'eq', args: ['id', 'a1'] })
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
