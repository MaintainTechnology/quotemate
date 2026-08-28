import { describe, expect, it, vi } from 'vitest'

import { chunkReceiptTickets, reconcileReceiptBatch, sweepPushReceipts, type PushTicketRow } from './receipts'

const ticket = (id: string, overrides: Partial<PushTicketRow> = {}): PushTicketRow => ({
  id: `row-${id}`,
  expo_ticket_id: id,
  tenant_id: 'tenant-1',
  user_id: 'seat-1',
  token: 'ExponentPushToken[abcdefghijklmnopqrstuv]',
  sent_at: '2026-08-28T00:00:00.000Z',
  next_check_at: '2026-08-28T00:15:00.000Z',
  expires_at: '2026-08-29T00:00:00.000Z',
  ...overrides,
})

describe('push receipt sweep', () => {
  it('provides a receipt reconciler with batching, missing-receipt retry and expiry support', async () => {
    const modulePath = './receipts'
    const receiptModule = await import(/* @vite-ignore */ modulePath).catch(() => ({}))
    expect(receiptModule).toHaveProperty('sweepPushReceipts')
    expect(receiptModule).toHaveProperty('reconcileReceiptBatch')
    expect(receiptModule).toHaveProperty('chunkReceiptTickets')
    expect(vi.isMockFunction(receiptModule.sweepPushReceipts)).toBe(false)
  })

  it('batches receipt IDs within Expo’s 1000-receipt request limit', () => {
    expect(chunkReceiptTickets(Array.from({ length: 1001 }, (_, index) => ticket(`t-${index}`))).map(batch => batch.length)).toEqual([1000, 1])
  })

  it('maps ok, DNR, missing, terminal error and expired receipts to exact actions', () => {
    const actions = reconcileReceiptBatch(
      [
        ticket('ok'),
        ticket('dnr', { user_id: 'seat-dead', token: 'ExponentPushToken[deaddeaddead]' }),
        ticket('missing'),
        ticket('bad'),
        ticket('old', { expires_at: '2026-08-27T23:59:00.000Z' }),
      ],
      {
        ok: { status: 'ok' },
        dnr: { status: 'error', message: 'gone', details: { error: 'DeviceNotRegistered' } },
        bad: { status: 'error', message: 'credentials', details: { error: 'InvalidCredentials' } },
      },
      new Date('2026-08-28T01:00:00.000Z'),
    )

    expect(actions).toEqual([
      expect.objectContaining({ ticket: expect.objectContaining({ expo_ticket_id: 'ok' }), kind: 'terminal', status: 'ok', prune: false }),
      expect.objectContaining({ ticket: expect.objectContaining({ expo_ticket_id: 'dnr', user_id: 'seat-dead' }), kind: 'terminal', status: 'error', error: 'DeviceNotRegistered', prune: true }),
      expect.objectContaining({ ticket: expect.objectContaining({ expo_ticket_id: 'missing' }), kind: 'retry' }),
      expect.objectContaining({ ticket: expect.objectContaining({ expo_ticket_id: 'bad' }), kind: 'terminal', status: 'error', error: 'InvalidCredentials', prune: false }),
      expect.objectContaining({ ticket: expect.objectContaining({ expo_ticket_id: 'old' }), kind: 'terminal', status: 'expired', prune: false }),
    ])
  })

  it('leaves every ticket retryable when Expo has a transient HTTP failure', async () => {
    const due = ticket('temporary')
    const client = {
      from() {
        return {
          select() { return this },
          is() { return this },
          lte() { return this },
          order() { return this },
          limit: async () => ({ data: [due], error: null }),
        }
      },
    }
    const fetchImpl = vi.fn(async () => new Response('unavailable', { status: 503 }))
    const result = await sweepPushReceipts(client as never, {
      fetchImpl: fetchImpl as typeof fetch,
      now: new Date('2026-08-28T01:00:00.000Z'),
    })
    expect(result).toEqual({ scanned: 1, checked: 0, retryable: 1, pruned: 0, expired: 0 })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
})
