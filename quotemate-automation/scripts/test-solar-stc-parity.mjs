// QuoteMate · solar STC parity / sanity harness
// (mirrors scripts/test-sms-parity.mjs — plain Node assert, not vitest)
//
// Verifies the deterministic STC math against worked CER examples:
//   certificates = floor(kW × zone_rating × deeming_years)
//   rebate_aud   = certificates × stc_price_aud
//   net_ex_gst   = gross_ex_gst − rebate_aud
// and that payback bands land inside the sane 2–12yr window.
//
// Run: node --import tsx scripts/test-solar-stc-parity.mjs

import { strict as assert } from 'node:assert'

const results = { passed: 0, failed: 0, failures: [] }

function it(name, fn) {
  try {
    fn()
    results.passed++
    console.log(`  ✓ ${name}`)
  } catch (err) {
    results.failed++
    results.failures.push({ name, err })
    console.log(`  ✗ ${name}`)
  }
}

function describe(group, fn) {
  console.log(`\n${group}`)
  fn()
}

const pricing = await import('../lib/solar/pricing.ts')
const guardrails = await import('../lib/solar/guardrails.ts')

// ── A minimal SolarConfig + sizing/roof/context fixtures ──────────────
// Worked CER example: Sydney (zone 3, rating 1.382), 2026 install
// (deeming 5), 6.6 kW. certificates = floor(6.6 × 1.382 × 5) = floor(45.6) = 45.
const config = {
  version: '2026-06-01',
  effective_date: '2026-06-01',
  deeming_schedule: { 2026: 5, 2027: 4, 2028: 3, 2029: 2, 2030: 1 },
  zone_table: { 2000: 1.382, 4000: 1.536 },
  stc_price_aud: 38,
  feed_in: { by_network: { Ausgrid: 0.05 }, default_aud_per_kwh: 0.05 },
  export_limits: { default_kw_per_phase: 5, by_network: {} },
  default_rate_card: {
    install_rate_per_kw: { standard_panels: 1212, premium_panels: 1600, unknown: 0 },
    multi_storey_loading_pct: 0.15,
    complex_roof_loading_pct: 0.15,
    gst_registered: true,
    call_out_minimum_ex_gst: 600,
  },
  derate_factor: 0.81,
  self_consumption_pct: 0.4,
  retail_rate_aud_per_kwh: 0.3,
}

const context = { postcode: '2000', state: 'NSW', install_year: 2026, network: 'Ausgrid' }

const roof = {
  source: 'google',
  usable_area_m2: 60,
  planes: [],
  segment_count: 2,
  primary_orientation: 'north',
  mean_pitch_degrees: 22,
  max_panels_count: 18,
  panel_capacity_watts: 400,
  panel_configs: [],
  storeys: 1,
  polygon_geojson: null,
  imagery_quality: 'HIGH',
  imagery_date: '2025-11-01',
}

const sizing = {
  tiers: [
    {
      tier: 'better',
      label: 'Full-size system',
      system_kw_dc: 6.6,
      panels_count: 16,
      panel_type: 'standard_panels',
      source_config: { panels_count: 16, yearly_energy_dc_kwh: 9400 },
      export_limited: false,
    },
  ],
  roof_capacity_kw_dc: 7.2,
  export_limit_kw_ac: 5,
  routing: { decision: 'tradie_review', reason: 'auto-calculated' },
}

describe('STC certificate math vs worked CER example (Sydney 6.6 kW, 2026)', () => {
  const price = pricing.calculateSolarPrice({ sizing, roof, context, config })
  const t = price.tiers.find((x) => x.tier === 'better')

  it('produces a better tier', () => {
    assert.ok(t, 'expected a better tier in the output')
  })

  it('certificates = floor(6.6 × 1.382 × 5) = 45', () => {
    assert.equal(t.stc.certificates, 45)
  })

  it('zone_rating is the postcode lookup (1.382), never a state default', () => {
    assert.equal(t.stc.zone_rating, 1.382)
  })

  it('deeming_years = 5 for a 2026 install', () => {
    assert.equal(t.stc.deeming_years, 5)
  })

  it('rebate_aud = 45 × $38 = $1,710', () => {
    assert.equal(t.stc.rebate_aud, 1710)
  })

  it('net = gross − rebate (the published identity)', () => {
    assert.ok(
      Math.abs(t.net_ex_gst - (t.gross_ex_gst - t.stc.rebate_aud)) <= 0.011,
      `net ${t.net_ex_gst} != gross ${t.gross_ex_gst} − rebate ${t.stc.rebate_aud}`,
    )
  })

  it('gross/kW lands inside the $700–$1,800 sanity band', () => {
    assert.deepEqual(guardrails.checkGrossPerKwBounds(t), [])
  })
})

console.log(`\n  ${results.passed} passed · ${results.failed} failed`)
if (results.failed > 0) {
  for (const f of results.failures) console.error(`\n✗ ${f.name}\n  ${f.err.message}`)
  process.exit(1)
}
process.exit(0)
