// Commercial painting tender page e2e — spec specs/quote-visual-parity.md R4.
//
// Seeds a paint_runs row (with its owning tenant — tenant_id is NOT NULL)
// and asserts /q/commercial-paint/[public_token] renders the site aerial
// figure via the token-gated static-map proxy when site_address is present,
// and omits it when the run has no address. Assertions are on markup only.
//
// Seeded-row pattern mirrors tests/e2e/roofing-quote-workflow.spec.ts.

import { test, expect } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { randomBytes } from 'node:crypto'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
const seedable = Boolean(url && key)

// Both tests share one seeded fixture set — serial keeps them in ONE worker
// so beforeAll seeds exactly once (fullyParallel would re-run it per worker
// and trip the tenants_owner_email_unique constraint).
test.describe.configure({ mode: 'serial' })

const runSuffix = randomBytes(4).toString('hex')
const tokenWithAddress = `e2e${randomBytes(12).toString('hex')}`
const tokenWithout = `e2e${randomBytes(12).toString('hex')}`

test.describe('Commercial paint tender page (/q/commercial-paint/[token])', () => {
  test.skip(!seedable, 'Supabase service-role env not available for seeding')

  let tenantId: string
  const runIds: string[] = []

  test.beforeAll(async () => {
    const supabase = createClient(url!, key!)
    const { data: tenant, error: tenantErr } = await supabase
      .from('tenants')
      .insert({
        business_name: 'E2E Commercial Paint Co',
        trade: 'electrical',
        status: 'active',
        owner_email: `e2e-commercial-paint-${runSuffix}@example.com`,
        owner_mobile: '+61400000001',
      })
      .select('id')
      .single()
    if (tenantErr || !tenant) throw new Error(`tenant seed failed: ${tenantErr?.message}`)
    tenantId = tenant.id as string

    for (const seed of [
      {
        tenant_id: tenantId,
        job_name: 'E2E Warehouse repaint',
        site_address: '12 Sample St, Brisbane QLD 4000',
        public_token: tokenWithAddress,
      },
      {
        tenant_id: tenantId,
        job_name: 'E2E Addressless tender',
        site_address: null,
        public_token: tokenWithout,
      },
    ]) {
      const { data, error } = await supabase.from('paint_runs').insert(seed).select('id').single()
      if (error || !data) throw new Error(`paint_run seed failed: ${error?.message}`)
      runIds.push(data.id as string)
    }
  })

  test.afterAll(async () => {
    const supabase = createClient(url!, key!)
    if (runIds.length > 0) await supabase.from('paint_runs').delete().in('id', runIds)
    if (tenantId) await supabase.from('tenants').delete().eq('id', tenantId)
  })

  test('shows the site aerial figure when the run has an address', async ({ page }) => {
    await page.goto(`/q/commercial-paint/${tokenWithAddress}`, { waitUntil: 'domcontentloaded' })
    await expect(page.getByText('E2E Warehouse repaint').first()).toBeVisible()
    const aerial = page.locator(
      `img[src="/api/commercial-paint/q/${tokenWithAddress}/static-map"]`,
    )
    await expect(aerial).toHaveCount(1)
    await expect(page.getByText('Site aerial · Google Maps')).toBeVisible()
  })

  test('omits the aerial figure when the run has no address', async ({ page }) => {
    await page.goto(`/q/commercial-paint/${tokenWithout}`, { waitUntil: 'domcontentloaded' })
    await expect(page.getByText('E2E Addressless tender').first()).toBeVisible()
    expect(await page.locator('img[src*="/static-map"]').count()).toBe(0)
    expect(await page.getByText('Site aerial · Google Maps').count()).toBe(0)
  })
})
