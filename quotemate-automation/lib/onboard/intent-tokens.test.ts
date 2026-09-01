import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it, vi } from 'vitest'
import { inspectIntentToken, markIntentUsed, type IntentRow } from './intent-tokens'

function clientForClaim(data: { sms_conversation_id: string | null } | null) {
  const maybeSingle = vi.fn(async () => ({ data, error: null }))
  const builder: Record<string, unknown> = {}
  for (const method of ['update', 'eq', 'is', 'gt', 'select']) {
    builder[method] = vi.fn(() => builder)
  }
  builder.maybeSingle = maybeSingle
  const from = vi.fn(() => builder)
  return { client: { from } as unknown as SupabaseClient, from }
}

describe('markIntentUsed one-time claim', () => {
  it('returns ok=false when the guarded update matched no active intent', async () => {
    const { client, from } = clientForClaim(null)

    await expect(
      markIntentUsed(client, { token: 'intent-1', tenantId: 'tenant-2' }),
    ).resolves.toEqual({ ok: false, conversationId: null })
    expect(from).toHaveBeenCalledTimes(1)
  })

  it('returns ok=true only when this activation claimed the intent row', async () => {
    const { client } = clientForClaim({ sms_conversation_id: null })

    await expect(
      markIntentUsed(client, { token: 'intent-1', tenantId: 'tenant-1' }),
    ).resolves.toEqual({ ok: true, conversationId: null })
  })
})

const ACTIVE_INTENT: IntentRow = {
  id: 'intent-row-1',
  token: 'abc123',
  owner_mobile: '+61412345678',
  sms_conversation_id: null,
  expires_at: '2026-09-02T00:00:00.000Z',
  used_at: null,
  resulting_tenant_id: null,
  created_at: '2026-09-01T00:00:00.000Z',
}

function clientForInspection(data: IntentRow | null, error: { message: string } | null = null) {
  const builder: Record<string, unknown> = {}
  builder.select = vi.fn(() => builder)
  builder.eq = vi.fn(() => builder)
  builder.maybeSingle = vi.fn(async () => ({ data, error }))
  return { from: vi.fn(() => builder) } as unknown as SupabaseClient
}

describe('inspectIntentToken status contract', () => {
  const now = new Date('2026-09-01T12:00:00.000Z')

  it('returns verified context only for an active unused SMS intent', async () => {
    await expect(inspectIntentToken(clientForInspection(ACTIVE_INTENT), 'abc123', now)).resolves
      .toMatchObject({ status: 'verified', intent: { owner_mobile: '+61412345678' } })
  })

  it('distinguishes used, expired and invalid tokens', async () => {
    await expect(
      inspectIntentToken(
        clientForInspection({ ...ACTIVE_INTENT, used_at: '2026-09-01T10:00:00.000Z' }),
        'abc123',
        now,
      ),
    ).resolves.toEqual({ status: 'used' })
    await expect(
      inspectIntentToken(
        clientForInspection({ ...ACTIVE_INTENT, expires_at: '2026-09-01T11:59:59.000Z' }),
        'abc123',
        now,
      ),
    ).resolves.toEqual({ status: 'expired' })
    await expect(inspectIntentToken(clientForInspection(null), 'missing', now)).resolves.toEqual({
      status: 'invalid',
    })
  })

  it('keeps database failures retryable instead of calling the token invalid', async () => {
    await expect(
      inspectIntentToken(clientForInspection(null, { message: 'database offline' }), 'abc123', now),
    ).resolves.toEqual({ status: 'unavailable', error: 'database offline' })
  })
})
