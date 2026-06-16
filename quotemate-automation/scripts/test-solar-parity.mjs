// QuoteMate · solar parity / sanity script
// Cross-checks the deterministic solar engine end-to-end against a known
// worked example (CER STC math + a sane payback band). Mirrors the style
// of scripts/test-sms-parity.mjs — plain Node assert, no test framework.
//
// Usage: node --import tsx scripts/test-solar-parity.mjs

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

const { stcBreakdown } = (await import('../lib/solar/pricing.ts')).__test_only__
const { DEFAULT_SOLAR_CONFIG } = await import('../lib/solar/config.ts')
const { calculateSolarEconomics } = await import('../lib/solar/economics.ts')
const { sizeSolarSystem } = await import('../lib/solar/sizing.ts')

const CONTEXT = { postcode: '2000', state: 'NSW', install_year: 2026, network: 'Ausgrid' }

describe('STC math vs worked CER example (6.6 kW, Sydney zone 3, 2026)', () => {
  const stc = stcBreakdown({ system_kw: 6.6, context: CONTEXT, config: DEFAULT_SOLAR_CONFIG })

  it('zone rating for 2000 is 1.382', () => {
    assert.equal(stc.zone_rating, 1.382)
  })
  it('deeming years for 2026 is 5', () => {
    assert.equal(stc.deeming_years, 5)
  })
  it('certificates = floor(6.6 × 1.382 × 5) = 45', () => {
    assert.equal(stc.certificates, Math.floor(6.6 * 1.382 * 5))
    assert.equal(stc.certificates, 45)
  })
  it('rebate = 45 × $38 = $1710', () => {
    assert.equal(stc.rebate_aud, 1710)
  })
})

describe('payback band is plausible (2–12 yrs) for a 6.6 kW system', () => {
  const PRICE = {
    tiers: [
      {
        tier: 'good',
        label: '6.6 kW',
        system_kw_dc: 6.6,
        gross_ex_gst: 7260,
        gross_inc_gst: 7986,
        stc: stcBreakdown({ system_kw: 6.6, context: CONTEXT, config: DEFAULT_SOLAR_CONFIG }),
        net_ex_gst: 5550,
        net_inc_gst: 6105,
        scope: '6.6 kW solar install.',
      },
    ],
    effective_rate_per_kw: 1100,
    loadings_applied: [],
    routing: { decision: 'tradie_review', reason: 'x' },
  }
  const PRODUCTION = [
    {
      system_kw_dc: 6.6,
      annual_kwh_ac: 8019, // ~1215 kWh/kW/yr
      annual_kwh_low: 6415,
      annual_kwh_high: 9623,
      derate_applied: 0.81,
      degradation_pct_per_year: 0.005,
      cec_benchmark_kwh_per_kw: 1382,
      within_cec_benchmark: true,
      band: 'tight',
    },
  ]
  const econ = calculateSolarEconomics({
    price: PRICE,
    production: PRODUCTION,
    config: DEFAULT_SOLAR_CONFIG,
    context: CONTEXT,
  })
  const t = econ.tiers[0]

  it('annual savings are positive', () => {
    assert.ok(t.annual_savings_aud > 0, `savings ${t.annual_savings_aud}`)
  })
  it('payback band is within 2–12 years', () => {
    assert.ok(t.payback_years_low >= 2, `low ${t.payback_years_low}`)
    assert.ok(t.payback_years_high <= 12, `high ${t.payback_years_high}`)
  })
  it('payback low < high', () => {
    assert.ok(t.payback_years_low < t.payback_years_high)
  })
})

describe('phase scales the export cap (design 2026-06-16)', () => {
  const ROOF = {
    max_panels_count: 20,
    panel_capacity_watts: 400,
    panel_configs: [
      { panels_count: 11, yearly_energy_dc_kwh: 6600 },
      { panels_count: 15, yearly_energy_dc_kwh: 9000 },
      { panels_count: 20, yearly_energy_dc_kwh: 12000 },
    ],
  }
  const cap = (phase) =>
    sizeSolarSystem({
      roof: ROOF,
      panelType: 'standard_panels',
      config: DEFAULT_SOLAR_CONFIG,
      context: { ...CONTEXT, phase },
    }).export_limit_kw_ac

  it('absent phase == single-phase export cap (no regression)', () => {
    assert.equal(cap(undefined), cap('single'))
  })
  it('single-phase Ausgrid cap is 5 kW AC (unchanged)', () => {
    assert.equal(cap('single'), 5)
  })
  it('three-phase cap is exactly 3× single (15 kW AC)', () => {
    assert.equal(cap('three'), 15)
    assert.equal(cap('three'), cap('single') * 3)
  })
})

console.log(`\n  ${results.passed} passed · ${results.failed} failed`)
if (results.failed > 0) {
  for (const f of results.failures) console.error(`\n✗ ${f.name}\n`, f.err)
  process.exit(1)
}
process.exit(0)
