import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => {
  const resolve = vi.fn()
  const writes: Array<{ op: string; payload?: unknown; options?: unknown; filters: unknown[] }> = []
  let writeError: { message: string } | null = null
  const client = {
    from: vi.fn(() => {
      const record = { op: '', filters: [] as unknown[] } as {
        op: string
        payload?: unknown
        options?: unknown
        filters: unknown[]
      }
      return {
        upsert(payload: unknown, options: unknown) {
          record.op = 'upsert'
          record.payload = payload
          record.options = options
          writes.push(record)
          return Promise.resolve({ error: writeError })
        },
        delete() {
          record.op = 'delete'
          return this
        },
        eq(column: string, value: unknown) {
          record.filters.push([column, value])
          if (record.filters.length === 3) writes.push(record)
          return this
        },
        then(resolvePromise: (value: unknown) => unknown) {
          return Promise.resolve({ error: writeError }).then(resolvePromise)
        },
      }
    }),
  }
  return {
    resolve,
    writes,
    client,
    setWriteError(error: { message: string } | null) {
      writeError = error
    },
  }
})

vi.mock('@supabase/supabase-js', () => ({ createClient: () => h.client }))
vi.mock('@/lib/tenant/from-request', () => ({ resolveTenantRequest: h.resolve }))

import { DELETE, POST } from './route'

const auth = {
  identity: { provider: 'clerk', userId: 'seat-123', email: 'wrong@example.com' },
  tenant: { id: 'tenant-1' },
}

beforeEach(() => {
  h.resolve.mockReset()
  h.writes.length = 0
  h.setWriteError(null)
})

describe('/api/tenant/push-token', () => {
  it('returns 401 for no identity and 404 for an identity without a tenant', async () => {
    h.resolve.mockResolvedValueOnce(null)
    expect((await POST(new Request('https://app/api/tenant/push-token', { method: 'POST' }))).status).toBe(401)

    h.resolve.mockResolvedValueOnce({ identity: auth.identity, tenant: null })
    expect((await POST(new Request('https://app/api/tenant/push-token', { method: 'POST' }))).status).toBe(404)
  })

  it('rejects malformed Expo tokens and overlong device names', async () => {
    h.resolve.mockResolvedValue(auth)
    const badToken = await POST(new Request('https://app/api/tenant/push-token', {
      method: 'POST',
      body: JSON.stringify({ token: 'plain-text', platform: 'ios' }),
    }))
    expect(badToken.status).toBe(400)

    const badName = await POST(new Request('https://app/api/tenant/push-token', {
      method: 'POST',
      body: JSON.stringify({
        token: 'ExponentPushToken[abcdefghijklmnopqrstuv]',
        platform: 'android',
        deviceName: 'x'.repeat(101),
      }),
    }))
    expect(badName.status).toBe(400)
  })

  it('upserts by tenant + authenticated seat + token, never email or client input', async () => {
    h.resolve.mockResolvedValue(auth)
    const response = await POST(new Request('https://app/api/tenant/push-token', {
      method: 'POST',
      body: JSON.stringify({
        token: 'ExponentPushToken[abcdefghijklmnopqrstuv]',
        platform: 'ios',
        deviceName: 'Jeph’s iPhone',
        userId: 'forged-seat',
      }),
    }))
    expect(response.status).toBe(200)
    expect(h.writes[0]).toMatchObject({
      op: 'upsert',
      options: { onConflict: 'tenant_id,user_id,token' },
      payload: {
        tenant_id: 'tenant-1',
        user_id: 'seat-123',
        token: 'ExponentPushToken[abcdefghijklmnopqrstuv]',
      },
    })
  })

  it('deletes only the authenticated seat row and remains idempotent', async () => {
    h.resolve.mockResolvedValue(auth)
    const response = await DELETE(new Request('https://app/api/tenant/push-token', {
      method: 'DELETE',
      body: JSON.stringify({ token: 'ExponentPushToken[abcdefghijklmnopqrstuv]' }),
    }))
    expect(response.status).toBe(200)
    expect(h.writes[0]).toEqual({
      op: 'delete',
      filters: [
        ['tenant_id', 'tenant-1'],
        ['user_id', 'seat-123'],
        ['token', 'ExponentPushToken[abcdefghijklmnopqrstuv]'],
      ],
    })
  })

  it('returns safe 500 errors without exposing database messages', async () => {
    h.resolve.mockResolvedValue(auth)
    h.setWriteError({ message: 'relation push_tokens contains secret detail' })
    const response = await POST(new Request('https://app/api/tenant/push-token', {
      method: 'POST',
      body: JSON.stringify({ token: 'ExponentPushToken[abcdefghijklmnopqrstuv]', platform: 'ios' }),
    }))
    expect(response.status).toBe(500)
    expect(JSON.stringify(await response.json())).not.toContain('relation push_tokens')
  })
})
