import { describe, it, expect, afterEach } from 'vitest'
import { GET } from './route'

// ════════════════════════════════════════════════════════════════════
// The health probe is the only way to tell, from outside, whether a given
// deployment can actually produce a quote.
//
// POST /api/estimate/draft and POST /api/intake/structure are guarded by
// isCronAuthorised, which is fail-closed in production — and NODE_ENV is
// 'production' on Vercel Preview as well. A deployment missing CRON_SECRET
// therefore rejects every internal self-call: no voice call, SMS lead, flyer-QR
// lead or dashboard quote produces a quote, and three of the four text the
// customer a failure message. Before cron_secret_present existed, the only way
// to find that out was to ship it and watch.
// ════════════════════════════════════════════════════════════════════

const ORIGINAL = process.env.CRON_SECRET

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.CRON_SECRET
  else process.env.CRON_SECRET = ORIGINAL
})

async function body() {
  return (await (await GET()).json()) as {
    ok: boolean
    cron_secret_present: boolean
    features: Record<string, boolean>
  }
}

describe('GET /api/health', () => {
  it('reports the guard armed when the secret is set', async () => {
    process.env.CRON_SECRET = 'anything-non-empty'
    expect((await body()).cron_secret_present).toBe(true)
  })

  it('reports the guard inert when the secret is missing', async () => {
    delete process.env.CRON_SECRET
    expect((await body()).cron_secret_present).toBe(false)
  })

  it('treats an empty string as missing — a blank env var is the classic mis-set', async () => {
    process.env.CRON_SECRET = ''
    expect((await body()).cron_secret_present).toBe(false)
  })

  it('NEVER exposes the secret itself', async () => {
    // The whole point is a boolean. If anyone ever "helpfully" returns the
    // value, this fails — a public unauthenticated endpoint must not leak it.
    process.env.CRON_SECRET = 'super-secret-sentinel-value'
    const raw = await (await GET()).text()
    expect(raw).not.toContain('super-secret-sentinel-value')
  })

  it('still answers ok with the flag block intact', async () => {
    const b = await body()
    expect(b.ok).toBe(true)
    expect(b.features).toHaveProperty('wp9_product_options')
  })
})
