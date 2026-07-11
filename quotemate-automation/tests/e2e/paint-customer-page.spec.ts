// Painting CUSTOMER quote page e2e — spec specs/quote-visual-parity.md R3.
//
// Seeds a released painting_measurements row and asserts /q/paint/[public_token]
// renders the quote content plus the property-imagery semantics:
//   • photos row (Street View + aerial) up top, before/after repaint block
//     below — the after <img> always renders (auto-generation, product
//     decision 2026-07-11) and points at the token-gated proxy;
//   • every image points at a token-gated /api/painting/q/[token] proxy.
// The seeded row carries preview_status='generating' so the after-image
// route's CAS claim refuses and it serves its Street View fallback — the
// test never invokes (or bills) Gemini.
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

const takeoffTier = (t: 'good' | 'better' | 'best') => ({
  tier: t,
  products: [
    {
      product: 'wall_paint' as const,
      litres: 47.5,
      litres_low: 42.5,
      litres_high: 52.5,
      packs: [
        { size_l: 15, count: 3 },
        { size_l: 4, count: 1 },
      ],
      cost_ex_gst: 686,
      note: 'internal',
    },
  ],
  sundries_ex_gst: 54.88,
  materials_ex_gst: 740.88,
  labour_hours: 126.7,
  labour_ex_gst: 10769.5,
  crew_size: 2,
  days_on_site: 9,
  margin_ex_gst: -6510.38,
  margin_pct: -1.3021,
  sundries_note: 'internal',
  labour_note: 'internal',
  margin_note: 'internal',
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
    notes: [
      // Mixed voice on purpose: the customer page must keep the derivation
      // sentence and strip the tradie instruction (customerMeasurementNotes).
      'Estimated from building footprint (120 m²) × 1 storey. Confirm storeys and internal area.',
      'Walls ≈ floor area × 2.8 (2.4 m ceilings, openings deducted).',
    ],
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
    call_out_minimum_applied: false,
    // Customer-safe price derivation — drives the "How your price was
    // built" section on /q/paint (and the PDF table). Engine-consistent:
    // line_ex_gst = 380 × 12 × 1.1 (colour) = 5016 = better_ex_gst, so the
    // surface cost sums exactly to the subtotal.
    breakdown: {
      surfaces: [{ scope: 'walls', unit: 'm2', quantity: 380, rate_per_unit: 12, line_ex_gst: 5016 }],
      coats_multiplier: 1,
      prep_multiplier: 1,
      colour_change_multiplier: 1.1,
      double_storey_multiplier: 1,
      better_ex_gst: 5016,
      good_refresh_fraction: 0.72,
      premium_uplift_pct: 0.28,
      gst_factor: 1.1,
      call_out_minimum_ex_gst: 0,
    },
  },
  warnings: [],
  // Minimal take-off so the customer "Materials & time on site" section
  // renders (quantities + duration only; the $ fields never leave the
  // tradie surfaces).
  takeoff: {
    tiers: [takeoffTier('good'), takeoffTier('better'), takeoffTier('best')],
  },
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

  test('renders the quote with the photos row and before/after repaint block', async ({ page }) => {
    await page.goto(`/q/paint/${publicToken}`, { waitUntil: 'domcontentloaded' })

    // Quote content renders (address + a tier price).
    await expect(page.getByText('21 Greens Rd', { exact: false }).first()).toBeVisible()
    await expect(page.getByText('$5,500').first()).toBeVisible()

    // Imagery section is gated on the (free) Street View metadata check —
    // both states are acceptable. When it renders: the Street View photo
    // appears twice (photos row + the before pane of the repaint block) and
    // the auto-generated after <img> renders alongside with its picker,
    // every src a token-gated proxy.
    const street = page.locator(`img[src="/api/painting/q/${publicToken}/street-view"]`)
    const after = page.locator(`img[src="/api/painting/q/${publicToken}/after-image"]`)
    const streetCount = await street.count()
    expect([0, 2]).toContain(streetCount)
    expect(await after.count()).toBe(streetCount / 2)
    if (streetCount === 2) {
      await expect(page.getByText('Front of the property · Google Street View')).toBeVisible()
      await expect(page.getByText('Fresh repaint · AI preview')).toBeVisible()
      await expect(page.getByText('Try a colour')).toBeVisible()
    }
  })

  test('shows the customer-safe price build, materials and measurement notes', async ({ page }) => {
    await page.goto(`/q/paint/${publicToken}`, { waitUntil: 'domcontentloaded' })

    // Price derivation — per-surface COST that sums to the subtotal, GST.
    await expect(page.getByText('How your price was built').first()).toBeVisible()
    await expect(page.getByText('Walls · 380 m²').first()).toBeVisible()
    await expect(page.getByText('Subtotal (ex GST)').first()).toBeVisible()
    // Single surface: cost === subtotal === $5,016 (both render this).
    expect(await page.getByText('$5,016').count()).toBeGreaterThanOrEqual(2)
    await expect(page.getByText('GST', { exact: true }).first()).toBeVisible()
    // No false "quantity × base-rate" equation, no double-counting step.
    await expect(page.getByText(/× \$12\/m²/)).toHaveCount(0)
    await expect(page.getByText('Coats · preparation · colour')).toHaveCount(0)

    // Measurement provenance — derivation kept, tradie instruction stripped.
    await expect(page.getByText('How we measured').first()).toBeVisible()
    await expect(
      page.getByText('Estimated from building footprint (120 m²) × 1 storey.').first(),
    ).toBeVisible()
    await expect(page.getByText(/Confirm storeys/i)).toHaveCount(0)

    // Materials & time on site stays alongside the new detail — quantities
    // and duration only.
    await expect(page.getByText('Materials & time on site').first()).toBeVisible()
    await expect(page.getByText('Wall paint — 47.5 L (3×15 L + 1×4 L)').first()).toBeVisible()
    await expect(page.getByText('≈9 days on site · 2 painters (126.7 h)').first()).toBeVisible()

    // Tradie-only internals never leak (assert the data, not CSS 'margin').
    await expect(page.getByText(/Margin \(ex GST\)/i)).toHaveCount(0)
    await expect(page.getByText('10,769', { exact: false })).toHaveCount(0)
    await expect(page.getByText('740.88', { exact: false })).toHaveCount(0)
  })
})
