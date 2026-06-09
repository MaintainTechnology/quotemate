import { describe, it, expect } from 'vitest'
import { checkNetIdentity } from './guardrails'
import type { SolarPriceTier } from './types'

function tier(over: Partial<SolarPriceTier> = {}): SolarPriceTier {
  return {
    tier: 'better',
    label: 'Full-size system',
    system_kw_dc: 6.6,
    gross_ex_gst: 8000,
    gross_inc_gst: 8800,
    stc: {
      system_kw: 6.6,
      zone_rating: 1.382,
      deeming_years: 5,
      certificates: 45,
      stc_price_aud: 38,
      rebate_aud: 1710,
    },
    net_ex_gst: 6290, // 8000 − 1710
    net_inc_gst: 6919,
    scope: '6.6 kW solar install with standard panels.',
    ...over,
  }
}

describe('checkNetIdentity', () => {
  it('returns no flag when net_ex_gst === gross_ex_gst − rebate (within 1 cent)', () => {
    expect(checkNetIdentity(tier())).toEqual([])
  })

  it('flags when net does not equal gross minus the STC rebate', () => {
    const bad = tier({ net_ex_gst: 5000 }) // should be 6290
    const flags = checkNetIdentity(bad)
    expect(flags).toHaveLength(1)
    expect(flags[0]).toMatch(/net.*gross.*STC/i)
    expect(flags[0]).toContain('better')
  })

  it('tolerates a 1-cent rounding drift', () => {
    expect(checkNetIdentity(tier({ net_ex_gst: 6290.01 }))).toEqual([])
  })
})
