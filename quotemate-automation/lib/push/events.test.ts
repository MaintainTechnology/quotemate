import { describe, expect, it, vi } from 'vitest'
import { enqueuePushEvent, sweepPushEvents, type PushEventInput } from './events'

const event: PushEventInput = {
  eventKey: 'new-lead:sms:conversation-1',
  tenantId: 'tenant-1',
  title: 'New lead',
  body: 'Jeph in Bondi just asked for a quote.',
  url: '/chats?chatId=conversation-1',
}

function eventClient(options: { insert?: unknown; claim?: boolean; pending?: unknown[] } = {}) {
  const insert = options.insert ?? { data: { id: 'event-1' }, error: null }
  const rpc = vi.fn(async (name: string) => {
    if (name === 'claim_push_event') return { data: options.claim ?? true, error: null }
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
    }, { eventId: 'event-1' })
  })
})
