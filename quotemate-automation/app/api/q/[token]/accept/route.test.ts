import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => {
  const reads: Array<{ data: unknown; error: unknown }> = []
  const writes: Array<{ error: unknown }> = []
  const claims: Array<{ data: unknown; error: unknown }> = []
  const deferred: Array<() => unknown> = []
  const push = vi.fn()
  const filters: Array<{ column: string; value: unknown }> = []
  const client = {
    from: vi.fn((table: string) => {
      let mode: 'read' | 'write' = 'read'
      const record = { table, payload: null as unknown }
      const builder = {
        select() {
          return this
        },
        update(payload: unknown) {
          mode = 'write'
          record.payload = payload
          return this
        },
        eq() {
          return this
        },
        is(column: string, value: unknown) {
          filters.push({ column, value })
          return this
        },
        maybeSingle() {
          return Promise.resolve(
            mode === 'write'
              ? claims.shift() ?? { data: null, error: null }
              : reads.shift() ?? { data: null, error: null },
          )
        },
        then(resolve: (value: unknown) => unknown) {
          const result = mode === 'write'
            ? writes.shift() ?? { error: null }
            : reads.shift() ?? { data: null, error: null }
          return Promise.resolve(result).then(resolve)
        },
      }
      return builder
    }),
  }
  return { reads, writes, claims, deferred, push, filters, client }
})

vi.mock('@supabase/supabase-js', () => ({ createClient: () => h.client }))
vi.mock('next/server', () => ({ after: (callback: () => unknown) => h.deferred.push(callback) }))
vi.mock('@/lib/push/send', () => ({ sendPushToTenant: h.push }))

import { POST } from './route'

const request = () => new Request('https://app/api/q/share-1/accept', {
  method: 'POST',
  body: JSON.stringify({ tier: 'better' }),
})
const context = { params: Promise.resolve({ token: 'share-1' }) }

beforeEach(() => {
  h.reads.length = 0
  h.writes.length = 0
  h.claims.length = 0
  h.deferred.length = 0
  h.filters.length = 0
  h.push.mockReset()
  h.client.from.mockClear()
})

describe('customer quote acceptance push', () => {
  it('sends exact Quote accepted copy only after the first successful write', async () => {
    h.reads.push({
      data: { id: 'quote-1', tenant_id: 'tenant-1', customer_accepted_at: null },
      error: null,
    })
    h.claims.push({ data: { id: 'quote-1', tenant_id: 'tenant-1' }, error: null })

    const response = await POST(request(), context)
    expect(await response.json()).toEqual({ ok: true, recorded: true })
    expect(h.deferred).toHaveLength(1)
    await h.deferred[0]()
    expect(h.push).toHaveBeenCalledTimes(1)
    expect(h.push).toHaveBeenCalledWith(h.client, 'tenant-1', {
      title: 'Quote accepted',
      body: 'The customer accepted their quote.',
      url: '/quotes?quoteId=quote-1',
    })
  })

  it('does not send for a repeat acceptance', async () => {
    h.reads.push({
      data: {
        id: 'quote-1',
        tenant_id: 'tenant-1',
        customer_accepted_at: '2026-08-28T00:00:00.000Z',
      },
      error: null,
    })
    h.writes.push({ error: null })
    await POST(request(), context)
    expect(h.deferred).toHaveLength(0)
  })

  it('does not send for missing rows or a failed acceptance write', async () => {
    h.reads.push(
      { data: null, error: null },
      { data: null, error: null },
      { data: null, error: null },
    )
    await POST(request(), context)
    expect(h.deferred).toHaveLength(0)

    h.reads.push({
      data: { id: 'quote-1', tenant_id: 'tenant-1', customer_accepted_at: null },
      error: null,
    })
    h.claims.push({ data: null, error: { message: 'write failed' } })
    await POST(request(), context)
    expect(h.deferred).toHaveLength(0)
  })

  it('does not send when a concurrent request wins the conditional acceptance claim', async () => {
    h.reads.push({
      data: { id: 'quote-1', tenant_id: 'tenant-1', customer_accepted_at: null },
      error: null,
    })
    h.claims.push({ data: null, error: null })
    h.writes.push({ error: null })

    const response = await POST(request(), context)

    expect(await response.json()).toEqual({ ok: true, recorded: true })
    expect(h.filters).toContainEqual({ column: 'customer_accepted_at', value: null })
    expect(h.deferred).toHaveLength(0)
  })
})
