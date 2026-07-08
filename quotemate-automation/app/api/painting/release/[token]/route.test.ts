// Spec tradie-onsite-quote-editing R5 — "Send to customer" can RESEND an
// already-released painting quote (after an on-site edit) when the tradie
// explicitly asks ({ resend: true }); the default stays the idempotent
// no-op so a double-click never re-texts.

import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => {
  type Result = { data: unknown; error: unknown }
  type Op = { op: string; args: unknown[] }
  const results: Result[] = []
  const queries: { table: string; ops: Op[] }[] = []

  function from(table: string) {
    const record = { table, ops: [] as Op[] }
    const builder: Record<string, unknown> = {}
    for (const op of ['select', 'update', 'eq', 'maybeSingle']) {
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
// Run `after()` work inline so the send is observable in the test.
vi.mock('next/server', () => ({ after: (fn: () => unknown) => void fn() }))
vi.mock('@/lib/painting/release', () => ({
  sendPaintingQuoteToCustomer: vi.fn(async () => ({ sent: true })),
}))

import { POST } from './route'
import { sendPaintingQuoteToCustomer } from '@/lib/painting/release'

beforeEach(() => {
  h.results.length = 0
  h.queries.length = 0
  vi.mocked(sendPaintingQuoteToCustomer).mockClear()
})

const releasedRow = {
  id: 'p1',
  estimate_token: 'tok-estimate-1',
  public_token: 'pub-1',
  released_at: '2026-07-01T00:00:00Z',
  routing: 'auto_quote',
}

function releaseReq(body?: unknown) {
  return new Request('http://localhost/api/painting/release/tok-estimate-1', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
}

const ctx = { params: Promise.resolve({ token: 'tok-estimate-1' }) }

describe('POST /api/painting/release/[token]', () => {
  it('resends an already-released quote when asked, without restamping released_at', async () => {
    h.results.push({ data: releasedRow, error: null })
    const res = await POST(releaseReq({ resend: true }), ctx)
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, released_at: releasedRow.released_at })
    expect(vi.mocked(sendPaintingQuoteToCustomer)).toHaveBeenCalledTimes(1)

    const upd = h.queries.find((q) => q.ops.some((o) => o.op === 'update'))
    expect(upd, 'released_at must not be restamped on resend').toBeUndefined()
  })

  it('stays an idempotent no-op on a released row without the resend flag', async () => {
    h.results.push({ data: releasedRow, error: null })
    const res = await POST(releaseReq(), ctx)
    expect(res.status).toBe(200)
    expect(vi.mocked(sendPaintingQuoteToCustomer)).not.toHaveBeenCalled()
  })

  it('first release still stamps released_at and sends', async () => {
    h.results.push(
      { data: { ...releasedRow, released_at: null }, error: null },
      { data: null, error: null }, // update stamping released_at
    )
    const res = await POST(releaseReq(), ctx)
    expect(res.status).toBe(200)
    expect(vi.mocked(sendPaintingQuoteToCustomer)).toHaveBeenCalledTimes(1)
    const upd = h.queries.find((q) => q.ops.some((o) => o.op === 'update'))
    expect(upd, 'expected the released_at stamp update').toBeTruthy()
  })
})
