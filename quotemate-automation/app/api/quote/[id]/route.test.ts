// DELETE /api/quote/[id] — owner-checked hard delete of a drafted quote.
//
// Mirrors the auth ladder of POST /api/quote/[id]/edit: bearer → user →
// quote lookup → tenant owner check, with paid quotes immutable. The
// supabase-js client is mocked with the same chainable-builder approach as
// app/api/tenant/trade-jobs/route.test.ts.

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
    for (const op of ['select', 'delete', 'eq', 'is', 'maybeSingle']) {
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

import { DELETE } from './route'
import { expireCheckoutSession } from '@/lib/stripe/checkout'

beforeEach(() => {
  h.results.length = 0
  h.queries.length = 0
  h.getUser.mockReset()
  vi.mocked(expireCheckoutSession).mockClear()
})

const params = { params: Promise.resolve({ id: 'quote-1' }) }

function delReq(withAuth = true) {
  return new Request('http://localhost/api/quote/quote-1', {
    method: 'DELETE',
    headers: withAuth ? { authorization: 'Bearer token-1' } : {},
  })
}

function authedUser(id = 'user-1') {
  h.getUser.mockResolvedValue({ data: { user: { id } }, error: null })
}

describe('DELETE /api/quote/[id]', () => {
  it('401 without a bearer token', async () => {
    const res = await DELETE(delReq(false), params)
    expect(res.status).toBe(401)
  })

  it('401 when the token resolves no user', async () => {
    h.getUser.mockResolvedValue({ data: { user: null }, error: { message: 'bad' } })
    const res = await DELETE(delReq(), params)
    expect(res.status).toBe(401)
  })

  it('404 when the quote does not exist', async () => {
    authedUser()
    h.results.push({ data: null, error: null }) // quotes lookup misses
    const res = await DELETE(delReq(), params)
    expect(res.status).toBe(404)
    expect(await res.json()).toMatchObject({ error: 'no_quote' })
  })

  it('403 on a legacy unscoped quote (tenant_id null)', async () => {
    authedUser()
    h.results.push({
      data: { id: 'quote-1', tenant_id: null, paid_at: null },
      error: null,
    })
    const res = await DELETE(delReq(), params)
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ error: 'unscoped_quote' })
  })

  it('409 once a deposit has been paid', async () => {
    authedUser()
    h.results.push({
      data: { id: 'quote-1', tenant_id: 'tenant-1', paid_at: '2026-06-01T00:00:00Z' },
      error: null,
    })
    const res = await DELETE(delReq(), params)
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ error: 'quote_already_paid' })
  })

  it("403 when the caller does not own the quote's tenant", async () => {
    authedUser('intruder')
    h.results.push(
      { data: { id: 'quote-1', tenant_id: 'tenant-1', paid_at: null }, error: null },
      { data: { id: 'tenant-1', owner_user_id: 'user-1' }, error: null },
    )
    const res = await DELETE(delReq(), params)
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ error: 'not_owner' })
  })

  it('deletes an owned, unpaid quote — expires sessions, filters by id AND tenant_id AND paid_at IS NULL', async () => {
    authedUser()
    h.results.push(
      {
        data: {
          id: 'quote-1',
          tenant_id: 'tenant-1',
          paid_at: null,
          stripe_links: { good: 'https://stripe/g', inspection: 'https://stripe/i' },
        },
        error: null,
      },
      { data: { id: 'tenant-1', owner_user_id: 'user-1' }, error: null },
      { data: [{ id: 'quote-1' }], error: null }, // delete removed one row
    )
    const res = await DELETE(delReq(), params)
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true })

    // Both live Checkout Sessions were expired before the delete.
    expect(vi.mocked(expireCheckoutSession)).toHaveBeenCalledTimes(2)
    expect(vi.mocked(expireCheckoutSession)).toHaveBeenCalledWith('https://stripe/g')
    expect(vi.mocked(expireCheckoutSession)).toHaveBeenCalledWith('https://stripe/i')

    const del = h.queries[h.queries.length - 1]
    expect(del.table).toBe('quotes')
    expect(del.ops.some((o) => o.op === 'delete')).toBe(true)
    expect(del.ops).toContainEqual({ op: 'eq', args: ['id', 'quote-1'] })
    expect(del.ops).toContainEqual({ op: 'eq', args: ['tenant_id', 'tenant-1'] })
    // Atomic paid guard on the statement itself (TOCTOU protection).
    expect(del.ops).toContainEqual({ op: 'is', args: ['paid_at', null] })
  })

  it('409 when the delete matches zero rows (quote paid between load and delete)', async () => {
    authedUser()
    h.results.push(
      {
        data: { id: 'quote-1', tenant_id: 'tenant-1', paid_at: null, stripe_links: null },
        error: null,
      },
      { data: { id: 'tenant-1', owner_user_id: 'user-1' }, error: null },
      { data: [], error: null }, // webhook won the race — nothing matched
    )
    const res = await DELETE(delReq(), params)
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ error: 'quote_already_paid' })
  })
})
