import { describe, it, expect } from 'vitest'
import { validateSolarConfig, DEFAULT_SOLAR_CONFIG } from './config'

describe('DEFAULT_SOLAR_CONFIG', () => {
  it('ships a deeming schedule through 2030 then 0', () => {
    expect(DEFAULT_SOLAR_CONFIG.deeming_schedule[2026]).toBe(5)
    expect(DEFAULT_SOLAR_CONFIG.deeming_schedule[2030]).toBe(1)
    expect(DEFAULT_SOLAR_CONFIG.deeming_schedule[2031]).toBe(0)
  })

  it('ships a conservative STC price and a NSW + QLD zone table', () => {
    expect(DEFAULT_SOLAR_CONFIG.stc_price_aud).toBeGreaterThan(0)
    expect(DEFAULT_SOLAR_CONFIG.stc_price_aud).toBeLessThanOrEqual(40)
    expect(DEFAULT_SOLAR_CONFIG.zone_table['2000']).toBeGreaterThan(1)
    expect(DEFAULT_SOLAR_CONFIG.zone_table['4000']).toBeGreaterThan(1)
  })

  it('ships a default rate card with standard + premium $/kW', () => {
    expect(DEFAULT_SOLAR_CONFIG.default_rate_card.install_rate_per_kw.standard_panels).toBeGreaterThan(0)
    expect(DEFAULT_SOLAR_CONFIG.default_rate_card.install_rate_per_kw.premium_panels)
      .toBeGreaterThan(DEFAULT_SOLAR_CONFIG.default_rate_card.install_rate_per_kw.standard_panels)
  })

  it('ships a derate in the 0.80–0.82 band and a self-consumption fraction', () => {
    expect(DEFAULT_SOLAR_CONFIG.derate_factor).toBeGreaterThanOrEqual(0.80)
    expect(DEFAULT_SOLAR_CONFIG.derate_factor).toBeLessThanOrEqual(0.82)
    expect(DEFAULT_SOLAR_CONFIG.self_consumption_pct).toBeGreaterThan(0)
    expect(DEFAULT_SOLAR_CONFIG.self_consumption_pct).toBeLessThan(1)
  })
})

describe('validateSolarConfig', () => {
  it('passes the default config for the current install year', () => {
    const r = validateSolarConfig(DEFAULT_SOLAR_CONFIG, 2026)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.config.version).toBe(DEFAULT_SOLAR_CONFIG.version)
  })

  it('blocks publish when the config is null', () => {
    const r = validateSolarConfig(null, 2026)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('config_missing')
  })

  it('blocks publish when the deeming year is past (no schedule entry)', () => {
    const r = validateSolarConfig(DEFAULT_SOLAR_CONFIG, 2099)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('deeming_year_past')
  })

  it('blocks publish when the deeming year resolves to 0 (SRES ended)', () => {
    const r = validateSolarConfig(DEFAULT_SOLAR_CONFIG, 2031)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('deeming_year_past')
  })

  it('blocks publish when the STC price is unset', () => {
    const bad = { ...DEFAULT_SOLAR_CONFIG, stc_price_aud: 0 }
    const r = validateSolarConfig(bad, 2026)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('stc_price_unset')
  })

  it('blocks publish when the zone table is empty (config invalid)', () => {
    const bad = { ...DEFAULT_SOLAR_CONFIG, zone_table: {} }
    const r = validateSolarConfig(bad, 2026)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('config_invalid')
  })

  it('blocks publish when derate_factor is 0 (would produce 0 kWh AC)', () => {
    const bad = { ...DEFAULT_SOLAR_CONFIG, derate_factor: 0 }
    const r = validateSolarConfig(bad, 2026)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.code).toBe('config_invalid')
      expect(r.detail).toMatch(/derate_factor/)
    }
  })

  it('blocks publish when derate_factor is 1 or greater (nonsensical)', () => {
    const bad = { ...DEFAULT_SOLAR_CONFIG, derate_factor: 1 }
    const r = validateSolarConfig(bad, 2026)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('config_invalid')
  })

  it('blocks publish when self_consumption_pct is 0 (would produce $0 savings)', () => {
    const bad = { ...DEFAULT_SOLAR_CONFIG, self_consumption_pct: 0 }
    const r = validateSolarConfig(bad, 2026)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.code).toBe('config_invalid')
      expect(r.detail).toMatch(/self_consumption_pct/)
    }
  })

  it('blocks publish when a named install rate (non-unknown) is 0', () => {
    const bad = {
      ...DEFAULT_SOLAR_CONFIG,
      default_rate_card: {
        ...DEFAULT_SOLAR_CONFIG.default_rate_card,
        install_rate_per_kw: {
          ...DEFAULT_SOLAR_CONFIG.default_rate_card.install_rate_per_kw,
          standard_panels: 0,
        },
      },
    }
    const r = validateSolarConfig(bad, 2026)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.code).toBe('config_invalid')
      expect(r.detail).toMatch(/standard_panels/)
    }
  })

  it('passes when unknown install rate is 0 (sentinel — pricing.ts guards this path)', () => {
    // 'unknown: 0' in DEFAULT_RATE_CARD is intentional; validateSolarConfig
    // must NOT reject it so the rest of the engine remains testable.
    const r = validateSolarConfig(DEFAULT_SOLAR_CONFIG, 2026)
    expect(r.ok).toBe(true)
  })
})
