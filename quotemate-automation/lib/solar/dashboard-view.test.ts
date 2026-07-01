import { describe, it, expect } from 'vitest'
import {
  deriveSolarEstimateStatus,
  buildSolarShareUrl,
  buildSolarQuoteUrl,
  solarGuardrailCount,
  mapSolarEstimateRow,
  type SolarEstimateRawRow,
} from './dashboard-view'

describe('deriveSolarEstimateStatus', () => {
  it('flagged when guardrail_flags is non-empty (even if confirmed/paid)', () => {
    expect(
      deriveSolarEstimateStatus({ guardrail_flags: ['better: out of band'] }),
    ).toBe('flagged')
    // Precedence: a flag wins over confirmed_at / paid_at.
    expect(
      deriveSolarEstimateStatus({
        guardrail_flags: ['x'],
        confirmed_at: '2026-06-08T00:00:00Z',
        paid_at: '2026-06-08T01:00:00Z',
      }),
    ).toBe('flagged')
  })

  it('paid when paid_at is set and no flags', () => {
    expect(
      deriveSolarEstimateStatus({
        guardrail_flags: [],
        confirmed_at: '2026-06-08T00:00:00Z',
        paid_at: '2026-06-08T02:00:00Z',
      }),
    ).toBe('paid')
  })

  it('confirmed when confirmed_at is set, no flags, not paid', () => {
    expect(
      deriveSolarEstimateStatus({
        guardrail_flags: [],
        confirmed_at: '2026-06-08T00:00:00Z',
        paid_at: null,
      }),
    ).toBe('confirmed')
  })

  it('awaiting_confirmation when clean and unconfirmed', () => {
    expect(
      deriveSolarEstimateStatus({ guardrail_flags: [], confirmed_at: null }),
    ).toBe('awaiting_confirmation')
    // Missing/garbage guardrail_flags is treated as zero flags.
    expect(deriveSolarEstimateStatus({})).toBe('awaiting_confirmation')
    expect(
      deriveSolarEstimateStatus({ guardrail_flags: null as unknown }),
    ).toBe('awaiting_confirmation')
  })
})

describe('solarGuardrailCount', () => {
  it('counts array entries and tolerates non-arrays', () => {
    expect(solarGuardrailCount(['a', 'b'])).toBe(2)
    expect(solarGuardrailCount([])).toBe(0)
    expect(solarGuardrailCount(null)).toBe(0)
    expect(solarGuardrailCount(undefined)).toBe(0)
    expect(solarGuardrailCount('nope')).toBe(0)
  })
})

describe('buildSolarShareUrl', () => {
  it('builds the /solar/<tenant-id> entry link', () => {
    expect(
      buildSolarShareUrl('https://www.quotemax.com.au', 'tenant-123'),
    ).toBe('https://www.quotemax.com.au/solar/tenant-123')
  })

  it('trims a trailing slash on the base url', () => {
    expect(buildSolarShareUrl('https://example.com/', 'abc')).toBe(
      'https://example.com/solar/abc',
    )
  })

  it('tolerates an empty base (relative link)', () => {
    expect(buildSolarShareUrl('', 'abc')).toBe('/solar/abc')
  })
})

describe('buildSolarQuoteUrl', () => {
  it('builds the /q/solar/<token> public quote link', () => {
    expect(buildSolarQuoteUrl('https://example.com', 'tok_xyz')).toBe(
      'https://example.com/q/solar/tok_xyz',
    )
  })
})

