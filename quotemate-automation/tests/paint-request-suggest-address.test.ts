// The public painting form's suggest-address proxy: the token gate must
// deny missing / non-pending painting_lead_requests rows, and a pending
// one must proxy the zod-validated query to the Predictive provider.

import { expect, it, vi, beforeEach } from 'vitest'

const { maybeSingle, suggest } = vi.hoisted(() => ({
  maybeSingle: vi.fn(),
  suggest: vi.fn(),
}))

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle }),
      }),
    }),
  }),
}))

vi.mock('@/lib/roofing/providers/predictive', () => ({
  PredictiveProvider: class {
    suggest = suggest
  },
}))

import { POST } from '@/app/api/paint-request/[token]/suggest-address/route'

const ctx = { params: Promise.resolve({ token: 'tok-1' }) }
function req(body: unknown) {
  return new Request('https://app/api/paint-request/tok-1/suggest-address', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

beforeEach(() => {
  maybeSingle.mockReset()
  suggest.mockReset()
})

it('404s when the lead row does not exist', async () => {
  maybeSingle.mockResolvedValue({ data: null })
  const res = await POST(req({ query: '27 Smith' }), ctx)
  expect(res.status).toBe(404)
  expect(suggest).not.toHaveBeenCalled()
})

it('410s when the lead is no longer pending', async () => {
  maybeSingle.mockResolvedValue({ data: { token: 'tok-1', status: 'submitted' } })
  const res = await POST(req({ query: '27 Smith' }), ctx)
  expect(res.status).toBe(410)
  expect(suggest).not.toHaveBeenCalled()
})

it('400s on invalid JSON and on a too-short query', async () => {
  maybeSingle.mockResolvedValue({ data: { token: 'tok-1', status: 'pending' } })
  expect((await POST(req('not-json'), ctx)).status).toBe(400)
  expect((await POST(req({ query: 'ab' }), ctx)).status).toBe(400)
  expect(suggest).not.toHaveBeenCalled()
})

it('proxies a pending token to the provider and returns its SuggestResult', async () => {
  maybeSingle.mockResolvedValue({ data: { token: 'tok-1', status: 'pending' } })
  const result = {
    ok: true,
    suggestions: [{ id: 'a1', address: '27 SMITH ST, PENRITH NSW 2750', state: 'NSW', postcode: '2750' }],
  }
  suggest.mockResolvedValue(result)
  const res = await POST(req({ query: '27 Smith', state: 'NSW' }), ctx)
  expect(res.status).toBe(200)
  expect(suggest).toHaveBeenCalledWith('27 Smith', 'NSW')
  expect(await res.json()).toEqual(result)
})
