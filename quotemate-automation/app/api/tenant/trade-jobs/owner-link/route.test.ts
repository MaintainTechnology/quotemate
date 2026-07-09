// Spec tradie-onsite-quote-editing R3 — GET /api/tenant/trade-jobs/owner-link
// resolves whether the signed-in tradie OWNS a roofing/painting job (by its
// customer-facing public_token) and, only then, returns the tradie detail
// link (/m/[measure_token] or /p/[estimate_token]). The tradie token is a
// capability — it must never be exposed to non-owners.
//
// Same module-boundary supabase mock as ../route.test.ts; auth resolves via
// the real resolveTenantRequest against the mocked client.

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
    for (const op of ['select', 'eq', 'maybeSingle', 'limit', 'order']) {
      builder[op] = (...args: unknown[]) => {
        record.ops.push({ op, args })
        return builder
      }
    }
    builder.then = (resolve: (r: Result) => unknown, reject?: (e: unknown) => unknown) => {
      queries.push(record)
      const r = results.shift() ?? { data: null, error: null }
      return Promise.resolve(r).then(resolve, reject)
    }
    return builder
  }

  return { results, queries, getUser, client: { auth: { getUser }, from } }
})

vi.mock('@supabase/supabase-js', () => ({ createClient: () => h.client }))

import { GET } from './route'

beforeEach(() => {
  h.results.length = 0
  h.queries.length = 0
  h.getUser.mockReset()
})

function authedUser() {
  h.getUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
}

function req(qs: string, withAuth = true) {
  return new Request(`http://localhost/api/tenant/trade-jobs/owner-link?${qs}`, {
    headers: withAuth ? { authorization: 'Bearer token-1' } : {},
  })
}

describe('GET /api/tenant/trade-jobs/owner-link', () => {
  it('401 without a bearer token', async () => {
    const res = await GET(req('trade=roofing&token=pub-1', false))
    expect(res.status).toBe(401)
  })

  it('400 on a trade outside roofing/painting', async () => {
    authedUser()
    h.results.push({ data: { id: 'tenant-1' }, error: null })
    const res = await GET(req('trade=electrical&token=pub-1'))
    expect(res.status).toBe(400)
  })

  it('400 on a missing token', async () => {
    authedUser()
    h.results.push({ data: { id: 'tenant-1' }, error: null })
    const res = await GET(req('trade=roofing'))
    expect(res.status).toBe(400)
  })

  it('returns the /m link for the owning tenant of a roofing job', async () => {
    authedUser()
    h.results.push(
      { data: { id: 'tenant-1' }, error: null }, // tenants lookup
      { data: { tenant_id: 'tenant-1', measure_token: 'tok-m' }, error: null },
    )
    const res = await GET(req('trade=roofing&token=pub-1'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ owner: true, tradieHref: '/m/tok-m' })
  })

  it('returns the /p link for the owning tenant of a painting job', async () => {
    authedUser()
    h.results.push(
      { data: { id: 'tenant-1' }, error: null },
      { data: { tenant_id: 'tenant-1', estimate_token: 'tok-e' }, error: null },
    )
    const res = await GET(req('trade=painting&token=pub-1'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ owner: true, tradieHref: '/p/tok-e' })
  })

  it('hides the link from a different tenant', async () => {
    authedUser()
    h.results.push(
      { data: { id: 'tenant-1' }, error: null },
      { data: { tenant_id: 'tenant-2', measure_token: 'tok-m' }, error: null },
    )
    const res = await GET(req('trade=roofing&token=pub-1'))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json).toEqual({ owner: false, tradieHref: null })
    expect(JSON.stringify(json)).not.toContain('tok-m')
  })

  it('returns the workspace tab href for the owning tenant of a commercial-painting run', async () => {
    authedUser()
    h.results.push(
      { data: { id: 'tenant-1' }, error: null },
      { data: { tenant_id: 'tenant-1' }, error: null },
    )
    const res = await GET(req('trade=commercial-painting&token=pub-1'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      owner: true,
      tradieHref: '/dashboard?tab=commercial-painting',
    })
  })

  it('returns the workspace tab href for the owning tenant of an aircon recommendation', async () => {
    authedUser()
    h.results.push(
      { data: { id: 'tenant-1' }, error: null },
      { data: { tenant_id: 'tenant-1' }, error: null },
    )
    const res = await GET(req('trade=aircon&token=pub-1'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ owner: true, tradieHref: '/dashboard?tab=aircon' })
  })

  it('hides the workspace href from a different tenant (aircon)', async () => {
    authedUser()
    h.results.push(
      { data: { id: 'tenant-1' }, error: null },
      { data: { tenant_id: 'tenant-2' }, error: null },
    )
    const res = await GET(req('trade=aircon&token=pub-1'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ owner: false, tradieHref: null })
  })

  it('owner:false for an unknown token and for a NULL-tenant row', async () => {
    for (const rowData of [null, { tenant_id: null, measure_token: 'tok-m' }]) {
      h.results.length = 0
      h.queries.length = 0
      authedUser()
      h.results.push({ data: { id: 'tenant-1' }, error: null }, { data: rowData, error: null })
      const res = await GET(req('trade=roofing&token=pub-1'))
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ owner: false, tradieHref: null })
    }
  })
})
