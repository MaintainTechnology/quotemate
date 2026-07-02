// POST /api/quote/[id]/complete — completion + payout release.
//
// Supabase is mocked with the repo's chainable-builder queue; the Stripe
// payout call is stubbed via a partial module mock so the pure decision
// logic (payoutReleaseDecision) runs for real.

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
    for (const op of ['select', 'update', 'eq', 'is', 'maybeSingle']) {
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
vi.mock('@/lib/stripe/connect', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/stripe/connect')>()
  return { ...actual, createConnectPayout: vi.fn() }
})

import { POST } from './route'
import { createConnectPayout } from '@/lib/stripe/connect'

const payoutMock = vi.mocked(createConnectPayout)

beforeEach(() => {
  h.results.length = 0
  h.queries.length = 0
  h.getUser.mockReset()
  payoutMock.mockReset()
})

const params = { params: Promise.resolve({ id: 'quote-1' }) }

function req(withAuth = true) {
  return new Request('http://localhost/api/quote/quote-1/complete', {
    method: 'POST',
    headers: withAuth ? { authorization: 'Bearer token-1' } : {},
  })
}

function authedUser(id = 'user-1') {
  h.getUser.mockResolvedValue({ data: { user: { id } }, error: null })
}

const paidQuote = {
  id: 'quote-1',
  tenant_id: 'tenant-1',
  paid_at: '2026-07-01T00:00:00Z',
  paid_tier: 'better',
  paid_amount_cents: 33000,
  platform_fee_cents: 660,
  stripe_connect_destination: 'acct_1',
  completed_at: null,
  stripe_payout_id: null,
  payout_amount_cents: null,
  payout_created_at: null,
}
const ownerTenant = {
  id: 'tenant-1',
  owner_user_id: 'user-1',
  stripe_connect_account_id: 'acct_1',
  stripe_connect_charges_enabled: true,
  stripe_connect_payouts_enabled: true,
}

function quoteUpdates() {
  return h.queries
    .filter((q) => q.table === 'quotes')
    .flatMap((q) => q.ops.filter((o) => o.op === 'update').map((o) => o.args[0] as Record<string, unknown>))
}

describe('POST /api/quote/[id]/complete', () => {
  it('401 without a bearer token', async () => {
    const res = await POST(req(false), params)
    expect(res.status).toBe(401)
  })

  it("403 when the caller doesn't own the quote's tenant", async () => {
    authedUser('intruder')
    h.results.push(
      { data: paidQuote, error: null },
      { data: ownerTenant, error: null },
    )
    const res = await POST(req(), params)
    expect(res.status).toBe(403)
  })

  it('409 on an unpaid quote', async () => {
    authedUser()
    h.results.push(
      { data: { ...paidQuote, paid_at: null }, error: null },
      { data: ownerTenant, error: null },
    )
    const res = await POST(req(), params)
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ error: 'not_paid' })
  })

  it('marks complete and releases the net payout (paid − 2% fee)', async () => {
    authedUser()
    h.results.push(
      { data: paidQuote, error: null }, // quote
      { data: ownerTenant, error: null }, // tenant
      { data: null, error: null }, // completed_at stamp
      { data: [{ id: 'quote-1' }], error: null }, // claim wins
      { data: null, error: null }, // payout stamp
    )
    payoutMock.mockResolvedValue({ ok: true, payoutId: 'po_1' })

    const res = await POST(req(), params)
    const json = await res.json()
    expect(json).toMatchObject({
      ok: true,
      completed: true,
      released: true,
      payout: { id: 'po_1', amount_cents: 32340 },
    })
    expect(payoutMock).toHaveBeenCalledWith({
      accountId: 'acct_1',
      amountCents: 32340,
      quoteId: 'quote-1',
    })
    const updates = quoteUpdates()
    expect(updates[0]).toHaveProperty('completed_at')
    expect(updates[1]).toMatchObject({ stripe_payout_id: 'pending' })
    expect(updates[2]).toMatchObject({ stripe_payout_id: 'po_1', payout_amount_cents: 32340 })
  })

  it('is idempotent once released', async () => {
    authedUser()
    h.results.push(
      {
        data: {
          ...paidQuote,
          completed_at: '2026-07-01T01:00:00Z',
          stripe_payout_id: 'po_1',
          payout_amount_cents: 32340,
          payout_created_at: '2026-07-01T01:00:01Z',
        },
        error: null,
      },
      { data: ownerTenant, error: null },
    )
    const res = await POST(req(), params)
    const json = await res.json()
    expect(json).toMatchObject({ ok: true, released: true, already: true, payout: { id: 'po_1' } })
    expect(payoutMock).not.toHaveBeenCalled()
  })

  it('completes but blocks the release on a legacy platform-direct payment', async () => {
    authedUser()
    h.results.push(
      { data: { ...paidQuote, stripe_connect_destination: null }, error: null },
      { data: ownerTenant, error: null },
      { data: null, error: null }, // completed_at stamp
    )
    const res = await POST(req(), params)
    const json = await res.json()
    expect(json).toMatchObject({
      ok: true,
      completed: true,
      released: false,
      block: 'not_connect_routed',
    })
    expect(payoutMock).not.toHaveBeenCalled()
  })

  it('hands the claim back when the payout create fails (retryable)', async () => {
    authedUser()
    h.results.push(
      { data: paidQuote, error: null },
      { data: ownerTenant, error: null },
      { data: null, error: null }, // completed_at stamp
      { data: [{ id: 'quote-1' }], error: null }, // claim wins
      { data: null, error: null }, // claim release
    )
    payoutMock.mockResolvedValue({
      ok: false,
      code: 'balance_insufficient',
      reason: 'Insufficient funds in your Stripe balance.',
    })

    const res = await POST(req(), params)
    expect(res.status).toBe(502)
    expect(await res.json()).toMatchObject({ error: 'payout_failed', code: 'balance_insufficient' })
    const updates = quoteUpdates()
    expect(updates[updates.length - 1]).toMatchObject({ stripe_payout_id: null })
  })

  it('reports release_in_progress when a concurrent request already holds the claim', async () => {
    authedUser()
    h.results.push(
      { data: paidQuote, error: null },
      { data: ownerTenant, error: null },
      { data: null, error: null }, // completed_at stamp
      { data: [], error: null }, // claim lost
    )
    const res = await POST(req(), params)
    const json = await res.json()
    expect(json).toMatchObject({ ok: true, released: false, block: 'release_in_progress' })
    expect(payoutMock).not.toHaveBeenCalled()
  })
})
