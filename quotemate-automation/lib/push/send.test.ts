import { beforeEach, describe, expect, it, vi } from 'vitest'

import { sendPushToTenant } from './send'

type Query = { table: string; op: string; payload?: unknown; filters: Array<[string, unknown]> }

function fakeSupabase(rows: Array<{ id: string; user_id: string; token: string }>) {
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
            return Promise.resolve({ error: null })
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

describe('sendPushToTenant', () => {
  beforeEach(() => vi.restoreAllMocks())

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
})
