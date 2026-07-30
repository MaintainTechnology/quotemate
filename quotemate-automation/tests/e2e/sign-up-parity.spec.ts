// E2E structural parity between the two signup funnels
// (specs/clerk-signup-parity.md).
//
// /sign-up (Clerk) must present step 01 exactly as /signup (Supabase) does. It
// gets that for free today by importing Field/INPUT/RequiredLegend/ErrorBanner
// from app/signup/page.tsx — these tests are the regression net that keeps it
// true if either page is edited independently.
//
// SCOPE LIMITATION, deliberate: account creation is NOT driven here. Clerk's
// frontend API is a third-party origin, and this repo's e2e idiom is to
// intercept only our own /api/* routes and never write to live services. The
// resume decision logic, the identifier-taken predicate and the Clerk identity
// backfill are covered by unit tests instead
// (lib/onboard/resume-decision.test.ts, lib/onboard/clerk-identity.test.ts).

import { test, expect, type Page } from '@playwright/test'

// The five step-01 fields, in the order both pages render them. Rendered label
// text carries a trailing '*' (the required marker is a nested span), which
// visibleFieldLabels strips.
const FIELD_LABELS = ['Business name', 'Your first name', 'Email', 'Mobile', 'Password']

async function visibleFieldLabels(page: Page): Promise<string[]> {
  // Both pages render each field through the shared <Field> primitive, whose
  // label is the first span inside a block <label>.
  return page.locator('form label').evaluateAll((labels) =>
    labels
      .map((l) => l.querySelector('span')?.textContent?.replace(/\*/g, '').trim() ?? '')
      .filter(Boolean),
  )
}

test.describe('/sign-up — step 01 parity with /signup', () => {
  test('renders the same funnel chrome: step 01 of 04 with the shared stepper', async ({ page }) => {
    await page.goto('/sign-up')
    await expect(page.getByRole('heading', { name: /create your account/i })).toBeVisible()
    const stepper = page.locator('ol[aria-label="Onboarding progress"]')
    await expect(stepper).toBeVisible()
    await expect(stepper).toContainText('Account')
    await expect(stepper).toContainText('Trade & licence')
    await expect(stepper).toContainText('Your pricing')
    await expect(stepper).toContainText('Review & activate')
  })

  test('renders the same five required fields in the same order', async ({ page }) => {
    await page.goto('/sign-up')
    const clerkLabels = await visibleFieldLabels(page)

    await page.goto('/signup')
    const supabaseLabels = await visibleFieldLabels(page)

    // The contract: identical field labels, identical order, on both funnels.
    expect(clerkLabels).toEqual(FIELD_LABELS)
    expect(clerkLabels).toEqual(supabaseLabels)
  })

  test('carries the same subtitle and no-card reassurance copy', async ({ page }) => {
    await page.goto('/sign-up')
    await expect(page.getByText(/takes about 30 seconds/i)).toBeVisible()
    // "No card" appears twice (the rail note and the under-button line), so
    // scope to the one inside the form.
    await expect(
      page.locator('form').getByText(/no card · we never auto-send/i),
    ).toBeVisible()
    await expect(page.locator('form').getByText(/required/i).first()).toBeVisible()
  })

  test('mounts the Clerk CAPTCHA slot before submit can run', async ({ page }) => {
    // Clerk's Smart CAPTCHA attaches to this node; if it is missing at render
    // time the sign-up call fails with a bot-protection error.
    await page.goto('/sign-up')
    await expect(page.locator('#clerk-captcha')).toBeAttached()
  })

  test('sends returning tradies to the live Clerk sign-in page', async ({ page }) => {
    await page.goto('/sign-up')
    const signIn = page.getByRole('link', { name: /sign in/i }).first()
    await expect(signIn).toHaveAttribute('href', '/sign-in')
  })

  test('prefills and locks the mobile when arriving from an SMS intent link', async ({ page }) => {
    // Same ?intent= contract as /signup: the tradie proved possession of the
    // handset by texting us, so the field is filled and read-only — no OTP.
    await page.route('**/api/onboard/intent/**', (route) =>
      route.fulfill({ json: { intent: { owner_mobile: '+61412345678' } } }),
    )
    await page.goto('/sign-up?intent=abc123')

    const mobile = page.locator('input[type="tel"]')
    await expect(mobile).toHaveValue('+61412345678')
    await expect(mobile).toHaveAttribute('readonly', '')
    await expect(page.getByText(/verified via sms/i).first()).toBeVisible()
  })

  test('explains an expired intent link instead of failing silently', async ({ page }) => {
    await page.route('**/api/onboard/intent/**', (route) =>
      route.fulfill({ status: 404, json: { error: 'not_found' } }),
    )
    await page.goto('/sign-up?intent=expired')
    await expect(page.getByText(/expired or was already used/i)).toBeVisible()
    // The form stays usable — the tradie can still sign up normally.
    await expect(page.locator('input[type="tel"]')).not.toHaveAttribute('readonly', '')
  })
})
