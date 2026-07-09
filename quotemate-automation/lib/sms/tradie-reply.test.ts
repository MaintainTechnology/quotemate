import { describe, it, expect, vi, beforeEach } from 'vitest'

// Never touch Twilio — dispatch is mocked per-test.
vi.mock('./dispatch', () => ({
  dispatchQuoteMessage: vi.fn(async () => ({ ok: true, channel: 'sms', sid: 'SM123', status: 'queued' })),
}))

import { dispatchQuoteMessage } from './dispatch'
import { sendTradieReply } from './tradie-reply'

type RecordedCall = { table: string; op: 'insert' | 'update'; row: Record<string, unknown> }

/** Minimal chainable Supabase stub. `conversation` is what the lookup
 *  resolves to (null = not found); records inserts/updates for assertions. */
function makeSupabaseStub(conversation: Record<string, unknown> | null) {
  const calls: RecordedCall[] = []
  const api = {
    calls,
    from(table: string) {
      return {
        select() { return this },
        eq() { return this },
        maybeSingle: async () => ({ data: conversation, error: null }),
        insert(row: Record<string, unknown>) {
          calls.push({ table, op: 'insert', row })
          const created = { id: 'msg-1', created_at: '2026-07-09T00:00:00Z', ...row }
          return { select() { return { single: async () => ({ data: created, error: null }) } } }
        },
        update(row: Record<string, unknown>) {
          calls.push({ table, op: 'update', row })
          return { eq: async () => ({ error: null }) }
        },
      } as unknown as Record<string, unknown>
    },
  }
  return api
}

const CONVO = {
  id: 'conv-1',
  tenant_id: 'tenant-1',
  from_number: '+61480808517',
  to_number: '+61480000002',
}

const run = (opts: {
  conversation?: Record<string, unknown> | null
  tenantId?: string
  body?: string
}) => {
  const supabase = makeSupabaseStub(
    opts.conversation === undefined ? CONVO : opts.conversation,
  )
  return {
    supabase,
    promise: sendTradieReply({
      supabase: supabase as never,
      tenantId: opts.tenantId ?? 'tenant-1',
      conversationId: 'conv-1',
      body: opts.body ?? 'On my way, mate.',
    }),
  }
}

const dispatchMock = dispatchQuoteMessage as unknown as {
  mock: { calls: [{ to: string; from?: string; text: string }][] }
  mockResolvedValueOnce: (v: unknown) => void
}

describe('sendTradieReply', () => {
  beforeEach(() => vi.clearAllMocks())

  it('rejects an empty / whitespace-only body without sending', async () => {
    const { promise } = run({ body: '   ' })
    const res = await promise
    expect(res).toMatchObject({ ok: false, status: 422 })
    expect(dispatchMock.mock.calls.length).toBe(0)
  })

  it('rejects a body over 1600 chars without sending', async () => {
    const { promise } = run({ body: 'x'.repeat(1601) })
    const res = await promise
    expect(res).toMatchObject({ ok: false, status: 422 })
    expect(dispatchMock.mock.calls.length).toBe(0)
  })

  it('404s an unknown conversation (voice ids are not in sms_conversations)', async () => {
    const { promise } = run({ conversation: null })
    const res = await promise
    expect(res).toMatchObject({ ok: false, status: 404 })
    expect(dispatchMock.mock.calls.length).toBe(0)
  })

  it('404s a conversation owned by another tenant (no existence leak)', async () => {
    const { promise } = run({ tenantId: 'tenant-2' })
    const res = await promise
    expect(res).toMatchObject({ ok: false, status: 404 })
    expect(dispatchMock.mock.calls.length).toBe(0)
  })

  it('422s a conversation with no customer number', async () => {
    const { promise } = run({ conversation: { ...CONVO, from_number: null } })
    const res = await promise
    expect(res).toMatchObject({ ok: false, status: 422 })
    expect(dispatchMock.mock.calls.length).toBe(0)
  })

  it('sends via dispatch from the conversation number and records the message', async () => {
    const { promise, supabase } = run({})
    const res = await promise
    expect(res.ok).toBe(true)
    // Sent to the customer, from the tenant number the customer texted.
    expect(dispatchMock.mock.calls[0][0]).toMatchObject({
      to: '+61480808517',
      from: '+61480000002',
      text: 'On my way, mate.',
    })
    const calls = (supabase as unknown as { calls: RecordedCall[] }).calls
    const insert = calls.find((c) => c.table === 'sms_messages' && c.op === 'insert')!
    expect(insert.row).toMatchObject({
      conversation_id: 'conv-1',
      direction: 'outbound',
      body: 'On my way, mate.',
      twilio_message_sid: 'SM123',
    })
    // Bumps recency but NOT turn_count — the AI dialog state machine owns that.
    const update = calls.find((c) => c.table === 'sms_conversations' && c.op === 'update')!
    expect(update.row.last_message_at).toBeTruthy()
    expect(update.row.turn_count).toBeUndefined()
    if (res.ok) {
      expect(res.message).toMatchObject({ direction: 'outbound', body: 'On my way, mate.' })
    }
  })

  it('does NOT insert a message row when the send fails', async () => {
    dispatchMock.mockResolvedValueOnce({
      ok: false,
      smsAttempt: { code: '21610', reason: 'stop' },
      smsAttempts: 1,
    })
    const { promise, supabase } = run({})
    const res = await promise
    expect(res).toMatchObject({ ok: false, status: 502 })
    const calls = (supabase as unknown as { calls: RecordedCall[] }).calls
    expect(calls.find((c) => c.table === 'sms_messages')).toBeUndefined()
  })
})
