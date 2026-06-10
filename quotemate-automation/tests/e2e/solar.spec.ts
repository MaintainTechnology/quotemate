// E2E coverage for the solar review/deposit gate + customer page states.
//
// Mirrors tests/e2e/activation.spec.ts: we drive the API contracts and
// the rendered page states rather than the full address→estimate wizard
// (which needs a real Supabase Auth session + live Google Solar key).
//
//   1. POST /api/solar/confirm/[token] unauthenticated → 401 (no auto-
//      send; the forced tradie step is auth-gated).
//   2. GET /r/solar/[token]/[tier] with a bogus tier → 400 (tier guard).
//   3. /q/solar/[token] for an UNKNOWN token → the page does not crash;
//      it 404s or renders the not-found state (token guard).

import { test, expect } from '@playwright/test'

const SAMPLE_TOKEN = 'tok_e2e_unknown_000000'

test.describe('Solar review gate — API contracts', () => {
  test('confirm route rejects unauthenticated calls', async ({ request }) => {
    const res = await request.post(`/api/solar/confirm/${SAMPLE_TOKEN}`)
    expect(res.status()).toBe(401)
    const body = await res.json()
    expect(body.ok).toBe(false)
    expect(body.error).toBe('unauthorized')
  })

  test('confirm route rejects bogus Bearer tokens with 401', async ({ request }) => {
    const res = await request.post(`/api/solar/confirm/${SAMPLE_TOKEN}`, {
      headers: { Authorization: 'Bearer not-a-real-token-just-for-testing' },
    })
    expect(res.status()).toBe(401)
    const body = await res.json()
    expect(body.error).toBe('unauthorized')
  })

  test('deposit short-link rejects an invalid tier with 400', async ({ request }) => {
    const res = await request.get(`/r/solar/${SAMPLE_TOKEN}/platinum`, {
      maxRedirects: 0,
    })
    expect(res.status()).toBe(400)
    expect(await res.text()).toContain('Invalid tier')
  })

  test('deposit short-link 404s a known-good tier on an unknown token', async ({
    request,
  }) => {
    const res = await request.get(`/r/solar/${SAMPLE_TOKEN}/better`, {
      maxRedirects: 0,
    })
    expect(res.status()).toBe(404)
  })
})

test.describe('Solar customer page — pre-confirmation state', () => {
  test('unknown token does not crash the page (renders 404 / not-found)', async ({
    page,
  }) => {
    const res = await page.goto(`/q/solar/${SAMPLE_TOKEN}`)
    // Next renders the not-found page for an unresolved token; assert we
    // got a 4xx and the page is not a 500 error.
    expect(res?.status()).toBeGreaterThanOrEqual(400)
    expect(res?.status()).toBeLessThan(500)
  })
})
