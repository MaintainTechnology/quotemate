import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  client: { from: vi.fn() },
  sweep: vi.fn(),
}))

vi.mock('@supabase/supabase-js', () => ({ createClient: () => h.client }))
vi.mock('@/lib/push/receipts', () => ({ sweepPushReceipts: h.sweep }))

import { GET } from './route'

beforeEach(() => {
  vi.stubEnv('NODE_ENV', 'production')
  vi.stubEnv('CRON_SECRET', 'cron-secret')
  h.sweep.mockReset()
  h.sweep.mockResolvedValue({ scanned: 3, checked: 2, retryable: 1, pruned: 1, expired: 0 })
})

afterEach(() => vi.unstubAllEnvs())

describe('/api/cron/push-receipts', () => {
  it('rejects missing or wrong CRON_SECRET without sweeping', async () => {
    expect((await GET(new Request('https://app/api/cron/push-receipts'))).status).toBe(401)
    expect((await GET(new Request('https://app/api/cron/push-receipts', {
      headers: { authorization: 'Bearer wrong' },
    }))).status).toBe(401)
    expect(h.sweep).not.toHaveBeenCalled()
  })

  it('runs the sweep with the correct secret and surfaces only fatal scan failures', async () => {
    const request = new Request('https://app/api/cron/push-receipts', {
      headers: { authorization: 'Bearer cron-secret' },
    })
    const ok = await GET(request)
    expect(ok.status).toBe(200)
    expect(await ok.json()).toMatchObject({ ok: true, scanned: 3, checked: 2, retryable: 1 })

    h.sweep.mockResolvedValueOnce({ scanned: 0, checked: 0, retryable: 0, pruned: 0, expired: 0, error: 'database unavailable' })
    const failed = await GET(request)
    expect(failed.status).toBe(500)
    expect(await failed.json()).toMatchObject({ ok: false, error: 'receipt_sweep_failed' })
  })
})
