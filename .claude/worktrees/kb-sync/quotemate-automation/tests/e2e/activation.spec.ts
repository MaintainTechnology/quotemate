// E2E coverage for the onboarding activation + retry flow.
//
// We deliberately avoid driving the wizard from /signup → /onboard end-
// to-end because that requires a real Supabase Auth session. Instead we:
//
//   1. Hit /api/onboard/preflight (no auth, always-on) to confirm the
//      diagnostic returns the contract the dashboard + success page rely
//      on (ok flag, summary.twilio_mode, summary.missing_for_activation).
//
//   2. Hit /api/onboard/retry-provision unauthenticated to confirm it
//      gates correctly (401, JSON body with error: unauthorized).
//
//   3. Render /onboard/success with a missing phone search param and
//      assert the page shows the retry panel (UI fix for the reported
//      "Number not yet assigned" dead-end). With a phone param it
//      shows the big number reveal instead.

import { test, expect } from '@playwright/test'

test.describe('Onboarding activation — API contracts', () => {
  test('/api/onboard/preflight returns the documented shape', async ({ request }) => {
    const res = await request.get('/api/onboard/preflight')
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body).toHaveProperty('ok')
    expect(body).toHaveProperty('summary')
    expect(body.summary).toHaveProperty('twilio_mode')
    expect(['stub', 'real']).toContain(body.summary.twilio_mode)
    expect(body.summary).toHaveProperty('vapi_mode')
    expect(['stub', 'real']).toContain(body.summary.vapi_mode)
    expect(Array.isArray(body.summary.missing_for_activation)).toBe(true)
    expect(Array.isArray(body.checks)).toBe(true)
    expect(typeof body.note).toBe('string')
  })

  test('/api/onboard/retry-provision rejects unauthenticated calls', async ({ request }) => {
    const res = await request.post('/api/onboard/retry-provision')
    expect(res.status()).toBe(401)
    const body = await res.json()
    expect(body.ok).toBe(false)
    expect(body.error).toBe('unauthorized')
  })

  test('/api/onboard/retry-provision rejects bogus Bearer tokens with 401', async ({ request }) => {
    const res = await request.post('/api/onboard/retry-provision', {
      headers: { Authorization: 'Bearer not-a-real-token-just-for-testing' },
    })
    expect(res.status()).toBe(401)
    const body = await res.json()
    expect(body.error).toBe('unauthorized')
  })
})

test.describe('Onboarding success page — UI states', () => {
  test('shows the dramatic phone number reveal when phone is in the URL', async ({ page }) => {
    await page.goto(
      '/onboard/success?tenant=test-tenant&phone=%2B61412345678&name=Jeph',
    )
    // Hero heading
    await expect(page.getByRole('heading', { level: 1 })).toContainText(
      /Jeph/i,
    )
    // The big phone number block is rendered with our data-testid
    const phone = page.getByTestId('success-phone-number')
    await expect(phone).toBeVisible()
    await expect(phone).toContainText('+61')
    await expect(phone).toContainText('412')
    // The retry panel is NOT rendered when a number is present
    await expect(page.getByTestId('success-no-number')).toHaveCount(0)
  })

  test('shows the retry panel when phone is missing — no dead-end', async ({
    page,
  }) => {
    await page.goto(
      '/onboard/success?tenant=test-tenant&name=Jeph&warning=Twilio%3A%20Authentication%20Error',
    )
    // Confirm we no longer show the unassigned dead-end without action
    await expect(page.getByTestId('success-no-number')).toBeVisible()
    // The retry button is rendered + interactive
    const retry = page.getByRole('button', { name: /retry provisioning/i })
    await expect(retry).toBeVisible()
    await expect(retry).toBeEnabled()
    // The warning surfaces the real provisioning error so the user can act
    await expect(page.getByText(/Twilio: Authentication Error/)).toBeVisible()
    // The preflight pointer is rendered (helps tradies self-diagnose)
    await expect(page.getByText(/\/api\/onboard\/preflight/)).toBeVisible()
  })
})
