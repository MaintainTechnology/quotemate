// Painting tradie results page e2e — spec painting-measure-parity.
//
// Seeds a released painting_measurements row (the exact shape POST
// /api/painting/save inserts) and asserts the /p/[estimate_token] page
// renders the roofing-parity surface: title, the filled "Open customer
// quote" action, Download PDF, the send control, and the imagery section
// markup. The seeded row carries preview_status='generating' so the CAS
// claim refuses and the after-image route serves its fast Street View
// fallback — the test never invokes (or bills) Gemini. Assertions are on
// rendered HTML/attributes only — never on upstream Google image bytes.
//
// Seeded-row pattern mirrors tests/e2e/roofing-quote-workflow.spec.ts:
// service-role insert in beforeAll, delete in afterAll, skip when env absent.

import { test, expect } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { randomBytes } from 'node:crypto'
import type { PaintingEstimate } from '../../lib/painting/types'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
const seedable = Boolean(url && key)

const estimateToken = `e2e${randomBytes(12).toString('hex')}`
const publicToken = `e2e${randomBytes(12).toString('hex')}`

const tier = (t: 'good' | 'better' | 'best', label: string, ex: number) => ({
  tier: t,
  label,
  ex_gst: ex,
  inc_gst: Math.round(ex * 1.1),
  inc_gst_low: Math.round(ex * 1.0),
  inc_gst_high: Math.round(ex * 1.2),
  scope: `${label} — walls, two coats.`,
})

// Materials + labour take-off fixture (one tier's worth, repeated per tier —
// display data only; shapes must satisfy PaintingTakeoffTier).
const takeoffTier = (t: 'good' | 'better' | 'best') => ({
  tier: t,
  products: [
    {
      product: 'wall_paint' as const,
      litres: t === 'good' ? 23.8 : 47.5,
      litres_low: 21.3,
      litres_high: 52.5,
      packs: [
        { size_l: 15, count: 3 },
        { size_l: 4, count: 1 },
      ],
      cost_ex_gst: 686,
      note: '380 m² × 2 coats ÷ 16 m²/L = 47.5 L → packed 49 L × $14/L',
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
  sundries_note: '8% of product cost — filler, caulk, tape, drop sheets',
  labour_note: 'walls 380 m² ÷ 3 m²/hr × 1 (coats · prep · colour) = 126.7 h @ $85/hr · 2 painters × 7.6 h/day ≈ 9 days',
  margin_note: 'Better $4,000 ex GST − materials $741 − labour $10,770',
})

// Minimal-but-complete PaintingEstimate: every field PaintResultView and
// /p/[token]/page.tsx read (facts grid, surfaces, tiers, routing).
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
    structure_label: 'Main building',
    structure_role: 'primary',
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
  takeoff: {
    tiers: [takeoffTier('good'), takeoffTier('better'), takeoffTier('best')],
  },
}

test.describe('Painting tradie results page (/p/[token])', () => {
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
        // exterior included: the AI after-image figure (and its generation)
        // is gated on exterior scope — interior-only jobs show Street View only.
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
        // 'generating' ⇒ the CAS claim in generatePaintAfterImage refuses
        // (another "request" holds it), so the after-image route serves its
        // fast Street View fallback and the test never invokes (or bills)
        // Gemini. NOTE: 'failed' would NOT work — failed is deliberately
        // CAS-retryable, so it would trigger a real render.
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

  test('renders the estimate with roofing-parity actions and imagery markup', async ({ page }) => {
    // domcontentloaded: assertions below poll for elements/attributes and
    // never depend on the <img> BYTES, so don't gate the test on Google
    // image subresources finishing under full-suite parallel load.
    await page.goto(`/p/${estimateToken}`, { waitUntil: 'domcontentloaded' })

    // Title block + estimate content.
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/estimate/i)
    await expect(page.getByText('21 Greens Rd, Coorparoo').first()).toBeVisible()

    // Filled-accent primary matching /m: "Open customer quote", new tab,
    // pointing at the customer page.
    const openQuote = page.getByRole('link', { name: /open customer quote/i })
    await expect(openQuote).toBeVisible()
    await expect(openQuote).toHaveAttribute('href', `/q/paint/${publicToken}`)
    await expect(openQuote).toHaveAttribute('target', '_blank')
    await expect(openQuote).toHaveClass(/bg-accent/)

    // Download PDF → the token-scoped PDF route, new tab.
    const pdf = page.getByRole('link', { name: /download pdf/i })
    await expect(pdf).toBeVisible()
    await expect(pdf).toHaveAttribute('href', `/api/q/paint/${publicToken}/pdf`)

    // Send control present (released row shows the sent state + resend).
    await expect(
      page.getByText(/send to customer|sent to customer/i).first(),
    ).toBeVisible()

    // Imagery: markup consistency — when the section renders, both images
    // must point at the token-scoped proxies. This seed includes 'exterior'
    // scope, so the (exterior-gated) AI after-image renders whenever the
    // street-view figure does; when Street View has no pano the whole
    // section is absent. Either way the counts match.
    const before = page.locator(`img[src="/api/painting/q/${publicToken}/street-view"]`)
    const after = page.locator(`img[src="/api/painting/q/${publicToken}/after-image"]`)
    expect(await before.count()).toBe(await after.count())

    // Materials & labour take-off — tradie surface shows it…
    await expect(page.getByText('Materials & labour').first()).toBeVisible()
    await expect(page.getByText('Wall paint').first()).toBeVisible()
    await expect(page.getByText(/Margin \(ex GST\) · tradie only/).first()).toBeVisible()

    // …with the derivation notes behind a details toggle…
    await expect(page.getByText('How these numbers were built').first()).toBeVisible()

    // …and the selected structure surfaced in Property details.
    await expect(page.getByText('Main building').first()).toBeVisible()
  })

  test('the customer page never shows the take-off or margin', async ({ page }) => {
    await page.goto(`/q/paint/${publicToken}`, { waitUntil: 'domcontentloaded' })
    // The page rendered something real…
    await expect(page.getByText('21 Greens Rd, Coorparoo').first()).toBeVisible()
    // …and none of the tradie-only take-off strings leaked.
    await expect(page.getByText(/Materials & labour/i)).toHaveCount(0)
    await expect(page.getByText(/margin/i)).toHaveCount(0)
    await expect(page.getByText(/tradie only/i)).toHaveCount(0)
    await expect(page.getByText(/How these numbers were built/i)).toHaveCount(0)
  })
})
