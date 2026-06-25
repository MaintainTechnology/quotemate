// Guard tests for POST /api/quote/[id]/chat-edit. Supabase, the candidate
// loader, and the AI proposer are mocked so the route's auth + pre-condition
// gates are exercised without a live DB or model call. Mirrors the auth/guard
// contract of POST /api/quote/[id]/edit (spec R2/R3 + edge cases).

import { describe, it, expect, vi, beforeEach } from 'vitest'

type Row = unknown
const state: {
  user: { id: string } | null
  userErr: unknown
  quote: Row
  tenant: Row
  pricingBook: Row
  intake: Row
} = {
  user: null,
  userErr: null,
  quote: undefined,
  tenant: undefined,
  pricingBook: undefined,
  intake: undefined,
}

// Tripwire — any write method invoked on the Supabase client flips this. The
// chat-edit endpoint must persist NOTHING (spec DoD), so a happy-path request
// that trips this is a failure.
const mutated = { called: false }

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: {
      getUser: async () => ({ data: { user: state.user }, error: state.userErr }),
    },
    from: (table: string) => {
      const data =
        table === 'quotes'
          ? state.quote
          : table === 'tenants'
            ? state.tenant
            : table === 'pricing_book'
              ? state.pricingBook
              : table === 'intakes'
                ? state.intake
                : null
      const builder: Record<string, unknown> = {}
      const chain = () => builder
      builder.select = chain
      builder.eq = chain
      builder.limit = chain
      builder.maybeSingle = async () => ({ data })
      // Read-only contract: record (don't silently no-op) any write attempt.
      const mark = () => {
        mutated.called = true
        return builder
      }
      builder.insert = mark
      builder.update = mark
      builder.upsert = mark
      builder.delete = mark
      return builder
    },
  }),
}))

vi.mock('@/lib/estimate/run', () => ({
  loadCandidatePrices: vi.fn(async () => ({ material: [], assembly: [] })),
}))
vi.mock('@/lib/quote/chat-edit', () => ({
  proposeQuoteEdit: vi.fn(async () => ({
    assistantMessage: 'ok',
    proposedTiers: {},
    diff: [],
    anyUngrounded: false,
  })),
}))

import { POST } from './route'

const params = { params: Promise.resolve({ id: 'q1' }) }

function req(body?: unknown, bearer?: string) {
  return new Request('http://localhost/api/quote/q1/chat-edit', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
}

const VALID_BODY = { instruction: 'add a downlight to better' }

beforeEach(() => {
  vi.clearAllMocks()
  mutated.called = false
  state.user = { id: 'owner-1' }
  state.userErr = null
  state.quote = {
    id: 'q1',
    tenant_id: 't1',
    intake_id: 'i1',
    paid_at: null,
    needs_inspection: false,
    good: null,
    better: { label: 'Better', line_items: [] },
    best: null,
    scope_of_works: null,
    assumptions: null,
  }
  state.tenant = { id: 't1', owner_user_id: 'owner-1' }
  state.pricingBook = {
    trade: 'electrical',
    hourly_rate: 110,
    apprentice_rate: 75,
    senior_rate: 140,
    call_out_minimum: 120,
    default_markup_pct: 28,
    min_labour_hours: 2,
    after_hours_multiplier: null,
  }
  state.intake = { trade: 'electrical' }
})

describe('POST /api/quote/[id]/chat-edit — guards', () => {
  it('401 without a bearer token', async () => {
    const res = await POST(req(VALID_BODY), params)
    expect(res.status).toBe(401)
  })

  it('401 when the token resolves to no user', async () => {
    state.user = null
    const res = await POST(req(VALID_BODY, 'tok'), params)
    expect(res.status).toBe(401)
  })

  it('400 on an empty/invalid body', async () => {
    const res = await POST(req({}, 'tok'), params)
    expect(res.status).toBe(400)
  })

  it('404 when the quote does not exist', async () => {
    state.quote = null
    const res = await POST(req(VALID_BODY, 'tok'), params)
    expect(res.status).toBe(404)
  })

  it('409 when the quote is already paid', async () => {
    state.quote = { ...(state.quote as object), paid_at: '2026-06-01T00:00:00Z' }
    const res = await POST(req(VALID_BODY, 'tok'), params)
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe('quote_already_paid')
  })

  it('409 when the quote needs inspection', async () => {
    state.quote = { ...(state.quote as object), needs_inspection: true }
    const res = await POST(req(VALID_BODY, 'tok'), params)
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe('cannot_edit_inspection_quote')
  })

  it('403 when the caller is not the tenant owner', async () => {
    state.tenant = { id: 't1', owner_user_id: 'someone-else' }
    const res = await POST(req(VALID_BODY, 'tok'), params)
    expect(res.status).toBe(403)
    expect((await res.json()).error).toBe('not_owner')
  })

  it('409 when the pricing book is misconfigured', async () => {
    state.pricingBook = { trade: 'electrical', hourly_rate: null, default_markup_pct: null }
    const res = await POST(req(VALID_BODY, 'tok'), params)
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe('pricing_book_misconfigured')
  })

  it('200 and ok:true on the happy path, and persists nothing', async () => {
    const res = await POST(req(VALID_BODY, 'tok'), params)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body).toHaveProperty('diff')
    expect(body).toHaveProperty('proposedTiers')
    // DoD: no DB write occurs on a chat-edit request.
    expect(mutated.called).toBe(false)
  })
})
