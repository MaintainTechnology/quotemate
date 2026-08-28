import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { EXPO_REQUEST_TIMEOUT_MS, sendPushToTenant } from './send'

type Query = { table: string; op: string; payload?: unknown; filters: Array<[string, unknown]> }

function fakeSupabase(
  rows: Array<{ id: string; user_id: string; token: string }>,
  options: { ticketInsertError?: string } = {},
) {
  const queries: Query[] = []
  return {
    queries,
    client: {
      from(table: string) {
        const query: Query = { table, op: '', filters: [] }
        const builder = {
          select() {
            query.op = 'select'
            return this
          },
          insert(payload: unknown) {
            query.op = 'insert'
            query.payload = payload
            queries.push(query)
            return Promise.resolve({
              error: options.ticketInsertError ? { message: options.ticketInsertError } : null,
            })
          },
          delete() {
            query.op = 'delete'
            return this
          },
          eq(column: string, value: unknown) {
            query.filters.push([column, value])
            return this
          },
          in(column: string, value: unknown) {
            query.filters.push([column, value])
            queries.push(query)
            return Promise.resolve({ error: null })
          },
          then(resolve: (value: unknown) => unknown) {
            queries.push(query)
            return Promise.resolve({ data: rows, error: null }).then(resolve)
          },
        }
        return builder
      },
    },
  }
}

function durableEventSupabase(
  rows: Array<{ id: string; user_id: string; token: string }>,
  options: { claimToken?: string } = {},
) {
  const pending = new Map(rows.map(row => [row.id, row]))
  const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
    if (name === 'initialise_push_event_deliveries') {
      return { data: args.p_claim_token === (options.claimToken ?? 'claim-a'), error: null }
    }
    if (name === 'claim_push_event_delivery_batch') {
      if (args.p_claim_token !== (options.claimToken ?? 'claim-a')) {
        return { data: { claimed: false, recipients: [] }, error: null }
      }
      return {
        data: { claimed: true, recipients: [...pending.values()].slice(0, 100) },
        error: null,
      }
    }
    if (name === 'record_push_delivery_results') {
      if (args.p_claim_token !== (options.claimToken ?? 'claim-a')) {
        return { data: null, error: { message: 'stale push event claim' } }
      }
      const results = args.p_results as Array<{ delivery_id: string }>
      for (const result of results) pending.delete(result.delivery_id)
      return { data: true, error: null }
    }
    throw new Error(`unexpected RPC ${name}`)
  })
  return {
    pending,
    client: {
      rpc,
      from(table: string) { throw new Error(`unexpected direct table read ${table}`) },
    },
  }
}

