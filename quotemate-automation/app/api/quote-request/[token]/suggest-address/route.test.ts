// spec: specs/generic-quote-request-form.md §3 — the token-gated address
// proxy. Mirrors tests/paint-request-suggest-address.test.ts, plus the
// lookup-error case painting reports as an invalid link.

import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://supabase.test'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role'

  let result: { data: unknown; error: unknown } = { data: null, error: null }
  const suggest = vi.fn(async () => ({ ok: true, suggestions: [{ id: '1', address: '27 Smith St', state: 'NSW', postcode: '2750' }] }))

  function from() {
    const builder: Record<string, unknown> = {}
    for (const op of ['select', 'eq', 'maybeSingle']) builder[op] = () => builder
    builder.then = (resolve: (r: typeof result) => unknown) => Promise.resolve(result).then(resolve)
    return builder
  }

  return {
    suggest,
    client: { from },
    setResult: (r: { data: unknown; error: unknown }) => {
      result = r
    },
  }
})

vi.mock('@supabase/supabase-js', () => ({ createClient: () => h.client }))
vi.mock('@/lib/roofing/providers/predictive', () => ({
  PredictiveProvider: class {
    suggest = h.suggest
  },
}))

import { POST } from './route'

const TOKEN = 'b'.repeat(32)
const ctx = { params: Promise.resolve({ token: TOKEN }) }

function req(body: unknown, raw?: string) {
  return new Request(`http://localhost/api/quote-request/${TOKEN}/suggest-address`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: raw ?? JSON.stringify(body),
  })
}

beforeEach(() => {
  h.suggest.mockClear()
  h.setResult({ data: { token: TOKEN, status: 'pending' }, error: null })
})

describe('POST /api/quote-request/[token]/suggest-address', () => {
  it('404s an unknown token', async () => {
    h.setResult({ data: null, error: null })
    const res = await POST(req({ query: '27 Smith' }), ctx)
    expect(res.status).toBe(404)
    expect(h.suggest).not.toHaveBeenCalled()
  })

  it('503s a lookup failure rather than blaming the link', async () => {
    h.setResult({ data: null, error: { message: 'down' } })
    expect((await POST(req({ query: '27 Smith' }), ctx)).status).toBe(503)
  })

  it('410s a spent link, on the same predicate the parent POST uses', async () => {
    h.setResult({ data: { token: TOKEN, status: 'submitted' }, error: null })
    expect((await POST(req({ query: '27 Smith' }), ctx)).status).toBe(410)
  })

  it('400s malformed JSON and a too-short query', async () => {
    expect((await POST(req(undefined, '{nope'), ctx)).status).toBe(400)
    expect((await POST(req({ query: 'ab' }), ctx)).status).toBe(400)
    expect(h.suggest).not.toHaveBeenCalled()
  })

  it('proxies a pending lead straight through to the provider', async () => {
    const res = await POST(req({ query: '27 Smith', state: 'NSW' }), ctx)
    expect(res.status).toBe(200)
    expect(h.suggest).toHaveBeenCalledWith('27 Smith', 'NSW')
    expect(await res.json()).toMatchObject({ ok: true })
  })
})
