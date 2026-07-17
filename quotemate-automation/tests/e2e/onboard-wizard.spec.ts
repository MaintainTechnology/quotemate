// E2E coverage for the onboarding wizard refresh (specs/onboarding-wizard-refresh.md):
//
//   1. The invitation-code gate renders inside the funnel chrome — the
//      4-step breadcrumb (Account done → Trade & licence active) must be
//      visible on it, not just on the wizard steps.
//
//   2. With identity carried over from signup (URL params incl. a verified
//      owner_mobile), the trade step does NOT re-ask for the mobile, and the
//      logo stays optional (monogram default).
//
//   3. A roofing-only tenant sees the seven $/m² material rate inputs on the
//      pricing step, pre-filled with the AU defaults (cement sheet blank),
//      plus the existing scheduling ("Booking availability") section — and
//      activation succeeds with every brand field left blank, carrying the
//      edited roofing rate in the payload.
//
// No real Supabase/Twilio/Vapi: /api/onboard/validate-code, /api/onboard/trades
// and /api/onboard/activate are intercepted with page.route(), matching the
// repo's e2e idiom of never writing to live services.

import { test, expect, type Page } from '@playwright/test'
import { DEFAULT_ROOFING_RATE_CARD } from '../../lib/roofing/pricing'

// The wizard pre-fills from this exact constant — assert against it so a
// deliberate re-tune of the shipped defaults doesn't read as a wizard bug.
const RATES = DEFAULT_ROOFING_RATE_CARD.reroof_rate_per_m2

// owner_mobile is deliberately the spaced local format: the wizard must
// treat it as verified (hide the field) AND post the normalised E.164 form,
// since the activate schema's regex is stricter than the lock check.
const IDENTITY_PARAMS = new URLSearchParams({
  business_name: 'Roo Roofing',
  owner_first_name: 'Rick',
  owner_email: 'rick@example.com',
  owner_user_id: '2b1a8f9e-3c4d-4e5f-8a6b-7c8d9e0f1a2b',
  owner_mobile: '0412 345 678',
})

async function interceptOnboardApis(page: Page) {
  await page.route('**/api/onboard/validate-code', (route) =>
    route.fulfill({ json: { ok: true } }),
  )
  await page.route('**/api/onboard/trades', (route) =>
    route.fulfill({
      json: { ok: true, onboardable: ['electrical', 'plumbing', 'painting', 'roofing'] },
    }),
  )
}

test.describe('Onboarding wizard — code gate', () => {
  test('shows the funnel breadcrumb on the invitation-code gate', async ({ page }) => {
    await page.goto('/onboard')
    await expect(page.getByRole('heading', { name: /one code to start/i })).toBeVisible()
    // Desktop rail stepper (default viewport is ≥ lg)
    const stepper = page.locator('ol[aria-label="Onboarding progress"]')
    await expect(stepper).toBeVisible()
    await expect(stepper).toContainText('Account')
    await expect(stepper).toContainText('Trade & licence')
    await expect(stepper).toContainText('Your pricing')
    await expect(stepper).toContainText('Review & activate')
    // Account (step 01) is done; the gate belongs to step 02.
    await expect(stepper).toContainText('In progress')
  })
})

