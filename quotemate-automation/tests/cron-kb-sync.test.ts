import { expect, it, vi, beforeEach, afterEach } from 'vitest'

// after() must be a no-op in tests (we only assert the guard responses).
vi.mock('next/server', () => ({ after: (_fn: unknown) => {} }))

import { GET } from '@/app/api/cron/kb-sync/route'

const OLD = { ...process.env }
beforeEach(() => {
  vi.stubEnv('NODE_ENV', 'production')
  process.env.CRON_SECRET = 'secret'
  process.env.SUPABASE_DB_URL = 'postgres://x'
  process.env.KB_PRICING_STORE_ID = 'fileSearchStores/s'
  process.env.KB_API_URL = 'https://kb'
  process.env.KB_API_KEY = 'k'
})
afterEach(() => {
  vi.unstubAllEnvs()
  process.env = { ...OLD }
  vi.restoreAllMocks()
})

it('401s without the Bearer secret in production', async () => {
  const res = await GET(new Request('https://app/api/cron/kb-sync'))
  expect(res.status).toBe(401)
})

it('accepts with the correct Bearer and returns accepted', async () => {
  const res = await GET(
    new Request('https://app/api/cron/kb-sync', {
      headers: { authorization: 'Bearer secret' },
    }),
  )
  expect(res.status).toBe(200)
  const body = await res.json()
  expect(body.ok).toBe(true)
  expect(body.accepted).toBe(true)
})

it('503s when KB_PRICING_STORE_ID is missing', async () => {
  delete process.env.KB_PRICING_STORE_ID
  const res = await GET(
    new Request('https://app/api/cron/kb-sync', {
      headers: { authorization: 'Bearer secret' },
    }),
  )
  expect(res.status).toBe(503)
})