describe('sendPushToTenant', () => {
  beforeEach(() => vi.restoreAllMocks())
  afterEach(() => vi.useRealTimers())

  it('fans out in batches of at most 100 and persists exact ticket ownership', async () => {
    const recipients = Array.from({ length: 101 }, (_, i) => ({
      id: `row-${i}`,
      user_id: `user-${i}`,
      token: `ExponentPushToken[token-${i}]`,
    }))
    const db = fakeSupabase(recipients)
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const messages = JSON.parse(String(init?.body)) as Array<{ to: string }>
      return Response.json({
        data: messages.map((_, index) => ({ status: 'ok', id: `ticket-${fetchMock.mock.calls.length}-${index}` })),
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    await sendPushToTenant(db.client as never, 'tenant-1', {
      title: 'New lead',
      body: 'A new enquiry just came in.',
      url: '/chats?chatId=chat-1',
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    const batchSizes = fetchMock.mock.calls.map(([, init]) =>
      (JSON.parse(String(init?.body)) as unknown[]).length,
    )
    expect(batchSizes).toEqual([100, 1])

    const ticketRows = db.queries
      .filter(query => query.table === 'push_tickets' && query.op === 'insert')
      .flatMap(query => query.payload as Array<Record<string, unknown>>)
    expect(ticketRows).toHaveLength(101)
    expect(ticketRows[0]).toMatchObject({
      expo_ticket_id: 'ticket-1-0',
      tenant_id: 'tenant-1',
      user_id: 'user-0',
      token: 'ExponentPushToken[token-0]',
    })
  })

  it('ticket-level DeviceNotRegistered prunes only the exact tenant/user/token row', async () => {
    const db = fakeSupabase([
      { id: 'row-1', user_id: 'seat-a', token: 'ExponentPushToken[shared]' },
      { id: 'row-2', user_id: 'seat-b', token: 'ExponentPushToken[shared]' },
    ])
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          data: [
            { status: 'error', details: { error: 'DeviceNotRegistered' } },
            { status: 'ok', id: 'ticket-seat-b' },
          ],
        }),
      ),
    )

    await sendPushToTenant(db.client as never, 'tenant-1', {
      title: 'New lead',
      body: 'A new enquiry just came in.',
      url: '/chats',
    })

    const deletes = db.queries.filter(query => query.table === 'push_tokens' && query.op === 'delete')
    expect(deletes).toHaveLength(1)
    expect(deletes[0].filters).toEqual([
      ['tenant_id', 'tenant-1'],
      ['user_id', 'seat-a'],
      ['token', 'ExponentPushToken[shared]'],
    ])
  })

  it('reports a transient Expo failure so a durable event can stay retryable', async () => {
    const db = fakeSupabase([
      { id: 'row-1', user_id: 'seat-a', token: 'ExponentPushToken[temporary]' },
    ])
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unavailable', { status: 503 })))

    const delivered = await sendPushToTenant(db.client as never, 'tenant-1', {
      title: 'New lead',
      body: 'A new enquiry just came in.',
      url: '/chats',
    })

    expect(delivered).toBe(false)
  })

  it('does not report a 101-recipient event complete when a later batch is transient', async () => {
    const recipients = Array.from({ length: 101 }, (_, i) => ({
      id: `row-${i}`,
      user_id: `user-${i}`,
      token: `ExponentPushToken[token-${i}]`,
    }))
    const db = fakeSupabase(recipients)
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const messages = JSON.parse(String(init?.body)) as Array<{ to: string }>
      if (fetchMock.mock.calls.length === 2) return new Response('retry later', { status: 503 })
      return Response.json({
        data: messages.map((_, index) => ({ status: 'ok', id: `ticket-${index}` })),
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const delivered = await sendPushToTenant(db.client as never, 'tenant-1', {
      title: 'New lead',
      body: 'A new enquiry just came in.',
      url: '/chats',
    })

    expect(delivered).toBe(false)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('does not report accepted Expo tickets durable when ticket persistence fails', async () => {
    const db = fakeSupabase([
      { id: 'row-1', user_id: 'seat-a', token: 'ExponentPushToken[persist-me]' },
    ], { ticketInsertError: 'disk unavailable' })
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      data: [{ status: 'ok', id: 'ticket-1' }],
    })))

    const delivered = await sendPushToTenant(db.client as never, 'tenant-1', {
      title: 'New lead',
      body: 'A new enquiry just came in.',
      url: '/chats',
    })

    expect(delivered).toBe(false)
  })

  it('retries only the non-durable tail of a partially accepted event fan-out', async () => {
    const recipients = Array.from({ length: 101 }, (_, i) => ({
      id: `delivery-${i}`,
      user_id: `user-${i}`,
      token: `ExponentPushToken[token-${i}]`,
    }))
    const db = durableEventSupabase(recipients)
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const messages = JSON.parse(String(init?.body)) as Array<{ to: string }>
      if (fetchMock.mock.calls.length === 2) return new Response('retry later', { status: 429 })
      return Response.json({
        data: messages.map((_, index) => ({
          status: 'ok',
          id: `ticket-${fetchMock.mock.calls.length}-${index}`,
        })),
      })
    })
    vi.stubGlobal('fetch', fetchMock)
    const content = { title: 'New lead', body: 'A new enquiry just came in.', url: '/chats' }

    await expect(sendPushToTenant(db.client as never, 'tenant-1', content, {
      eventId: 'event-1',
      claimToken: 'claim-a',
    })).resolves.toBe(false)
    await expect(sendPushToTenant(db.client as never, 'tenant-1', content, {
      eventId: 'event-1',
      claimToken: 'claim-a',
    })).resolves.toBe(true)

    const bodies = fetchMock.mock.calls.map(([, init]) =>
      (JSON.parse(String(init?.body)) as Array<{ to: string }>).map(message => message.to),
    )
    expect(bodies.map(body => body.length)).toEqual([100, 1, 1])
    expect(bodies[2]).toEqual(['ExponentPushToken[token-100]'])
    expect(db.pending.size).toBe(0)
  })

  it('aborts an Expo attempt well before the five-minute event lease', async () => {
    vi.useFakeTimers()
    const db = durableEventSupabase([
      { id: 'delivery-1', user_id: 'seat-a', token: 'ExponentPushToken[slow]' },
    ])
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true })
    }))
    vi.stubGlobal('fetch', fetchMock)

    const delivery = sendPushToTenant(db.client as never, 'tenant-1', {
      title: 'New lead',
      body: 'A new enquiry just came in.',
      url: '/chats',
    }, { eventId: 'event-1', claimToken: 'claim-a' })

    await vi.advanceTimersByTimeAsync(EXPO_REQUEST_TIMEOUT_MS)

    await expect(delivery).resolves.toBe(false)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]?.[1]?.signal?.aborted).toBe(true)
    expect(EXPO_REQUEST_TIMEOUT_MS).toBeLessThan(60_000)
  })

  it('rejects event delivery without its fencing token before selecting recipients', async () => {
    const db = durableEventSupabase([
      { id: 'delivery-1', user_id: 'seat-a', token: 'ExponentPushToken[owned]' },
    ])
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(sendPushToTenant(db.client as never, 'tenant-1', {
      title: 'New lead', body: 'Body', url: '/chats',
    }, { eventId: 'event-1' })).resolves.toBe(false)

    expect(fetchMock).not.toHaveBeenCalled()
    expect(db.client.rpc).not.toHaveBeenCalled()
  })
})
