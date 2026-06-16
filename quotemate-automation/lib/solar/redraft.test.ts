import { describe, it, expect } from 'vitest'
import {
  redraftEligibility,
  reconstructSolarInputs,
  roofSizeFromArea,
} from './redraft'
import { resolveStcZoneRating, DEFAULT_SOLAR_CONFIG } from './config'
import { checkStcZoneResolved } from './guardrails'
import { stcBreakdown } from './pricing'
import {
  solarGuardrailFlags,
  mapSolarEstimateRow,
  type SolarEstimateRawRow,
} from './dashboard-view'
import { makeFixtureEstimate } from './__fixtures__/estimate'
import type { SolarPriceTier } from './types'

describe('reconstructSolarInputs — phase + size override resolution', () => {
  const row = { address: '1 Test St', state: 'NSW', postcode: '2000' }
  const base = makeFixtureEstimate()
  const previous = {
    ...base,
    context: { ...base.context, phase: 'single' as const, requested_system_kw: 6 },
  }

  it('falls back to the persisted context values when no override is given', () => {
    const out = reconstructSolarInputs({ row, estimate: previous })!
    expect(out.phase).toBe('single')
    expect(out.desiredKw).toBe(6)
  })

  it('lets the tradie override win', () => {
    const out = reconstructSolarInputs({
      row,
      estimate: previous,
      overrides: { phase: 'three', desired_kw: 12 },
    })!
    expect(out.phase).toBe('three')
    expect(out.desiredKw).toBe(12)
  })

  it('treats an explicit null desired_kw override as clear-to-auto-size', () => {
    const out = reconstructSolarInputs({
      row,
      estimate: previous,
      overrides: { desired_kw: null },
    })!
    expect(out.desiredKw).toBe(null)
  })
})

// ── The 670 London Road, Chandler 4154 regression ────────────────────

describe('resolveStcZoneRating', () => {
  it('exact table entries win over ranges', () => {
    // Synthetic config where the exact entry deliberately disagrees with the
    // range, proving precedence without baking a wrong value into production.
    const cfg = {
      zone_table: { '2000': 1.622 },
      zone_ranges: [{ from: 2000, to: 2999, rating: 1.382 }],
    }
    expect(resolveStcZoneRating('2000', cfg)).toBe(1.622) // exact entry wins
    expect(resolveStcZoneRating('2500', cfg)).toBe(1.382) // range fallback
  })

  it('resolves the authoritative CER zone for representative postcodes', () => {
    // Verified 2026-06-15 against the CER Instrument 2019 schedule.
    expect(resolveStcZoneRating('2000', DEFAULT_SOLAR_CONFIG)).toBe(1.382) // Sydney — zone 3
    expect(resolveStcZoneRating('2650', DEFAULT_SOLAR_CONFIG)).toBe(1.382) // Wagga — zone 3 (not zone 2)
    expect(resolveStcZoneRating('2750', DEFAULT_SOLAR_CONFIG)).toBe(1.382) // Penrith — zone 3
    expect(resolveStcZoneRating('2880', DEFAULT_SOLAR_CONFIG)).toBe(1.536) // Broken Hill — zone 2
    expect(resolveStcZoneRating('2548', DEFAULT_SOLAR_CONFIG)).toBe(1.185) // Merimbula — zone 4
    expect(resolveStcZoneRating('2900', DEFAULT_SOLAR_CONFIG)).toBe(1.382) // Canberra/ACT — zone 3 (not zone 1)
    expect(resolveStcZoneRating('4870', DEFAULT_SOLAR_CONFIG)).toBe(1.382) // Cairns — zone 3 (not zone 1)
    expect(resolveStcZoneRating('4825', DEFAULT_SOLAR_CONFIG)).toBe(1.536) // Mount Isa — zone 2
    expect(resolveStcZoneRating('4480', DEFAULT_SOLAR_CONFIG)).toBe(1.622) // far-west QLD outback — zone 1
  })

  it('falls back to postcode ranges — Chandler QLD 4154 now resolves', () => {
    expect(resolveStcZoneRating('4154', DEFAULT_SOLAR_CONFIG)).toBe(1.382)
    expect(resolveStcZoneRating('4155', DEFAULT_SOLAR_CONFIG)).toBe(1.382)
    expect(resolveStcZoneRating('2155', DEFAULT_SOLAR_CONFIG)).toBe(1.382)
  })

  it('unmapped postcodes still resolve to 0 (never state-default)', () => {
    expect(resolveStcZoneRating('6000', DEFAULT_SOLAR_CONFIG)).toBe(0) // Perth — not mapped yet
    expect(resolveStcZoneRating('not-a-postcode', DEFAULT_SOLAR_CONFIG)).toBe(0)
  })

  it('a 4.8 kW Chandler system now earns 33 certificates (matches Pylon)', () => {
    const stc = stcBreakdown({
      system_kw: 4.8,
      context: {
        postcode: '4154',
        state: 'QLD',
        install_year: 2026,
        network: 'Energex',
      },
      config: DEFAULT_SOLAR_CONFIG,
    })
    // floor(4.8 × 1.382 × 5) = floor(33.17) = 33 — Pylon's calculator agrees.
    expect(stc.certificates).toBe(33)
    expect(stc.rebate_aud).toBeCloseTo(33 * 38, 2)
  })
})

