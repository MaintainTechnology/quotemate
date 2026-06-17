import { describe, expect, it } from 'vitest'
import { resolveSolarQuoteView, resolveSolarSizeNote } from './quote-page-row'
import type { SolarEstimate } from './types'

const estimate = {
  token: 'abc123def456',
  coverage_source: 'google',
  confidence_band: 'tight',
  routing: { decision: 'tradie_review', reason: 'Solar quote needs sign-off.' },
  sizing: {
    tiers: [
      { tier: 'good', system_kw_dc: 6.6, panels_count: 16 },
      { tier: 'better', system_kw_dc: 10, panels_count: 25 },
    ],
  },
} as unknown as SolarEstimate

describe('resolveSolarQuoteView', () => {
  it('hides prices and the CTA before confirmation', () => {
    const view = resolveSolarQuoteView({ estimate, confirmedAt: null })
    expect(view.confirmed).toBe(false)
    expect(view.showPrices).toBe(false)
    expect(view.inspectionRequired).toBe(false)
  })

  it('shows prices once confirmed and not routed to inspection', () => {
    const view = resolveSolarQuoteView({
      estimate,
      confirmedAt: '2026-06-08T04:00:00Z',
    })
    expect(view.confirmed).toBe(true)
    expect(view.showPrices).toBe(true)
  })

  it('never shows prices when routed to inspection, even confirmed', () => {
    const inspect = {
      ...estimate,
      routing: { decision: 'inspection_required', reason: 'Steep roof.' },
    } as unknown as SolarEstimate
    const view = resolveSolarQuoteView({
      estimate: inspect,
      confirmedAt: '2026-06-08T04:00:00Z',
    })
    expect(view.confirmed).toBe(true)
    expect(view.inspectionRequired).toBe(true)
    expect(view.showPrices).toBe(false)
  })

  it('exposes the headline tier as the largest sizing tier (last in order)', () => {
    const view = resolveSolarQuoteView({ estimate, confirmedAt: null })
    expect(view.headlineTier?.system_kw_dc).toBe(10)
    expect(view.headlineTier?.panels_count).toBe(25)
  })

  it('allows no headline tier when sizing produced no tiers', () => {
    const empty = {
      ...estimate,
      sizing: { tiers: [] },
    } as unknown as SolarEstimate
    const view = resolveSolarQuoteView({ estimate: empty, confirmedAt: null })
    expect(view.headlineTier).toBeNull()
  })
})

describe('resolveSolarSizeNote', () => {
  function withSizing(sizing: Record<string, unknown>): SolarEstimate {
    return { ...estimate, sizing } as unknown as SolarEstimate
  }

  it('returns null when the system is not constrained below expectation', () => {
    const e = withSizing({
      tiers: [{ tier: 'best', system_kw_dc: 10, panels_count: 25, export_limited: false }],
      phase: 'three',
      export_limit_kw_ac: 15,
      requested_size_kw: null,
    })
    expect(resolveSolarSizeNote(e)).toBeNull()
  })

  it('explains unknown supply as needing power/export confirmation', () => {
    const e = withSizing({
      tiers: [{ tier: 'best', system_kw_dc: 14, panels_count: 35, export_limited: true }],
      phase: 'unknown',
      export_limit_kw_ac: 5,
      requested_size_kw: 14,
    })
    const note = resolveSolarSizeNote(e)
    expect(note).not.toBeNull()
    expect(note?.title).toMatch(/14 kW/)
    expect(note?.title.toLowerCase()).toContain('confirmed')
    expect(note?.body).toContain('preferred roof layout')
    expect(note?.body).toMatch(/export limiting/)
  })

  it('explains a known single-phase export review', () => {
    const e = withSizing({
      tiers: [{ tier: 'best', system_kw_dc: 14, panels_count: 35, export_limited: true }],
      phase: 'single',
      export_limit_kw_ac: 5,
      requested_size_kw: 14,
    })
    const note = resolveSolarSizeNote(e)
    expect(note?.title.toLowerCase()).toContain('export-limit design review')
    expect(note?.body).toMatch(/3-phase upgrade/)
  })

  it('explains a three-phase export review without the 3-phase upsell', () => {
    const e = withSizing({
      tiers: [{ tier: 'best', system_kw_dc: 18.4, panels_count: 42, export_limited: true }],
      phase: 'three',
      export_limit_kw_ac: 15,
      requested_size_kw: 25,
    })
    const note = resolveSolarSizeNote(e)
    expect(note?.body.toLowerCase()).not.toContain('whether your property is, or can be, 3-phase')
    expect(note?.body).toMatch(/export/i)
  })

  it('mentions when an oversized request was limited by roof or quote max', () => {
    const e = withSizing({
      tiers: [{ tier: 'best', system_kw_dc: 40, panels_count: 100, export_limited: true }],
      phase: 'unknown',
      export_limit_kw_ac: 5,
      requested_size_kw: 80,
    })
    const note = resolveSolarSizeNote(e)
    expect(note?.title).toContain('40 kW')
    expect(note?.body).toContain('80 kW')
    expect(note?.body).toContain('public quote maximum')
  })

  it('explains a roof-fit limit when the request exceeds the roof (not export-capped)', () => {
    const e = withSizing({
      tiers: [{ tier: 'best', system_kw_dc: 8, panels_count: 20, export_limited: false }],
      phase: 'three',
      export_limit_kw_ac: 15,
      requested_size_kw: 12,
    })
    const note = resolveSolarSizeNote(e)
    expect(note?.title.toLowerCase()).toContain('roof fits')
    expect(note?.body).toMatch(/12 kW/)
  })

  it('returns null when the customer got at least what they asked for', () => {
    const e = withSizing({
      tiers: [{ tier: 'best', system_kw_dc: 10, panels_count: 25, export_limited: false }],
      phase: 'three',
      export_limit_kw_ac: 15,
      requested_size_kw: 9,
    })
    expect(resolveSolarSizeNote(e)).toBeNull()
  })
})
