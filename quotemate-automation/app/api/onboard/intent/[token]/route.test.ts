import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  inspectIntentToken: vi.fn(),
}))

vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({}) }))
vi.mock('@/lib/onboard/intent-tokens', () => ({
  inspectIntentToken: h.inspectIntentToken,
}))

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role'

const { GET } = await import('./route')

const request = (token: string) =>
  GET(new Request(`http://test/api/onboard/intent/${token}`), {
    params: Promise.resolve({ token }),
  })

beforeEach(() => h.inspectIntentToken.mockReset())

describe('GET /api/onboard/intent/[token]', () => {
  it.each(['abc', 'bad token', '#abc123', 'a'.repeat(17)])(
    'rejects malformed capability %s before storage lookup',
    async token => {
      const response = await request(token)

      expect(response.status).toBe(400)
      await expect(response.json()).resolves.toMatchObject({ error: 'intent_invalid' })
      expect(h.inspectIntentToken).not.toHaveBeenCalled()
    },
  )

  it('returns verified display context without echoing the capability token', async () => {
    h.inspectIntentToken.mockResolvedValue({
      status: 'verified',
      intent: {
        token: 'abc123',
        owner_mobile: '+61412345678',
        expires_at: '2026-09-02T00:00:00.000Z',
      },
    })

    const response = await request('abc123')
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual({
      ok: true,
      intent: {
        owner_mobile: '+61412345678',
        expires_at: '2026-09-02T00:00:00.000Z',
        provenance: 'sms',
      },
    })
    expect(JSON.stringify(body)).not.toContain('abc123')
  })

  it.each([
    ['expired', 410],
    ['used', 409],
    ['invalid', 404],
  ] as const)('maps %s intent status to a stable response', async (status, expectedStatus) => {
    h.inspectIntentToken.mockResolvedValue({ status })

    const response = await request('abc123')

    expect(response.status).toBe(expectedStatus)
    await expect(response.json()).resolves.toMatchObject({ ok: false, error: `intent_${status}` })
  })

  it('keeps lookup outages retryable', async () => {
    h.inspectIntentToken.mockResolvedValue({ status: 'unavailable', error: 'db offline' })

    const response = await request('abc123')

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toMatchObject({ error: 'intent_unavailable' })
  })
})
