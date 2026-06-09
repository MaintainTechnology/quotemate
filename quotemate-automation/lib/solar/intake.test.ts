import { describe, it, expect } from 'vitest'
import { runSolarEstimate } from './intake'
import { DEFAULT_SOLAR_CONFIG } from './config'
import { COVERED_RAW_BODY } from './__fixtures__/building-insights'
import type { SolarAddressInput, SolarManualRoofInput } from './types'

const ADDRESS: SolarAddressInput = {
  address: '1 Test St, Sydney',
  postcode: '2000',
  state: 'NSW',
}

function fakeFetch(status: number, body: unknown) {
  return async () =>
    new Response(typeof body === 'string' ? body : JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    })
}

const geocodeOk = async () => ({ lat: -33.8688, lng: 151.2093 })

// COVERED_RAW_BODY has 30 panels × 400 W with Ausgrid's 5 kW/phase export limit:
// all three candidate sizes (17/24/30 panels) exceed the DC ceiling (~15 panels)
// and collapse to one size → inspection_required. Use a relaxed export limit so
// distinct tiers survive the ceiling cap (same pattern as sizing.test.ts:159-174).
const RELAXED_CONFIG = {
  ...DEFAULT_SOLAR_CONFIG,
  export_limits: {
    ...DEFAULT_SOLAR_CONFIG.export_limits,
    by_network: { ...DEFAULT_SOLAR_CONFIG.export_limits.by_network, Ausgrid: 100 },
  },
}

describe('runSolarEstimate — covered path', () => {
  it('produces a complete SolarEstimate from Google imagery', async () => {
    const est = await runSolarEstimate({
      input: ADDRESS,
      config: RELAXED_CONFIG,
      opts: {
        geocode: geocodeOk,
        solarOpts: { apiKey: 'k', fetchImpl: fakeFetch(200, COVERED_RAW_BODY) },
        installYear: 2026,
        network: 'Ausgrid',
      },
    })
    expect(est.coverage_source).toBe('google')
    expect(est.roof.source).toBe('google')
    expect(est.sizing.tiers.length).toBeGreaterThanOrEqual(2)
    expect(est.production.length).toBe(est.sizing.tiers.length)
    expect(est.price.tiers.length).toBe(est.sizing.tiers.length)
    expect(est.economics.tiers.length).toBe(est.sizing.tiers.length)
    expect(est.confidence_band).toBe('tight')
    expect(est.routing.decision).toBe('tradie_review')
    expect(est.config_version).toBe(DEFAULT_SOLAR_CONFIG.version)
    expect(typeof est.token).toBe('string')
    expect(est.token.length).toBeGreaterThanOrEqual(16)
  })

  it('persists the estimate via the injected persist hook', async () => {
    let persisted: unknown = null
    await runSolarEstimate({
      input: ADDRESS,
      config: RELAXED_CONFIG,
      opts: {
        geocode: geocodeOk,
        solarOpts: { apiKey: 'k', fetchImpl: fakeFetch(200, COVERED_RAW_BODY) },
        installYear: 2026,
        network: 'Ausgrid',
        persist: async (e) => {
          persisted = e
        },
      },
    })
    expect(persisted).not.toBeNull()
  })
})

describe('runSolarEstimate — manual fallback path', () => {
  const manual: SolarManualRoofInput = { orientation: 'north', roof_size: 'medium', storeys: 1 }

  it('branches to the manual roof when coverage 404s', async () => {
    const est = await runSolarEstimate({
      input: ADDRESS,
      manual,
      config: RELAXED_CONFIG,
      opts: {
        geocode: geocodeOk,
        solarOpts: { apiKey: 'k', fetchImpl: fakeFetch(404, { error: {} }) },
        installYear: 2026,
        network: 'Ausgrid',
      },
    })
    expect(est.coverage_source).toBe('manual')
    expect(est.roof.source).toBe('manual')
    expect(est.confidence_band).toBe('wide')
    expect(est.satellite_image_url).toBeNull()
    expect(est.sizing.tiers.length).toBeGreaterThanOrEqual(2)
  })

  it('branches to manual when uncovered and no manual input was supplied (empty estimate, inspection routed)', async () => {
    const est = await runSolarEstimate({
      input: ADDRESS,
      config: DEFAULT_SOLAR_CONFIG,
      opts: {
        geocode: geocodeOk,
        solarOpts: { apiKey: 'k', fetchImpl: fakeFetch(404, { error: {} }) },
        installYear: 2026,
        network: 'Ausgrid',
      },
    })
    expect(est.coverage_source).toBe('manual')
    // finaliseSolarEstimate always sets top-level routing to tradie_review
    // (solar never auto-sends — spec §7). The job-level decision (inspection)
    // is preserved on sizing.routing.
    expect(est.routing.decision).toBe('tradie_review')
    expect(est.sizing.routing.decision).toBe('inspection_required')
    expect(est.sizing.tiers.length).toBe(0)
  })
})

describe('runSolarEstimate — guardrails', () => {
  it('flags out-of-band tiers in guardrail_flags', async () => {
    // Force an absurd $/kW via a rate-card override embedded in config.
    // Also relax the export limit so tiers are produced (COVERED_RAW_BODY with
    // Ausgrid 5 kW collapses all tiers → inspection_required → no flags).
    const badConfig = {
      ...RELAXED_CONFIG,
      default_rate_card: {
        ...RELAXED_CONFIG.default_rate_card,
        install_rate_per_kw: { standard_panels: 9000, premium_panels: 9000, unknown: 0 },
      },
    }
    const est = await runSolarEstimate({
      input: ADDRESS,
      config: badConfig,
      opts: {
        geocode: geocodeOk,
        solarOpts: { apiKey: 'k', fetchImpl: fakeFetch(200, COVERED_RAW_BODY) },
        installYear: 2026,
        network: 'Ausgrid',
      },
    })
    expect(est.guardrail_flags.length).toBeGreaterThan(0)
    expect(est.guardrail_flags.join(' ')).toMatch(/gross/i)
  })

  it('throws when the config fails the freshness gate', async () => {
    await expect(
      runSolarEstimate({
        input: ADDRESS,
        config: { ...DEFAULT_SOLAR_CONFIG, stc_price_aud: 0 },
        opts: {
          geocode: geocodeOk,
          solarOpts: { apiKey: 'k', fetchImpl: fakeFetch(200, COVERED_RAW_BODY) },
          installYear: 2026,
          network: 'Ausgrid',
        },
      }),
    ).rejects.toThrow(/stc_price_unset/)
  })
})
