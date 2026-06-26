// Route tests for GET /api/email/unsubscribe/[token].
// Mock @supabase/supabase-js before importing the route.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeUnsubscribeToken } from '@/lib/email/unsubscribe-token'

const upserts: { payload: unknown; opts: unknown }[] = []

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: () => ({
      upsert: (payload: unknown, opts: unknown) => {
        upserts.push({ payload, opts })
        return Promise.resolve({ error: null })
      },
    }),
  }),
}))

const { GET } = await import('./route')

function call(token: string) {
  return GET(new Request(`http://localhost/api/email/unsubscribe/${token}`), {
    params: Promise.resolve({ token }),
  })
}

beforeEach(() => {
  process.env.UNSUBSCRIBE_SECRET = 'test-secret'
  upserts.length = 0
})
afterEach(() => {
  delete process.env.UNSUBSCRIBE_SECRET
})

describe('GET /api/email/unsubscribe/[token]', () => {
  it('records the suppression for a valid token and confirms', async () => {
    const token = makeUnsubscribeToken('tenant-1', 'Lead@Example.com')
    const res = await call(token)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/html')
    const html = await res.text()
    expect(html).toContain('unsubscribed')

    expect(upserts).toHaveLength(1)
    expect(upserts[0].payload).toMatchObject({ tenant_id: 'tenant-1', email: 'lead@example.com' })
    expect(upserts[0].opts).toMatchObject({ onConflict: 'tenant_id,email' })
  })

  it('rejects an invalid/forged token with a 400 and records nothing', async () => {
    const res = await call('garbage.token')
    expect(res.status).toBe(400)
    expect(await res.text()).toContain('Invalid link')
    expect(upserts).toHaveLength(0)
  })
})
