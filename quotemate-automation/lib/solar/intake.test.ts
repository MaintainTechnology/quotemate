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

describe('runSolarEstimate — covered path', () => {
  it('produces a complete SolarEstimate from Google imagery', async () => {
    const est = await runSolarEstimate({
      input: ADDRESS,
      config: DEFAULT_SOLAR_CONFIG,
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
      config: DEFAULT_SOLAR_CONFIG,
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
      config: DEFAULT_SOLAR_CONFIG,
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
    expect(est.routing.decision).toBe('inspection_required')
    expect(est.sizing.tiers.length).toBe(0)
  })
})

describe('runSolarEstimate — guardrails', () => {
  it('flags out-of-band tiers in guardrail_flags', async () => {
    // Force an absurd $/kW via a rate-card override embedded in config.
    const badConfig = {
      ...DEFAULT_SOLAR_CONFIG,
      default_rate_card: {
        ...DEFAULT_SOLAR_CONFIG.default_rate_card,
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
