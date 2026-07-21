// ════════════════════════════════════════════════════════════════════
// Roofing pricing — "identical for every account" invariant guards.
//
// These are REGRESSION GUARDS locking behaviour that already holds: the
// roofing money path is deterministic and shared. Every tenant prices from
// DEFAULT_ROOFING_RATE_CARD merged with its OWN per-tenant overlay, so two
// accounts with no rate edits (a brand-new signup and a long-lived seed
// tenant) price a given roof byte-for-byte identically. The reported bug was
// cosmetic (a stray hourly pricing_book row surfaced as a "$/hr" card); the
// numbers were always per-m². These tests make that impossible to regress:
//
//   • no overlay        → platform defaults (existing account, no edits)
//   • fresh onboarding   → platform defaults (new account, no edits)
//   • same roof          → identical tiers across those accounts
//   • hourly_rate column → cannot change a roofing price (it's inert)
//   • only an explicit override diverges a tenant (intended customisation)
// ════════════════════════════════════════════════════════════════════

import { describe, expect, it } from 'vitest'
import { DEFAULT_ROOFING_RATE_CARD, calculateRoofingPrice } from './pricing'
import { effectiveRateCardFromOverlay } from './rate-card-overlay'
import type { RoofMetrics, RoofUserInputs } from './types'
import { OnboardActivateSchema } from '@/lib/onboard/schema'
import { buildPricingRows } from '@/lib/onboard/pricing-rows'

// A representative single-storey Colorbond re-roof — corrugated so a
// per-material override is visible in the price.
function roof(): { metrics: RoofMetrics; inputs: RoofUserInputs } {
  return {
    metrics: {
      footprint_m2: 200,
      sloped_area_m2: 220,
      storeys: 1,
      form: 'hip',
      hips: 4,
      valleys: 0,
      ridge_lm: null,
      polygon_geojson: null,
      capture_date: '2025-06-01',
    },
    inputs: {
      material: 'colorbond_corrugated',
      pitch: 'standard',
      building_year_built: 2005,
      intent: 'full_reroof',
    },
  }
}

const priceWith = (rateCard = DEFAULT_ROOFING_RATE_CARD) => {
  const { metrics, inputs } = roof()
  return calculateRoofingPrice({ metrics, inputs, rateCard })
}

// Build the effective rate card a freshly-onboarded roofing tenant lands with.
const onboardPayload = {
  business_name: 'Roo Roofing',
  owner_first_name: 'Rick',
  owner_email: 'rick@example.com',
  owner_mobile: '0412345678',
  state: 'QLD' as const,
  invitation_code: 'ROO-TEST-7K2P',
}
function newAccountRateCard(extra: Record<string, unknown> = {}) {
  const form = OnboardActivateSchema.parse({
    ...onboardPayload,
    trades: ['roofing'],
    ...extra,
  })
  const rows = buildPricingRows(form, 'tenant-1')
  return effectiveRateCardFromOverlay(rows[0].overlays?.roofing_rate_card)
}

describe('roofing rate card — every account shares the platform defaults', () => {
  it('an existing account with no overlay resolves to the platform defaults', () => {
    expect(effectiveRateCardFromOverlay(null)).toEqual(DEFAULT_ROOFING_RATE_CARD)
    expect(effectiveRateCardFromOverlay(undefined)).toEqual(DEFAULT_ROOFING_RATE_CARD)
    expect(effectiveRateCardFromOverlay({})).toEqual(DEFAULT_ROOFING_RATE_CARD)
  })

  it('a brand-new roofing account (no rate edits) resolves to the platform defaults', () => {
    expect(newAccountRateCard()).toEqual(DEFAULT_ROOFING_RATE_CARD)
  })
})

describe('roofing price — identical across new and existing accounts', () => {
  it('a new account and an existing account price the same roof identically', () => {
    const existing = priceWith(effectiveRateCardFromOverlay(null))
    const fresh = priceWith(newAccountRateCard())
    expect(fresh.tiers).toEqual(existing.tiers)
    expect(fresh.effective_rate_per_m2).toBe(existing.effective_rate_per_m2)
  })

  it('the hourly_rate pricing_book column cannot change a roofing price (it is inert)', () => {
    const cheapHourly = newAccountRateCard({ hourly_rate: '110' })
    const dearHourly = newAccountRateCard({ hourly_rate: '400' })
    // The $/hr column never enters the roofing rate card…
    expect(dearHourly).toEqual(cheapHourly)
    // …so the priced roof is identical regardless of it.
    expect(priceWith(dearHourly).tiers).toEqual(priceWith(cheapHourly).tiers)
  })
})

describe('roofing price — a tenant diverges only by an explicit rate override', () => {
  it('two accounts that set the same override price identically', () => {
    const a = newAccountRateCard({ roofing_corrugated_rate: '150' })
    const b = newAccountRateCard({ roofing_corrugated_rate: '150' })
    expect(priceWith(a).tiers).toEqual(priceWith(b).tiers)
  })

  it('an explicit override moves the price off the shared default', () => {
    const overridden = priceWith(newAccountRateCard({ roofing_corrugated_rate: '150' }))
    const shared = priceWith(effectiveRateCardFromOverlay(null))
    const better = (p: typeof shared) => p.tiers.find((t) => t.tier === 'better')!.ex_gst
    // $150/m² vs the $90/m² default on a 220 m² corrugated re-roof.
    expect(better(overridden)).toBeGreaterThan(better(shared))
  })
})
