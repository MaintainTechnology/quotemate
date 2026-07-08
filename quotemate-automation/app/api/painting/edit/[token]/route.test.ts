// Spec tradie-onsite-quote-editing R4 — the tradie can edit a painting quote
// AFTER release (Jon's on-site revision flow). The inspection guard stays:
// inspection-routed jobs have no priced tiers to edit.
//
// Supabase is mocked at the module boundary with the same chainable builder
// as app/api/tenant/trade-jobs/route.test.ts; Stripe re-mint is mocked.

import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => {
  type Result = { data: unknown; error: unknown }
  type Op = { op: string; args: unknown[] }
  const results: Result[] = []
  const queries: { table: string; ops: Op[] }[] = []

  function from(table: string) {
    const record = { table, ops: [] as Op[] }
    const builder: Record<string, unknown> = {}
    for (const op of ['select', 'update', 'eq', 'maybeSingle', 'single']) {
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

  return { results, queries, client: { from } }
})

vi.mock('@supabase/supabase-js', () => ({ createClient: () => h.client }))
vi.mock('@/lib/stripe/painting-checkout', () => ({
  createPaintingCheckoutSessions: vi.fn(async () => ({ good: 'https://stripe/new-g' })),
}))
vi.mock('@/lib/stripe/checkout', () => ({
  expireCheckoutSession: vi.fn(async () => ({ ok: true })),
}))

import { POST } from './route'
import { createPaintingCheckoutSessions } from '@/lib/stripe/painting-checkout'
import { expireCheckoutSession } from '@/lib/stripe/checkout'

beforeEach(() => {
  h.results.length = 0
  h.queries.length = 0
  vi.mocked(createPaintingCheckoutSessions).mockClear()
  vi.mocked(expireCheckoutSession).mockClear()
})

function estimateFixture() {
  const tier = (t: 'good' | 'better' | 'best', ex: number) => ({
    tier: t,
    label: `${t} label`,
    scope: `${t} scope.`,
    ex_gst: ex,
    inc_gst: Math.round(ex * 1.1),
    inc_gst_low: Math.round(ex * 1.02),
    inc_gst_high: Math.round(ex * 1.2),
  })
  return {
    price: {
      tiers: [tier('good', 4000), tier('better', 6000), tier('best', 8000)],
      breakdown: { gst_factor: 1.1 },
      routing: { decision: 'auto_quote', reason: 'ok' },
    },
  }
}

function editReq(tiers: unknown) {
  return new Request('http://localhost/api/painting/edit/tok-estimate-1', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ tiers }),
  })
}

const ctx = { params: Promise.resolve({ token: 'tok-estimate-1' }) }

describe('POST /api/painting/edit/[token]', () => {
  it('edits a RELEASED row (post-release on-site revision) and persists it', async () => {
    h.results.push(
      {
        data: {
          id: 'p1',
          estimate: estimateFixture(),
          released_at: '2026-07-01T00:00:00Z',
          routing: 'auto_quote',
          public_token: 'pub-1',
          address: '1 Test St',
        },
        error: null,
      },
      { data: null, error: null }, // update
    )
    const res = await POST(editReq([{ tier: 'better', label: 'Premium repaint' }]), ctx)
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, changed: true })

    const upd = h.queries.find((q) => q.table === 'painting_measurements' && q.ops.some((o) => o.op === 'update'))
    expect(upd, 'expected a painting_measurements update').toBeTruthy()
  })

  it('re-mints Stripe deposit sessions when a released edit changes a price', async () => {
    h.results.push(
      {
        data: {
          id: 'p1',
          estimate: estimateFixture(),
          released_at: '2026-07-01T00:00:00Z',
          routing: 'auto_quote',
          public_token: 'pub-1',
          address: '1 Test St',
        },
        error: null,
      },
      { data: null, error: null }, // update
    )
    const res = await POST(editReq([{ tier: 'better', inc_gst: 9000 }]), ctx)
    expect(res.status).toBe(200)
    expect(vi.mocked(createPaintingCheckoutSessions)).toHaveBeenCalledTimes(1)

    const upd = h.queries.find((q) => q.table === 'painting_measurements' && q.ops.some((o) => o.op === 'update'))
    const updateArg = upd!.ops.find((o) => o.op === 'update')!.args[0] as Record<string, unknown>
    expect(updateArg).toHaveProperty('stripe_links')
  })

  it('refuses to edit a PAID job — transacted prices are immutable', async () => {
    h.results.push({
      data: {
        id: 'p1',
        estimate: estimateFixture(),
        released_at: '2026-07-01T00:00:00Z',
        paid_at: '2026-07-02T00:00:00Z',
        routing: 'auto_quote',
        public_token: 'pub-1',
        address: '1 Test St',
      },
      error: null,
    })
    const res = await POST(editReq([{ tier: 'better', inc_gst: 9000 }]), ctx)
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ error: 'cannot_edit_paid_quote' })
    expect(vi.mocked(createPaintingCheckoutSessions)).not.toHaveBeenCalled()
  })

  it('expires the previously-issued Stripe sessions when a released price edit re-mints', async () => {
    h.results.push(
      {
        data: {
          id: 'p1',
          estimate: estimateFixture(),
          released_at: '2026-07-01T00:00:00Z',
          routing: 'auto_quote',
          public_token: 'pub-1',
          address: '1 Test St',
          stripe_links: { good: 'https://stripe/old-g', better: 'https://stripe/old-b' },
        },
        error: null,
      },
      { data: null, error: null }, // update
    )
    const res = await POST(editReq([{ tier: 'better', inc_gst: 9000 }]), ctx)
    expect(res.status).toBe(200)
    const expired = vi.mocked(expireCheckoutSession).mock.calls.map((c) => c[0]).sort()
    expect(expired).toEqual(['https://stripe/old-b', 'https://stripe/old-g'])
  })

  it('still refuses an inspection-routed job (no priced tiers to edit)', async () => {
    h.results.push({
      data: {
        id: 'p1',
        estimate: estimateFixture(),
        released_at: null,
        routing: 'inspection_required',
        public_token: 'pub-1',
        address: '1 Test St',
      },
      error: null,
    })
    const res = await POST(editReq([{ tier: 'better', inc_gst: 9000 }]), ctx)
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ error: 'cannot_edit_inspection_quote' })
  })
})
