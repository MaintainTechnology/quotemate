// Roofing layout map e2e — spec specs/quote-visual-parity.md R6e.
//
// Seeds two CONFIRMED roofing_measurements rows: one with a cached layout
// plan (layout_status='ready') and one without. /q/roof/[token] must render
// the header + colour-coded overlay + legend for the first, and no layout
// section for the second. The customer page only READS the cached plan —
// nothing in this test can trigger a Gemini call.
//
// Seeded-row pattern mirrors tests/e2e/roofing-quote-workflow.spec.ts.

import { test, expect } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { randomBytes } from 'node:crypto'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
const seedable = Boolean(url && key)

// Both tests share one seeded fixture set — serial keeps them in ONE worker
// so beforeAll seeds exactly once (fullyParallel re-runs it per worker).
test.describe.configure({ mode: 'serial' })

const tokenWithPlan = `e2e${randomBytes(12).toString('hex')}`
const tokenWithout = `e2e${randomBytes(12).toString('hex')}`

// ~20m square footprint in Brisbane — enough geometry for the overlay.
const LNG = 153.02
const LAT = -27.47
const D = 0.0001
const polygon = {
  type: 'Polygon',
  coordinates: [
    [
      [LNG - D, LAT - D],
      [LNG + D, LAT - D],
      [LNG + D, LAT + D],
      [LNG - D, LAT + D],
      [LNG - D, LAT - D],
    ],
  ],
}

const tiers = [
  { tier: 'good', label: 'Patch / repair', ex_gst: 2000, inc_gst: 2200, scope: 'Patch the damaged sections.' },
  { tier: 'better', label: 'Re-roof', ex_gst: 18000, inc_gst: 19800, scope: 'Full re-roof in Colorbond.' },
  { tier: 'best', label: 'Upgrade', ex_gst: 24000, inc_gst: 26400, scope: 'Upgrade to premium Colorbond.' },
]

const quote = {
  structures: [
    {
      buildingId: 'e2e-bld-1',
      role: 'primary',
      label: 'Main dwelling',
      metrics: {
        footprint_m2: 169,
        sloped_area_m2: 194,
        storeys: 1,
        form: 'hip',
        hips: 4,
        valleys: 2,
        ridge_lm: 21,
        polygon_geojson: polygon,
        capture_date: null,
      },
      inputs: { material: 'colorbond_corrugated', pitch: 'standard', intent: 'full_reroof' },
      price: {
        tiers,
        routing: { decision: 'tradie_review', reason: 'e2e seeded' },
        // StructureBreakdown reads these unconditionally.
        loadings_applied: [],
        call_out_minimum_applied: false,
      },
    },
  ],
  combined: { area_m2: 194, tiers },
  routing: { decision: 'tradie_review', reason: 'e2e seeded' },
  inspection_structures: [],
}

const layoutPlan = {
  header: 'Please see the roof layout map below to provide clarity on your quote!',
  mode: 'reroof',
  zones: [
    {
      color: 'teal',
      label: 'Install NEW Colorbond (Custom Orb) roof sheeting to replace existing.',
      placement: 'structure',
      structureIndex: 1,
    },
    {
      color: 'red',
      label: 'Ground-up scaffolding to the work-area perimeter for WHS.',
      placement: 'perimeter',
      structureIndex: 1,
    },
  ],
}

test.describe('Roofing customer layout map (/q/roof/[token])', () => {
  test.skip(!seedable, 'Supabase service-role env not available for seeding')

  const rowIds: string[] = []

  test.beforeAll(async () => {
    const supabase = createClient(url!, key!)
    const base = {
      address: '12 Sample St, Brisbane QLD 4000',
      state: 'QLD',
      provider: 'geoscape',
      routing: 'tradie_review',
      combined_area_m2: 194,
      quote,
      confirmed_at: new Date().toISOString(),
      confirmed_structure: 1,
      included_indices: [1],
    }
    for (const seed of [
      { ...base, public_token: tokenWithPlan, layout_status: 'ready', layout_plan: layoutPlan },
      { ...base, public_token: tokenWithout },
    ]) {
      const { data, error } = await supabase
        .from('roofing_measurements')
        .insert(seed)
        .select('id')
        .single()
      if (error || !data) throw new Error(`roofing seed failed: ${error?.message}`)
      rowIds.push(data.id as string)
    }
  })

  test.afterAll(async () => {
    if (rowIds.length === 0) return
    const supabase = createClient(url!, key!)
    await supabase.from('roofing_measurements').delete().in('id', rowIds)
  })

  test('renders header, overlay and legend from the cached plan', async ({ page }) => {
    await page.goto(`/q/roof/${tokenWithPlan}`, { waitUntil: 'domcontentloaded' })

    await expect(
      page.getByText('Please see the roof layout map below', { exact: false }),
    ).toBeVisible()
    // Zone labels render verbatim (on-map callout AND the legend below).
    await expect(
      page.getByText('Install NEW Colorbond (Custom Orb) roof sheeting to replace existing.').first(),
    ).toBeVisible()
    await expect(
      page.getByText('Ground-up scaffolding to the work-area perimeter for WHS.').first(),
    ).toBeVisible()
    // Estimated materials with basis/use transparency (customer view).
    await expect(page.getByText('Estimated materials')).toBeVisible()
    await expect(page.getByText('Colorbond sheets')).toBeVisible()
    // sheets = ceil(194 / 4.191 × 1.1) = 51
    await expect(page.getByText('51 sheets')).toBeVisible()
    await expect(page.getByText(/measured sloped roof/).first()).toBeVisible()

    // Interactive MapLibre figure: the map container boots with pan/zoom/
    // rotate controls — ± buttons and the compass (click = reset north).
    const mapFigure = page.getByTestId('layout-map')
    await expect(mapFigure).toBeVisible()
    await expect(mapFigure.locator('.maplibregl-ctrl-zoom-in')).toBeVisible({ timeout: 20000 })
    await expect(mapFigure.locator('.maplibregl-ctrl-compass')).toBeVisible()
    // The on-map ZONE callout ties to the numbered legend below.
    await expect(mapFigure.getByText('ZONE 01')).toBeVisible()
  })

  test('renders no layout section when no plan is cached', async ({ page }) => {
    await page.goto(`/q/roof/${tokenWithout}`, { waitUntil: 'domcontentloaded' })
    // The priced view renders…
    await expect(page.getByText('12 Sample St', { exact: false }).first()).toBeVisible()
    // …but no layout map section.
    expect(await page.getByTestId('layout-map').count()).toBe(0)
    expect(await page.getByText('Please see the roof layout map below').count()).toBe(0)
  })
})
