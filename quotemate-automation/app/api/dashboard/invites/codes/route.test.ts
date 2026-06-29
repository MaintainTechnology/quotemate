// Route tests for /api/dashboard/invites/codes — focused on the custom/static
// code path added on top of the existing auto-generate behaviour. Mirrors the
// announcement route test: mock @supabase/supabase-js BEFORE importing the
// route, with a small chain-stub that resolves maybeSingle()/single() from
// `state` and records insert payloads.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type Row = Record<string, unknown>

const state: {
  user: { id: string } | null
  tenant: Row | null
  list: Row[] | null
  insertResult: { data: Row | null; error: { code?: string; message?: string } | null }
  inserts: { table: string; payload: any }[]
} = { user: null, tenant: null, list: [], insertResult: { data: null, error: null }, inserts: [] }

function chain(table: string) {
  const c: any = {
    _insert: false,
    select: () => c,
    eq: () => c,
    or: () => c,
    order: () => c,
    insert: (payload: any) => {
      state.inserts.push({ table, payload })
      c._insert = true
      return c
    },
    maybeSingle: () =>
      Promise.resolve(
        table === 'tenants' ? { data: state.tenant, error: null } : { data: null, error: null },
      ),
    single: () =>
      Promise.resolve(
        c._insert && table === 'onboarding_codes'
          ? state.insertResult
          : { data: null, error: null },
      ),
    then: (onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) =>
      Promise.resolve({ data: state.list, error: null }).then(onF, onR),
  }
  return c
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: {
      getUser: () =>
        Promise.resolve({ data: { user: state.user }, error: state.user ? null : new Error('no') }),
    },
    from: (t: string) => chain(t),
  }),
}))

const { POST, GET } = await import('./route')

function postReq(body: unknown) {
  return new Request('http://localhost/api/dashboard/invites/codes', {
    method: 'POST',
    headers: { authorization: 'Bearer faketoken', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  state.user = { id: 'user-1' }
  state.tenant = { id: 'tenant-1', business_name: 'Pilot Sparky' }
  state.list = []
  state.insertResult = { data: { id: 'code-1', code: 'PLACEHOLDER' }, error: null }
  state.inserts = []
})

afterEach(() => {
  delete process.env.PLATFORM_ADMIN_USER_IDS
})

describe('POST — custom (static) code', () => {
  it('inserts the normalised custom code verbatim, no random suffix', async () => {
    state.insertResult = { data: { id: 'code-1', code: 'MATE2026' }, error: null }
    const res = await POST(postReq({ campaign: 'june_flyers', quota_total: 50, custom_code: 'mate2026' }))
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.ok).toBe(true)
    expect(json.code).toBe('MATE2026')

    const insert = state.inserts.find((i) => i.table === 'onboarding_codes')!
    expect(insert.payload.code).toBe('MATE2026') // normalised, no -SUFFIX
    expect(insert.payload.tenant_id).toBe('tenant-1')
    expect(insert.payload.quota_total).toBe(50)
  })

  it('400s on a custom code that normalises to nothing usable', async () => {
    const res = await POST(postReq({ campaign: 'x', quota_total: 10, custom_code: 'a!' }))
    const json = await res.json()
    expect(res.status).toBe(400)
    expect(json.error).toBe('invalid_code_format')
    expect(state.inserts).toHaveLength(0)
  })

  it('409s when the chosen code is already taken (unique violation)', async () => {
    state.insertResult = { data: null, error: { code: '23505', message: 'duplicate key' } }
    const res = await POST(postReq({ campaign: 'x', quota_total: 10, custom_code: 'MATE2026' }))
    const json = await res.json()
    expect(res.status).toBe(409)
    expect(json.error).toBe('code_taken')
  })
})

describe('POST — auto-generated code (regression)', () => {
  it('generates a PREFIX-CAMPAIGN-SUFFIX code when no custom_code is given', async () => {
    const res = await POST(postReq({ campaign: 'june_flyers', quota_total: 100 }))
    expect(res.status).toBe(200)
    const insert = state.inserts.find((i) => i.table === 'onboarding_codes')!
    expect(insert.payload.code).toMatch(/^[A-Z0-9]+-JUNE-FLYERS-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}$/)
  })
})

describe('POST — guards', () => {
  it('403s on platform scope without platform-admin', async () => {
    const res = await POST(postReq({ scope: 'platform', campaign: 'x', quota_total: 5, custom_code: 'platwide' }))
    expect(res.status).toBe(403)
    const json = await res.json()
    expect(json.error).toBe('forbidden_scope')
    expect(state.inserts).toHaveLength(0)
  })

  it('401 when no user resolves', async () => {
    state.user = null
    const res = await POST(postReq({ campaign: 'x', quota_total: 5 }))
    expect(res.status).toBe(401)
  })

  it('404 when the caller has no tenant', async () => {
    state.tenant = null
    const res = await POST(postReq({ campaign: 'x', quota_total: 5 }))
    expect(res.status).toBe(404)
  })

  it('400 on an invalid body (missing quota)', async () => {
    const res = await POST(postReq({ campaign: 'x' }))
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toBe('invalid_request')
  })
})

describe('GET', () => {
  it('lists the caller codes', async () => {
    state.list = [{ id: 'code-1', code: 'MATE2026', campaign: 'june_flyers', status: 'active' }]
    const res = await GET(
      new Request('http://localhost/api/dashboard/invites/codes', {
        headers: { authorization: 'Bearer x' },
      }),
    )
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.codes).toHaveLength(1)
    expect(json.is_platform_admin).toBe(false)
  })
})