describe('mapSolarEstimateRow', () => {
  const baseRow: SolarEstimateRawRow = {
    public_token: 'tok_abc',
    address: '12 Sunny St, Newcastle',
    state: 'NSW',
    postcode: '2300',
    intake_id: 'intake-1',
    confirmed_at: null,
    paid_at: null,
    guardrail_flags: [],
    routing: 'tradie_review',
    created_at: '2026-06-08T00:00:00Z',
    sizing: {
      tiers: [
        { tier: 'good', system_kw_dc: 6.6 } as never,
        { tier: 'better', system_kw_dc: 9.9 } as never,
        { tier: 'best', system_kw_dc: 13.2 } as never,
      ],
    },
    price: {
      tiers: [
        { tier: 'good', system_kw_dc: 6.6, net_inc_gst: 7000 } as never,
        { tier: 'better', system_kw_dc: 9.9, net_inc_gst: 10500 } as never,
        { tier: 'best', system_kw_dc: 13.2, net_inc_gst: 14000 } as never,
      ],
    },
  }

  it('surfaces the better-tier kW + net price and the customer name', () => {
    const vm = mapSolarEstimateRow({
      row: baseRow,
      customerName: '  Jane Doe  ',
      appUrl: 'https://example.com',
    })
    expect(vm.token).toBe('tok_abc')
    expect(vm.systemKw).toBe(9.9)
    expect(vm.netIncGst).toBe(10500)
    expect(vm.customerName).toBe('Jane Doe')
    expect(vm.address).toBe('12 Sunny St, Newcastle')
    expect(vm.status).toBe('awaiting_confirmation')
    expect(vm.canConfirm).toBe(true)
    expect(vm.guardrailCount).toBe(0)
    expect(vm.quoteUrl).toBe('https://example.com/q/solar/tok_abc')
  })

  it('surfaces electrical_phase and requested_system_kw', () => {
    const vm = mapSolarEstimateRow({
      row: { ...baseRow, electrical_phase: 'three', requested_system_kw: 10 },
      customerName: null,
      appUrl: 'https://example.com',
    })
    expect(vm.electricalPhase).toBe('three')
    expect(vm.requestedSystemKw).toBe(10)
  })

  it('defaults phase to unknown and size to null when columns are absent', () => {
    const vm = mapSolarEstimateRow({
      row: baseRow,
      customerName: null,
      appUrl: 'https://example.com',
    })
    expect(vm.electricalPhase).toBe('unknown')
    expect(vm.requestedSystemKw).toBe(null)
  })

  it('falls back to the first tier when no better tier exists', () => {
    const vm = mapSolarEstimateRow({
      row: {
        ...baseRow,
        sizing: { tiers: [{ tier: 'good', system_kw_dc: 5 } as never] },
        price: { tiers: [{ tier: 'good', system_kw_dc: 5, net_inc_gst: 6000 } as never] },
      },
      customerName: null,
      appUrl: 'https://example.com',
    })
    expect(vm.systemKw).toBe(5)
    expect(vm.netIncGst).toBe(6000)
    expect(vm.customerName).toBeNull()
  })

  it('marks a flagged estimate non-confirmable', () => {
    const vm = mapSolarEstimateRow({
      row: { ...baseRow, guardrail_flags: ['better: gross out of band'] },
      customerName: 'Bob',
      appUrl: 'https://example.com',
    })
    expect(vm.status).toBe('flagged')
    expect(vm.guardrailCount).toBe(1)
    expect(vm.canConfirm).toBe(false)
  })

  it('marks a confirmed estimate non-confirmable', () => {
    const vm = mapSolarEstimateRow({
      row: { ...baseRow, confirmed_at: '2026-06-08T03:00:00Z' },
      customerName: 'Bob',
      appUrl: 'https://example.com',
    })
    expect(vm.status).toBe('confirmed')
    expect(vm.canConfirm).toBe(false)
  })

  it('handles missing price/sizing jsonb gracefully', () => {
    const vm = mapSolarEstimateRow({
      row: { ...baseRow, sizing: null, price: null },
      customerName: 'Bob',
      appUrl: 'https://example.com',
    })
    expect(vm.systemKw).toBeNull()
    expect(vm.netIncGst).toBeNull()
    // No price tier → no STC at all.
    expect(vm.stcCertificates).toBeNull()
    expect(vm.stcRebateAud).toBeNull()
    expect(vm.stcVerified).toBe(false)
  })

  // STC certificate count + dollar rebate ride the deterministic price tier
  // (engine = source of truth), present regardless of Pylon. The zone rating /
  // deeming period / verified flag come from the optional Pylon cross-check,
  // projected to the top-level `pylon_stc_check` alias by the route.
  const stcPriceTier = {
    tier: 'better',
    system_kw_dc: 9.9,
    net_inc_gst: 10500,
    stc: { certificates: 92, rebate_aud: 4140 },
  } as never

  it('PYLON disabled: certs + rebate survive from the price tier, but unverified + zone facts null', () => {
    const vm = mapSolarEstimateRow({
      row: { ...baseRow, price: { tiers: [stcPriceTier] } },
      customerName: null,
      appUrl: 'https://example.com',
    })
    expect(vm.stcCertificates).toBe(92)
    expect(vm.stcRebateAud).toBe(4140)
    expect(vm.stcVerified).toBe(false)
    expect(vm.stcZoneRating).toBeNull()
    expect(vm.stcDeemingPeriod).toBeNull()
  })

  it('PYLON verified: surfaces zone rating + deeming period from the top-level pylon_stc_check alias', () => {
    const vm = mapSolarEstimateRow({
      row: {
        ...baseRow,
        price: { tiers: [stcPriceTier] },
        pylon_stc_check: { verified: true, zone_rating: 1.382, deeming_period: 5 },
      },
      customerName: null,
      appUrl: 'https://example.com',
    })
    expect(vm.stcCertificates).toBe(92)
    expect(vm.stcRebateAud).toBe(4140)
    expect(vm.stcVerified).toBe(true)
    expect(vm.stcZoneRating).toBe(1.382)
    expect(vm.stcDeemingPeriod).toBe(5)
  })
})
