// Painting CUSTOMER quote page e2e — spec specs/quote-visual-parity.md R3.
//
// Seeds a released painting_measurements row and asserts /q/paint/[public_token]
// renders the quote content plus the new property-imagery semantics:
//   • the AI repaint figure NEVER renders unless preview_status === 'ready'
//     (customer page loads must never trigger a billable Gemini render);
//   • when the Street View figure renders, it points at the token-gated proxy.
// The seeded row carries preview_status='generating' so even the after-image
// PROXY would refuse to render (CAS held) — the test never bills Gemini.
// Assertions are on rendered HTML/attributes only, never on Google bytes.
//
// Seeded-row pattern mirrors tests/e2e/painting-estimate-page.spec.ts.

import { test, expect } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { randomBytes } from 'node:crypto'
import type { PaintingEstimate } from '../../lib/painting/types'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
const seedable = Boolean(url && key)

const publicToken = `e2e${randomBytes(12).toString('hex')}`
const estimateToken = `e2e${randomBytes(12).toString('hex')}`

const tier = (t: 'good' | 'better' | 'best', label: string, ex: number) => ({
  tier: t,
  label,
  ex_gst: ex,
  inc_gst: Math.round(ex * 1.1),
  inc_gst_low: Math.round(ex * 1.0),
  inc_gst_high: Math.round(ex * 1.2),
  scope: `${label} — walls, two coats.`,
})

const estimate: PaintingEstimate = {
  provider: 'solar',
  facts: {
    floor_area_m2: 180,
    floor_area_source: 'footprint',
    footprint_m2: 120,
    storeys: 1,
    bedrooms: 3,
    bathrooms: 2,
    year_built: 1998,
    property_type: 'House',
    land_size_m2: 600,
    has_floor_plan: false,
    source: 'solar',
    capture_note: null,
  },
  measurement: {
    floor_area_m2: 180,
    floor_area_low_m2: 160,
    floor_area_high_m2: 200,
    floor_area_source: 'footprint',
    ceiling_height_m: 2.4,
    storeys: 1,
    confidence: 'medium',
    surfaces: [
      { scope: 'walls', unit: 'm2', quantity: 380, quantity_low: 340, quantity_high: 420 },
    ],
    notes: ['e2e seeded painting estimate.'],
  },
  price: {
    confidence: 'medium',
    total_area_m2: 380,
    tiers: [
      tier('good', 'Refresh', 4000),
      tier('better', 'Standard', 5000),
      tier('best', 'Premium', 6500),
    ],
    loadings_applied: [],
    routing: { decision: 'tradie_review', reason: 'e2e seeded.' },
  },
  warnings: [],
}

test.describe('Painting customer quote page (/q/paint/[token])', () => {
  test.skip(!seedable, 'Supabase service-role env not available for seeding')

  let rowId: string

  test.beforeAll(async () => {
    const supabase = createClient(url!, key!)
    const { data, error } = await supabase
      .from('painting_measurements')
      .insert({
        address: '21 Greens Rd, Coorparoo',
        postcode: '4151',
        state: 'QLD',
        source: 'solar',
        scopes: ['walls', 'exterior'],
        floor_area_m2: 180,
        total_area_m2: 380,
        confidence: 'medium',
        better_inc_gst: 5500,
        routing: 'tradie_review',
        inputs: { scopes: ['walls', 'exterior'], coats: 2 },
        estimate,
        public_token: publicToken,
        estimate_token: estimateToken,
        released_at: new Date().toISOString(),
        // 'generating' — CAS-held, so nothing can trigger a Gemini render.
        preview_status: 'generating',
      })
      .select('id')
      .single()
    if (error || !data) throw new Error(`painting seed failed: ${error?.message}`)
    rowId = data.id as string
  })

  test.afterAll(async () => {
    if (!rowId) return
    const supabase = createClient(url!, key!)
    await supabase.from('painting_measurements').delete().eq('id', rowId)
  })

  test('renders the quote with imagery gated on cached-render status', async ({ page }) => {
    await page.goto(`/q/paint/${publicToken}`, { waitUntil: 'domcontentloaded' })

    // Quote content renders (address + a tier price).
    await expect(page.getByText('21 Greens Rd', { exact: false }).first()).toBeVisible()
    await expect(page.getByText('$5,500').first()).toBeVisible()

    // The AI repaint figure must be ABSENT — preview_status is not 'ready',
    // and a customer page load must never trigger a render.
    const after = page.locator(`img[src="/api/painting/q/${publicToken}/after-image"]`)
    expect(await after.count()).toBe(0)

    // Street View figure: present only when Google has a pano (metadata check)
    // AND the server key is configured. Both states are acceptable; when it
    // renders it must point at the token-gated proxy with its caption.
    const street = page.locator(`img[src="/api/painting/q/${publicToken}/street-view"]`)
    const streetCount = await street.count()
    expect([0, 1]).toContain(streetCount)
    if (streetCount === 1) {
      await expect(page.getByText('Front of the property · Google Street View')).toBeVisible()
    }
  })
})
