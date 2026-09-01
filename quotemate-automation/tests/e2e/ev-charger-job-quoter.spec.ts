import { expect, test, type Page } from '@playwright/test'

const catalogue = [
  {
    id: '00000000-0000-4000-8000-000000000002',
    name: 'Type 2 7kW wallbox (BYD-compatible)',
    brand: 'Demo',
    category: 'ev_charger',
    trade: 'electrical',
    unit_price_ex_gst: 1100,
    active: true,
  },
  {
    id: '00000000-0000-4000-8000-000000000001',
    name: 'Tesla Wall Connector (single-phase 7kW)',
    brand: 'Tesla',
    category: 'ev_charger',
    trade: 'electrical',
    unit_price_ex_gst: 890,
    active: true,
  },
  {
    id: '00000000-0000-4000-8000-000000000003',
    name: 'Inactive charger',
    category: 'ev_charger',
    trade: 'electrical',
    unit_price_ex_gst: 100,
    active: false,
  },
  {
    id: '00000000-0000-4000-8000-000000000004',
    name: 'Wrong category',
    category: 'downlight',
    trade: 'electrical',
    unit_price_ex_gst: 50,
    active: true,
  },
]

async function openQuoter(page: Page) {
  await page.addInitScript(() => {
    Object.defineProperty(globalThis, 'Clerk', {
      configurable: true,
      value: {
        loaded: true,
        status: 'ready',
        session: { getToken: async () => 'ev-e2e-token' },
      },
    })
  })
  await page.route('**/api/tenant/features', (route) =>
    route.fulfill({ json: { ok: true, trades: ['electrical'] } }),
  )
  await page.route('**/api/tenant/catalogue', (route) =>
    route.fulfill({ json: { ok: true, catalogue } }),
  )
  await page.goto('/dashboard/job/electrical')
  await expect(page.getByRole('heading', { name: 'Quote an electrical job' })).toBeVisible()
  await page.getByLabel('Job type').selectOption('ev_charger')
}

const questionLabels = [
  'What car is the charger for?',
  'Who supplies the charger unit?',
  'Where is the charger going (garage, carport, external wall)?',
  'Roughly how far is the switchboard from the charger spot?',
  'Single phase or three phase?',
]

test.describe('EV charger dashboard quoter', () => {
  test('renders the exact registry questions, catalogue ordering, and safe supply transition', async ({
    page,
  }) => {
    await openQuoter(page)

    const ids = ['f-vehicle', 'f-charger_supply', 'f-room', 'f-switchboard_distance', 'f-phase']
    await expect(page.locator('form label').filter({ hasText: questionLabels[0] })).toBeVisible()
    const domOrder = await page.locator(ids.map((id) => `#${id}`).join(', ')).evaluateAll((nodes) =>
      nodes.map((node) => node.id),
    )
    expect(domOrder).toEqual(ids)

    await expect(page.getByLabel(questionLabels[0]).locator('option')).toHaveText([
      'Not specified',
      'Tesla',
      'BYD',
      'another EV',
      'not sure',
    ])
    await expect(page.getByLabel(questionLabels[1]).locator('option')).toHaveText([
      'Not specified',
      'customer already has the charger',
      'we supply the charger',
      'not sure',
    ])
    await expect(page.getByLabel(questionLabels[3]).locator('option')).toHaveText([
      'Not specified',
      'under 5 m',
      '5–10 m',
      'over 10 m',
      'not sure',
    ])
    await expect(page.getByLabel(questionLabels[4]).locator('option')).toHaveText([
      'Not specified',
      'single phase',
      'three phase (on-site inspection)',
      'not sure',
    ])

    await page.getByLabel(questionLabels[1]).selectOption('we supply the charger')
    const product = page.getByLabel('Product from your catalogue (optional)')
    await expect(product).toBeVisible()
    await expect(product.locator('option')).toHaveText([
      'Let the estimator choose',
      'Tesla Wall Connector (single-phase 7kW) — $890 ex GST',
      'Type 2 7kW wallbox (BYD-compatible) — $1100 ex GST',
    ])

    await product.selectOption('Tesla Wall Connector (single-phase 7kW)')
    await page.getByLabel(questionLabels[1]).selectOption('customer already has the charger')
    await expect(product).toBeHidden()
    await page.getByLabel(questionLabels[1]).selectOption('we supply the charger')
    await expect(product).toHaveValue('')
  })

  test('posts all five answers and the tenant product id, then starts held-quote navigation', async ({
    page,
  }) => {
    let posted: Record<string, unknown> | null = null
    await page.route('**/api/tenant/job-quote', async (route) => {
      posted = route.request().postDataJSON() as Record<string, unknown>
      await route.fulfill({ json: { ok: true, shareToken: 'mock-ev-token' } })
    })
    await openQuoter(page)

    await page.getByLabel(questionLabels[0]).selectOption('Tesla')
    await page.getByLabel(questionLabels[1]).selectOption('we supply the charger')
    await page.getByLabel(questionLabels[2]).fill('external wall')
    await page.getByLabel(questionLabels[3]).selectOption('under 5 m')
    await page.getByLabel(questionLabels[4]).selectOption('single phase')
    await page
      .getByLabel('Product from your catalogue (optional)')
      .selectOption('Tesla Wall Connector (single-phase 7kW)')
    await page.getByLabel('Address').fill('12 Smith St')
    await page.getByLabel('Suburb').fill('Newtown')

    await page.getByRole('button', { name: 'Draft the quote' }).click()
    await expect.poll(() => posted).not.toBeNull()
    expect(posted).toMatchObject({
      job_type: 'ev_charger',
      product_id: '00000000-0000-4000-8000-000000000001',
      product_name: 'Tesla Wall Connector (single-phase 7kW)',
      answers: {
        vehicle: 'Tesla',
        charger_supply: 'we supply the charger',
        room: 'external wall',
        switchboard_distance: 'under 5 m',
        phase: 'single phase',
      },
    })
    // A share token is the success envelope. The component deliberately stays
    // busy while Next loads the quote route, preventing a duplicate draft.
    await expect(page.getByRole('button', { name: 'Drafting the quote…' })).toHaveAttribute(
      'aria-busy',
      'true',
    )
  })

  test('is usable at the 390px demo viewport without horizontal overflow', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await openQuoter(page)
    await page.getByLabel(questionLabels[1]).selectOption('we supply the charger')

    for (const label of questionLabels) await expect(page.getByLabel(label)).toBeVisible()
    await expect(page.getByLabel('Product from your catalogue (optional)')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Draft the quote' })).toBeVisible()
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true)
  })
})
