import { afterEach, describe, expect, it, vi } from 'vitest'
import { enqueuePushEvent, sweepPushEvents, type PushEventInput } from './events'
import { EXPO_REQUEST_TIMEOUT_MS, sendPushToTenant } from './send'

const event: PushEventInput = {
  eventKey: 'new-lead:sms:conversation-1',
  tenantId: 'tenant-1',
  title: 'New lead',
  body: 'Jeph in Bondi just asked for a quote.',
  url: '/chats?chatId=conversation-1',
}

function eventClient(options: {
  insert?: unknown
  claim?: boolean
  pending?: unknown[]
  recipients?: unknown[]
} = {}) {
  const insert = options.insert ?? { data: { id: 'event-1' }, error: null }
  const rpc = vi.fn(async (name: string, _args?: Record<string, unknown>) => {
    if (name === 'claim_push_event') return { data: options.claim ?? true, error: null }
    if (name === 'claim_push_event_delivery_batch') {
      return { data: { claimed: true, recipients: options.recipients ?? [] }, error: null }
    }
    return { data: true, error: null }
  })
  return {
    rpc,
    from(table: string) {
      if (table !== 'push_events') throw new Error(`unexpected table ${table}`)
      return {
        upsert() { return this },
        select() { return this },
        is() { return this },
        lte() { return this },
        order() { return this },
        limit: async () => ({ data: options.pending ?? [], error: null }),
        maybeSingle: async () => insert,
      }
    },
  }
}

describe('durable push events', () => {
  afterEach(() => vi.useRealTimers())

  it('does not send when the durable event insert fails', async () => {
    const client = eventClient({ insert: { data: null, error: { message: 'write failed' } } })
    const send = vi.fn(async () => true)

    await expect(enqueuePushEvent(client as never, event, { send })).resolves.toBe(false)
    expect(send).not.toHaveBeenCalled()
  })

  it('lets only the unique enqueue winner send during a race', async () => {
    const winner = eventClient()
    const loser = eventClient({ insert: { data: null, error: null } })
    const send = vi.fn(async () => true)

    const results = await Promise.all([
      enqueuePushEvent(winner as never, event, { send }),
      enqueuePushEvent(loser as never, event, { send }),
    ])

    expect(results).toEqual([true, false])
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('retries an event left pending by an interruption', async () => {
    const client = eventClient({
      pending: [{
        id: 'event-1',
        event_key: event.eventKey,
        tenant_id: event.tenantId,
        title: event.title,
        body: event.body,
        url: event.url,
      }],
    })
    const send = vi.fn(async () => true)

    const result = await sweepPushEvents(client as never, { send })

    expect(result).toEqual({ scanned: 1, sent: 1, retryable: 0 })
    expect(send).toHaveBeenCalledWith(client, 'tenant-1', {
      title: event.title,
      body: event.body,
      url: event.url,
    }, {
      eventId: 'event-1',
      claimToken: expect.any(String),
    })

    const claimCall = client.rpc.mock.calls.find(([name]) => name === 'claim_push_event')
    expect(claimCall?.[1]).toEqual({
      p_event_id: 'event-1',
      p_claim_token: expect.any(String),
    })
  })

  it('aborts a stalled Expo response body and releases ownership before the recipient lease', async () => {
    vi.useFakeTimers({ now: 0 })
    const client = eventClient({
      pending: [{
        id: 'event-1',
        event_key: event.eventKey,
        tenant_id: event.tenantId,
        title: event.title,
        body: event.body,
        url: event.url,
      }],
      recipients: [{
        id: 'delivery-1',
        user_id: 'seat-a',
        token: 'ExponentPushToken[stalled-body]',
      }],
    })
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const response = new Response(null, { status: 200 })
      vi.spyOn(response, 'json').mockImplementation(() => new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true })
      }))
      return response
    })
    vi.stubGlobal('fetch', fetchMock)

    let settled = false
    const sweep = sweepPushEvents(client as never, { send: sendPushToTenant, now: new Date(0) })
    void sweep.finally(() => { settled = true })
    await vi.advanceTimersByTimeAsync(EXPO_REQUEST_TIMEOUT_MS)

    expect(settled).toBe(true)
    await expect(sweep).resolves.toEqual({ scanned: 1, sent: 0, retryable: 1 })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]?.[1]?.signal?.aborted).toBe(true)
    expect(client.rpc.mock.calls.some(([name]) => name === 'release_push_event')).toBe(true)
    expect(Date.now()).toBe(EXPO_REQUEST_TIMEOUT_MS)
    expect(EXPO_REQUEST_TIMEOUT_MS).toBeLessThan(60_000)
  })
})
