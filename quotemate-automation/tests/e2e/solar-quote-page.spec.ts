// c:/Users/dalig/Downloads/QuoteMate/quoteMate/.claude/worktrees/solar-estimate/quotemate-automation/tests/e2e/solar-quote-page.spec.ts
import { test, expect } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { randomBytes } from 'node:crypto'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY

// Skip gracefully if secrets aren't loaded in this environment.
const seedable = Boolean(url && key)

test.describe('Solar customer quote page', () => {
  test.skip(!seedable, 'Supabase service-role env not available for seeding')

  const token = `e2e${randomBytes(12).toString('hex')}`

  const estimate = {
    token,
    context: { postcode: '2000', state: 'NSW', install_year: 2026, network: 'Ausgrid' },
    coverage_source: 'google',
    roof: {
      source: 'google',
      usable_area_m2: 80,
      planes: [],
      segment_count: 2,
      primary_orientation: 'north',
      mean_pitch_degrees: 22,
      max_panels_count: 30,
      panel_capacity_watts: 400,
      panel_configs: [],
      storeys: 1,
      polygon_geojson: null,
      imagery_quality: 'HIGH',
      imagery_date: '2025-03-14',
    },
    sizing: {
      tiers: [
        { tier: 'good', label: 'Starter system', system_kw_dc: 6.6, panels_count: 16, panel_type: 'standard_panels', source_config: { panels_count: 16, yearly_energy_dc_kwh: 9800 }, export_limited: false },
        { tier: 'better', label: 'Full-size system', system_kw_dc: 10, panels_count: 25, panel_type: 'standard_panels', source_config: { panels_count: 25, yearly_energy_dc_kwh: 14800 }, export_limited: false },
      ],
      roof_capacity_kw_dc: 12,
      export_limit_kw_ac: 5,
      routing: { decision: 'tradie_review', reason: 'Solar quote needs sign-off.' },
    },
    production: [
      { system_kw_dc: 6.6, annual_kwh_ac: 9540, annual_kwh_low: 7632, annual_kwh_high: 11448, derate_applied: 0.81, degradation_pct_per_year: 0.005, cec_benchmark_kwh_per_kw: 1400, within_cec_benchmark: true, band: 'tight' },
      { system_kw_dc: 10, annual_kwh_ac: 14454, annual_kwh_low: 11563, annual_kwh_high: 17345, derate_applied: 0.81, degradation_pct_per_year: 0.005, cec_benchmark_kwh_per_kw: 1400, within_cec_benchmark: true, band: 'tight' },
    ],
    price: {
      tiers: [
        { tier: 'good', label: 'Starter system', system_kw_dc: 6.6, gross_ex_gst: 8000, gross_inc_gst: 8800, stc: { system_kw: 6.6, zone_rating: 1.382, deeming_years: 5, certificates: 45, stc_price_aud: 38, rebate_aud: 1710 }, net_ex_gst: 6290, net_inc_gst: 6919, scope: '6.6 kW system with standard panels.' },
        { tier: 'better', label: 'Full-size system', system_kw_dc: 10, gross_ex_gst: 11500, gross_inc_gst: 12650, stc: { system_kw: 10, zone_rating: 1.382, deeming_years: 5, certificates: 69, stc_price_aud: 38, rebate_aud: 2622 }, net_ex_gst: 8878, net_inc_gst: 9766, scope: '10 kW system with standard panels.' },
      ],
      effective_rate_per_kw: 1200,
      loadings_applied: [],
      routing: { decision: 'tradie_review', reason: 'Solar quote needs sign-off.' },
    },
    economics: {
      tiers: [
        { tier: 'good', self_consumed_kwh: 3816, exported_kwh: 5724, bill_savings_aud: 1221, export_earnings_aud: 401, annual_savings_aud: 1622, payback_years_low: 3.5, payback_years_high: 5.1 },
        { tier: 'better', self_consumed_kwh: 5782, exported_kwh: 8672, bill_savings_aud: 1850, export_earnings_aud: 607, annual_savings_aud: 2457, payback_years_low: 3.2, payback_years_high: 4.8 },
      ],
      assumptions: { self_consumption_pct: 0.4, retail_rate_aud_per_kwh: 0.32, feed_in_tariff_aud_per_kwh: 0.07, feed_in_network: 'Ausgrid' },
    },
    confidence_band: 'tight',
    satellite_image_url: null,
    routing: { decision: 'tradie_review', reason: 'Solar quote needs sign-off.' },
    guardrail_flags: [],
    config_version: '2026-06-01',
  }

  test.beforeAll(async () => {
    const supabase = createClient(url!, key!)
    await supabase.from('solar_estimates').insert({
      public_token: token,
      address: '1 Test Street, Sydney NSW 2000',
      state: 'NSW',
      estimate,
      confirmed_at: null,
    })
  })

  test.afterAll(async () => {
    const supabase = createClient(url!, key!)
    await supabase.from('solar_estimates').delete().eq('public_token', token)
  })

  test('renders the hero, assumptions, and mandatory compliance copy', async ({ page }) => {
    await page.goto(`/q/solar/${token}`)
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/solar/i)
    await expect(page.getByText('1 Test Street, Sydney NSW 2000')).toBeVisible()
    await expect(
      page.getByText(/Indicative layout based on Google aerial imagery, 14 Mar 2025\./),
    ).toBeVisible()
    await expect(page.getByText('Assumptions')).toBeVisible()
    await expect(
      page.getByText(/Solar Accreditation Australia \(SAA\)-accredited installer/),
    ).toBeVisible()
    await expect(page.getByText(/Estimate, not a contract\./)).toBeVisible()
  })

  test('hides prices and the deposit CTA before tradie confirmation', async ({ page }) => {
    await page.goto(`/q/solar/${token}`)
    await expect(page.getByText('Estimate drafted')).toBeVisible()
    await expect(
      page.getByText(
        'We have estimated the system size and output. Your installer will review the price before it is released.',
      ),
    ).toBeVisible()
    await expect(page.getByRole('link', { name: 'Pay deposit' })).toHaveCount(0)
    // Net price figure must not be exposed pre-confirmation.
    await expect(page.getByText('Net (inc GST)')).toHaveCount(0)
  })
})
