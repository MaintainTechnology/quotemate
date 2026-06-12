import { describe, it, expect, vi } from 'vitest'
import {
  compareStcTier,
  runPylonStcCrossCheck,
  STC_MISMATCH_TOLERANCE,
} from './stc-crosscheck'
import { makeFixtureEstimate } from './__fixtures__/estimate'

function tierWith(certs: number) {
  return {
    tier: 'better' as const,
    stc: {
      system_kw: 10,
      zone_rating: 1.382,
      deeming_years: 5,
      certificates: certs,
      stc_price_aud: 38,
      rebate_aud: certs * 38,
    },
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('compareStcTier', () => {
  it('within tolerance (|Δ| ≤ 1) → no flag', () => {
    expect(compareStcTier(tierWith(69), 69).flag).toBeNull()
    expect(compareStcTier(tierWith(69), 68).flag).toBeNull()
    expect(compareStcTier(tierWith(69), 70).flag).toBeNull()
  })

  it(`|Δ| > ${STC_MISMATCH_TOLERANCE} → flag stc_mismatch_pylon:{tier}`, () => {
    const check = compareStcTier(tierWith(69), 65)
    expect(check.delta).toBe(4)
    expect(check.flag).toMatch(/^stc_mismatch_pylon:better:/)
    expect(check.flag).toContain('(69)')
    expect(check.flag).toContain('(65)')
  })

  it('null Pylon answer → no flag, null delta (degradation §4.6)', () => {
    const check = compareStcTier(tierWith(69), null)
    expect(check.flag).toBeNull()
    expect(check.delta).toBeNull()
    expect(check.pylon_stcs).toBeNull()
  })
})

describe('runPylonStcCrossCheck', () => {
  const env = { PYLON_ENABLED: 'true', PYLON_API_KEY: 'k' }

  it('null when the integration is disabled', async () => {
    const out = await runPylonStcCrossCheck({
      estimate: makeFixtureEstimate(),
      env: { PYLON_ENABLED: 'false', PYLON_API_KEY: 'k' },
    })
    expect(out).toBeNull()
  })

  it('null when the estimate has no priced tiers', async () => {
    const est = makeFixtureEstimate()
    est.price = { ...est.price, tiers: [] }
    const out = await runPylonStcCrossCheck({ estimate: est, env })
    expect(out).toBeNull()
  })

  it('verified when every tier matches within tolerance', async () => {
    // Fixture certs: good 44, better 69 — answer the same.
    const answers = [44, 69]
    let call = 0
    const fetchImpl = vi.fn(async () => jsonResponse({ stcs: answers[call++] }))
    const out = await runPylonStcCrossCheck(
      { estimate: makeFixtureEstimate(), env, now: () => new Date('2026-06-12T00:00:00Z') },
      { fetchImpl },
    )
    expect(out).not.toBeNull()
    expect(out!.flags).toEqual([])
    expect(out!.check.verified).toBe(true)
    expect(out!.check.checked_at).toBe('2026-06-12T00:00:00.000Z')
    expect(out!.check.tiers).toHaveLength(2)
  })

  it('captures the official zone facts from the first answer (supplements build)', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ stcs: 44, zone: '3', zone_rating: 1.382, deeming_period: 5 }),
    )
    const est = makeFixtureEstimate()
    est.price = { ...est.price, tiers: [est.price.tiers[0]] }
    const out = await runPylonStcCrossCheck({ estimate: est, env }, { fetchImpl })
    expect(out!.check.zone).toBe('3')
    expect(out!.check.zone_rating).toBe(1.382)
    expect(out!.check.deeming_period).toBe(5)
  })

  it('flags the mismatching tier only', async () => {
    const answers = [44, 60] // better is 9 certs off
    let call = 0
    const fetchImpl = vi.fn(async () => jsonResponse({ stcs: answers[call++] }))
    const out = await runPylonStcCrossCheck(
      { estimate: makeFixtureEstimate(), env },
      { fetchImpl },
    )
    expect(out!.flags).toHaveLength(1)
    expect(out!.flags[0]).toMatch(/^stc_mismatch_pylon:better:/)
    expect(out!.check.verified).toBe(false)
  })

  it('Pylon down → no flags, not verified, never throws', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('ECONNREFUSED')
    })
    const out = await runPylonStcCrossCheck(
      { estimate: makeFixtureEstimate(), env },
      { fetchImpl },
    )
    expect(out).not.toBeNull()
    expect(out!.flags).toEqual([])
    expect(out!.check.verified).toBe(false)
    expect(out!.check.tiers.every((t) => t.pylon_stcs === null)).toBe(true)
  })
})