describe('checkStcZoneResolved guardrail', () => {
  function tier(zoneRating: number, deeming = 5): SolarPriceTier {
    return {
      tier: 'better',
      label: '4.8 kW system',
      system_kw_dc: 4.8,
      gross_ex_gst: 5280,
      gross_inc_gst: 5808,
      stc: {
        system_kw: 4.8,
        zone_rating: zoneRating,
        deeming_years: deeming,
        certificates: zoneRating > 0 ? 33 : 0,
        stc_price_aud: 38,
        rebate_aud: zoneRating > 0 ? 1254 : 0,
      },
      net_ex_gst: 5280,
      net_inc_gst: 5808,
      scope: 'Standard install',
    }
  }

  it('flags a tier priced with no zone (rebate silently skipped)', () => {
    const flags = checkStcZoneResolved(tier(0))
    expect(flags).toHaveLength(1)
    expect(flags[0]).toMatch(/^stc_zone_missing:better:/)
    expect(flags[0]).toContain('overpay')
  })

  it('clean when the zone resolved', () => {
    expect(checkStcZoneResolved(tier(1.382))).toEqual([])
  })

  it('no flag after SRES ends (deeming 0 → zero certs is correct)', () => {
    expect(checkStcZoneResolved(tier(0, 0))).toEqual([])
  })
})

// ── Re-draft helpers ──────────────────────────────────────────────────

describe('redraftEligibility', () => {
  it('unreleased estimates may re-draft', () => {
    expect(redraftEligibility({ confirmedAt: null })).toEqual({ ok: true })
  })
  it('released estimates 409 — never re-price under the customer', () => {
    const out = redraftEligibility({ confirmedAt: '2026-06-12T00:00:00Z' })
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.status).toBe(409)
  })
})

describe('roofSizeFromArea', () => {
  it('maps to the nearest declared bucket', () => {
    expect(roofSizeFromArea(40)).toBe('small')
    expect(roofSizeFromArea(80)).toBe('medium')
    expect(roofSizeFromArea(140)).toBe('large')
    expect(roofSizeFromArea(67)).toBe('small') // 67 closer to 45 than 90? |67-45|=22 |67-90|=23 → small
  })
})

describe('reconstructSolarInputs', () => {
  it('google path: address + bill + panel grade, no manual block', () => {
    const out = reconstructSolarInputs({
      row: { address: '670 London Road, Chandler', state: 'QLD', postcode: '4154' },
      estimate: makeFixtureEstimate(),
    })!
    expect(out.input).toEqual({
      address: '670 London Road, Chandler',
      postcode: '4154',
      state: 'QLD',
    })
    expect(out.manual).toBeUndefined()
    expect(out.panelType).toBe('standard_panels')
    expect(out.quarterlyBillAud).toBe(480)
  })

  it('manual path: reconstructs the declared answers from roof facts', () => {
    const est = makeFixtureEstimate()
    est.coverage_source = 'manual'
    est.roof = {
      ...est.roof,
      source: 'manual',
      primary_orientation: 'north_east',
      usable_area_m2: 92,
      storeys: 2,
    }
    const out = reconstructSolarInputs({
      row: { address: '1 Test St', state: 'QLD', postcode: '4000' },
      estimate: est,
    })!
    expect(out.manual).toEqual({
      orientation: 'north_east',
      roof_size: 'medium',
      storeys: 2,
    })
  })

  it('falls back to estimate context when row columns are empty; null when nothing usable', () => {
    const est = makeFixtureEstimate()
    const out = reconstructSolarInputs({
      row: { address: '1 Test St', state: null, postcode: null },
      estimate: est,
    })!
    expect(out.input.postcode).toBe('2570')
    expect(out.input.state).toBe('NSW')

    expect(
      reconstructSolarInputs({
        row: { address: null, state: 'QLD', postcode: '4000' },
        estimate: est,
      }),
    ).toBeNull()
  })
})

// ── Dashboard surfaces the checks + the re-draft affordance ──────────

describe('dashboard view model — flags + re-draft', () => {
  function rawRow(flags: unknown, confirmed: string | null = null): SolarEstimateRawRow {
    return {
      public_token: 'tok12345678',
      address: '670 London Road, Chandler',
      state: 'QLD',
      postcode: '4154',
      intake_id: null,
      confirmed_at: confirmed,
      guardrail_flags: flags,
      routing: 'tradie_review',
      created_at: '2026-06-12T11:50:39Z',
      price: null,
      sizing: null,
    }
  }

  it('solarGuardrailFlags normalises the jsonb defensively', () => {
    expect(solarGuardrailFlags(['a', 'b'])).toEqual(['a', 'b'])
    expect(solarGuardrailFlags(['a', 7, '', null])).toEqual(['a'])
    expect(solarGuardrailFlags(null)).toEqual([])
    expect(solarGuardrailFlags('oops')).toEqual([])
  })

  it('flagged card carries the verbatim check texts and can re-draft (not confirm)', () => {
    const vm = mapSolarEstimateRow({
      row: rawRow(['stc_mismatch_pylon:better: …', 'stc_zone_missing:good: …']),
      customerName: 'Jeph',
      appUrl: 'https://example.test',
    })
    expect(vm.status).toBe('flagged')
    expect(vm.guardrailCount).toBe(2)
    expect(vm.guardrailFlags).toHaveLength(2)
    expect(vm.canConfirm).toBe(false)
    expect(vm.canRedraft).toBe(true)
  })

  it('clean unreleased card can confirm AND re-draft', () => {
    const vm = mapSolarEstimateRow({
      row: rawRow([]),
      customerName: null,
      appUrl: 'https://example.test',
    })
    expect(vm.canConfirm).toBe(true)
    expect(vm.canRedraft).toBe(true)
  })

  it('released card can neither confirm nor re-draft', () => {
    const vm = mapSolarEstimateRow({
      row: rawRow([], '2026-06-12T12:00:00Z'),
      customerName: null,
      appUrl: 'https://example.test',
    })
    expect(vm.status).toBe('confirmed')
    expect(vm.canConfirm).toBe(false)
    expect(vm.canRedraft).toBe(false)
  })
})
