import { test, expect } from '@playwright/test'

test.describe('Solar entry page — /solar/[tenantSlug]', () => {
  test('404s an unknown tenant slug', async ({ page }) => {
    const res = await page.goto('/solar/00000000-0000-0000-0000-000000000000')
    expect(res?.status()).toBe(404)
  })

  test('404s a clearly malformed slug', async ({ page }) => {
    const res = await page.goto('/solar/x')
    expect(res?.status()).toBe(404)
  })
})