test.describe('Onboarding wizard — roofing-only flow, optional inputs blank', () => {
  test('trade step shows the carried-over mobile locked and keeps the logo optional', async ({ page }) => {
    await interceptOnboardApis(page)
    await page.goto(`/onboard?${IDENTITY_PARAMS.toString()}`)

    // Pass the code gate.
    await page.getByPlaceholder(/JON-JUNE-FLYERS/i).fill('ROO-TEST-7K2P')
    await page.getByRole('button', { name: /continue/i }).click()

    // Trade step: logo presented as optional. The verified mobile stays
    // visible (nothing is removed) but read-only and normalised to E.164.
    await expect(page.getByText('Optional · shows on every quote')).toBeVisible()
    const mobile = page.getByLabel('Mobile')
    await expect(mobile).toBeVisible()
    await expect(mobile).toHaveValue('+61412345678')
    await expect(mobile).toHaveAttribute('readonly', '')
  })

  test('trade selection alone unlocks Continue — mobile and state stay optional', async ({ page }) => {
    await interceptOnboardApis(page)
    // No identity params at all: mobile and state are blank and editable.
    await page.goto('/onboard')

    await page.getByPlaceholder(/JON-JUNE-FLYERS/i).fill('ROO-TEST-7K2P')
    await page.getByRole('button', { name: /continue/i }).click()

    const cont = page.getByRole('button', { name: /continue/i })
    await expect(cont).toBeDisabled()
    await page.getByRole('button', { name: 'Roofing', exact: true }).click()
    await expect(cont).toBeEnabled()
    await cont.click()

    // Reached the pricing step with mobile + state untouched.
    await expect(page.getByRole('heading', { name: /your pricing/i })).toBeVisible()
  })

  test('a mangled carried-over mobile still gets an editable field, not a dead-end', async ({ page }) => {
    await interceptOnboardApis(page)
    const params = new URLSearchParams(IDENTITY_PARAMS)
    params.set('owner_mobile', '0412') // truncated — not a valid AU mobile
    await page.goto(`/onboard?${params.toString()}`)

    await page.getByPlaceholder(/JON-JUNE-FLYERS/i).fill('ROO-TEST-7K2P')
    await page.getByRole('button', { name: /continue/i }).click()

    // The invalid carry-over must NOT count as verified: the Mobile field
    // renders (pre-filled with the mangled value) so the tradie can fix it.
    await expect(page.getByLabel('Mobile')).toBeVisible()
    await expect(page.getByLabel('Mobile')).toHaveValue('0412')
  })

  test('roofing pricing shows the seven rates pre-filled; activation succeeds with brand fields blank', async ({ page }) => {
    await interceptOnboardApis(page)

    let activateBody: Record<string, unknown> | null = null
    await page.route('**/api/onboard/activate', (route) => {
      activateBody = route.request().postDataJSON()
      return route.fulfill({
        json: { ok: true, tenantId: 't-e2e', phoneNumber: '+61400000000' },
      })
    })

    await page.goto(`/onboard?${IDENTITY_PARAMS.toString()}`)

    // Code gate.
    await page.getByPlaceholder(/JON-JUNE-FLYERS/i).fill('ROO-TEST-7K2P')
    await page.getByRole('button', { name: /continue/i }).click()

    // Trade step: roofing only + state. Everything else stays blank.
    await page.getByRole('button', { name: 'Roofing', exact: true }).click()
    await page.getByLabel(/state/i).selectOption('QLD')
    await page.getByRole('button', { name: /continue/i }).click()

    // Pricing step: seven material rates, AU defaults pre-filled.
    await expect(page.getByLabel('Colorbond Corrugated')).toHaveValue(String(RATES.colorbond_corrugated))
    await expect(page.getByLabel('Colorbond Trimdek')).toHaveValue(String(RATES.colorbond_trimdek))
    await expect(page.getByLabel('Colorbond Spandek')).toHaveValue(String(RATES.colorbond_spandek))
    await expect(page.getByLabel('Colorbond Klip-Lok 700')).toHaveValue(String(RATES.colorbond_kliplok))
    await expect(page.getByLabel('Concrete tile')).toHaveValue(String(RATES.concrete_tile))
    await expect(page.getByLabel('Terracotta tile')).toHaveValue(String(RATES.terracotta_tile))
    await expect(page.getByLabel('Cement sheet')).toHaveValue('')
    // No labour-rate fields for a roofing-only tenant.
    await expect(page.getByLabel('Hourly rate')).toHaveCount(0)
    // Scheduling section (existing availability editor) is present.
    await expect(page.getByText('Booking availability (optional)')).toBeVisible()

    // Tune one rate, continue to review.
    await page.getByLabel('Colorbond Corrugated').fill('200')
    await page.getByRole('button', { name: /continue/i }).click()

    // Review reflects the customised rate card.
    await expect(page.getByText('Measured per-m² rate card (custom rates)')).toBeVisible()

    // Activate — intercepted; assert the payload and the redirect.
    await page.getByRole('button', { name: /activate my quotemax/i }).click()
    await page.waitForURL('**/onboard/success**')

    expect(activateBody).not.toBeNull()
    const body = activateBody!
    expect(body.roofing_corrugated_rate).toBe('200')
    expect(body.roofing_kliplok_rate).toBe(String(RATES.colorbond_kliplok))
    expect(body.roofing_cement_sheet_rate).toBe('')
    expect(body.trades).toEqual(['roofing'])
    expect(body.logo_url).toBe('')
    expect(body.contact_name).toBe('')
    expect(body.business_address).toBe('')
    expect(body.website_url).toBe('')
    expect(body.owner_mobile).toBe('+61412345678') // normalised from the spaced param
  })
})
