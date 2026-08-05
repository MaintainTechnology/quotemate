// /r/paint/[token]/[tier] — the legacy-tier redirect (spec
// painting-site-visit-first R2).
//
// Only the G/B/B branch is exercised here: it returns BEFORE any Supabase or
// Stripe call, so it needs no mocks. The mint gate itself (released ∨
// inspection-routed admit, held reject) is unit-tested pure in
// lib/painting/pay-redirect.test.ts.

import { describe, expect, it, beforeAll } from 'vitest'
import { GET } from './route'

const APP = 'https://www.quotemax.com.au'
const token = 'tok_paint_123456'

beforeAll(() => {
  process.env.APP_URL = APP
})

function call(tier: string) {
  return GET(new Request(`${APP}/r/paint/${token}/${tier}`), {
    params: Promise.resolve({ token, tier }),
  })
}

describe('GET /r/paint/[token]/[tier]', () => {
  it('302s every legacy deposit tier onto the $99 site-visit mint', async () => {
    for (const tier of ['good', 'better', 'best']) {
      const res = await call(tier)
      expect(res.status).toBe(302)
      expect(res.headers.get('location')).toBe(`${APP}/r/paint/${token}/inspection`)
    }
  })

  it('keeps the 400 for a garbage tier', async () => {
    const res = await call('premium')
    expect(res.status).toBe(400)
  })
})
