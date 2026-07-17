// Coverage for the activate route's pricing_book row construction —
// specifically WHERE the roofing rate-card overlay lands and WHAT it
// contains. Three review findings live here:
//
//   1. Readers (loadRoofingOverlay in /api/roofing/measure, and the
//      dashboard editor's findPrimaryPricingBook) resolve the roofing
//      overlay from the PRIMARY-trade row (tenants.trade = trades[0]),
//      so the overlay must be written there — not to the roofing row.
//   2. The roofing pricing engine reads gst_registered from the
//      overlay-merged rate card only (never the pricing_book column),
//      so the wizard's GST answer must land in the overlay.
//   3. Untouched prefilled defaults must NOT persist as overrides —
//      the dashboard treats "no override" as "track the default".

import { describe, expect, it } from 'vitest'
import { OnboardActivateSchema } from './schema'
import { buildPricingRows, roofingOverlayFromOnboarding } from './pricing-rows'

const basePayload = {
  business_name: 'Roo Roofing',
  owner_first_name: 'Rick',
  owner_email: 'rick@example.com',
  owner_mobile: '0412345678',
  state: 'QLD' as const,
  invitation_code: 'ROO-TEST-7K2P',
}

const parse = (extra: Record<string, unknown>) =>
  OnboardActivateSchema.parse({ ...basePayload, ...extra })

describe('roofingOverlayFromOnboarding', () => {
  it('drops untouched prefilled defaults instead of persisting them as overrides', () => {
    const parsed = parse({
      trades: ['roofing'],
      roofing_corrugated_rate: '90',
      roofing_trimdek_rate: '95',
      roofing_spandek_rate: '105',
      roofing_kliplok_rate: '115',
      roofing_concrete_tile_rate: '95',
      roofing_terracotta_tile_rate: '130',
      roofing_cement_sheet_rate: '',
    })
    const overlay = roofingOverlayFromOnboarding(parsed)
    expect(overlay.reroof_rate_per_m2).toBeUndefined()
  })

  it('persists only the rates the tradie actually changed', () => {
    const parsed = parse({
      trades: ['roofing'],
      roofing_corrugated_rate: '200',
      roofing_kliplok_rate: '115', // untouched default
    })
    const overlay = roofingOverlayFromOnboarding(parsed)
    expect(overlay.reroof_rate_per_m2).toEqual({ colorbond_corrugated: 200 })
  })

  it('carries gst_registered=false into the overlay', () => {
    const parsed = parse({ trades: ['roofing'], gst_registered: false })
    expect(roofingOverlayFromOnboarding(parsed).gst_registered).toBe(false)
  })

  it('defaults gst_registered to true when the form omits it', () => {
    const parsed = parse({ trades: ['roofing'] })
    expect(roofingOverlayFromOnboarding(parsed).gst_registered).toBe(true)
  })
})

describe('buildPricingRows — overlay placement + labour placeholders', () => {
  it('roofing-only: the single (primary) row carries the roofing overlay', () => {
    const parsed = parse({ trades: ['roofing'], roofing_corrugated_rate: '200' })
    const rows = buildPricingRows(parsed, 'tenant-1')
    expect(rows).toHaveLength(1)
    expect(rows[0].trade).toBe('roofing')
    expect(rows[0].overlays?.roofing_rate_card).toMatchObject({
      reroof_rate_per_m2: { colorbond_corrugated: 200 },
      gst_registered: true,
    })
  })

  it('electrical-first multi-trade: the roofing overlay lands on the PRIMARY (electrical) row', () => {
    const parsed = parse({
      trades: ['electrical', 'roofing'],
      hourly_rate: '110',
      call_out_minimum: '150',
      default_markup_pct: '25',
      roofing_corrugated_rate: '200',
    })
    const rows = buildPricingRows(parsed, 'tenant-1')
    const electrical = rows.find((r) => r.trade === 'electrical')!
    const roofing = rows.find((r) => r.trade === 'roofing')!
    expect(electrical.overlays?.roofing_rate_card).toMatchObject({
      reroof_rate_per_m2: { colorbond_corrugated: 200 },
    })
    expect(roofing.overlays?.roofing_rate_card).toBeUndefined()
  })

  it('painting-first + roofing: the painting row carries BOTH rate cards', () => {
    const parsed = parse({
      trades: ['painting', 'roofing'],
      roofing_terracotta_tile_rate: '150',
    })
    const rows = buildPricingRows(parsed, 'tenant-1')
    const painting = rows.find((r) => r.trade === 'painting')!
    expect(painting.overlays?.painting_rate_card).toBeDefined()
    expect(painting.overlays?.roofing_rate_card).toMatchObject({
      reroof_rate_per_m2: { terracotta_tile: 150 },
    })
  })

  it('keeps the NOT NULL labour placeholders on a roofing-only row', () => {
    const parsed = parse({ trades: ['roofing'] })
    const rows = buildPricingRows(parsed, 'tenant-1')
    expect(rows[0]).toMatchObject({
      tenant_id: 'tenant-1',
      hourly_rate: 110,
      call_out_minimum: 150,
      default_markup_pct: 0,
    })
  })

  it('a state-less payload stores null licence_state (state is optional)', () => {
    const parsed = OnboardActivateSchema.parse({
      ...basePayload,
      state: '',
      trades: ['roofing'],
    })
    const rows = buildPricingRows(parsed, 'tenant-1')
    expect(rows[0].licence_state).toBeNull()
  })

  it('labour trades use the wizard-supplied labour rates', () => {
    const parsed = parse({
      trades: ['plumbing'],
      hourly_rate: '120',
      call_out_minimum: '180',
      default_markup_pct: '18',
    })
    const rows = buildPricingRows(parsed, 'tenant-1')
    expect(rows[0]).toMatchObject({
      trade: 'plumbing',
      hourly_rate: 120,
      call_out_minimum: 180,
      default_markup_pct: 18,
    })
    expect(rows[0].overlays).toBeUndefined()
  })
})
