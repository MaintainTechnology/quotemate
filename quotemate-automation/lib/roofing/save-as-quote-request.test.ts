// buildSaveAsQuoteRequest is now server-internal: it flattens only the
// tenant-owned persisted measurement after the external capability request
// has been authenticated and freshness-checked.

import { describe, expect, it } from 'vitest'
import type { MultiRoofQuote } from './types'
import { buildSaveAsQuoteRequest } from './save-as-quote-helpers'
import { SaveAsQuoteRequestSchema } from './save-as-quote-schema'

function tier(t: 'good' | 'better' | 'best', ex: number) {
  return { tier: t, label: `${t} label`, ex_gst: ex, inc_gst: ex * 1.1, scope: `${t} scope.` }
}

function structure(opts: {
  role: 'primary' | 'secondary'
  label: string
  area: number
  ex: number
  routing?: 'tradie_review' | 'inspection_required'
}) {
  return {
    buildingId: `b-${opts.label}`,
    role: opts.role,
    label: opts.label,
    metrics: {
      footprint_m2: opts.area * 0.9,
      sloped_area_m2: opts.area,
      storeys: 1,
      form: 'hip',
      hips: 2,
      valleys: 1,
      ridge_lm: 12,
      polygon_geojson: null,
      capture_date: '2026-06-01',
    },
    inputs: {
      material: 'colorbond',
      pitch: '22-30',
      intent: 'full_reroof',
      building_year_built: 1998,
    },
    price: {
      area_m2: opts.area,
      effective_rate_per_m2: 95,
      tiers: [tier('good', opts.ex * 0.2), tier('better', opts.ex), tier('best', opts.ex * 1.2)],
      loadings_applied: [{ code: 'complexity', pct: 5, detail: 'Complex hip form.' }],
      routing: {
        decision: opts.routing ?? 'tradie_review',
        reason: 'test routing',
      },
    },
  }
}

function quoteFixture(): MultiRoofQuote {
  const s1 = structure({ role: 'primary', label: 'Main dwelling', area: 200, ex: 20000 })
  const s2 = structure({ role: 'secondary', label: 'Shed', area: 50, ex: 4000 })
  return {
    structures: [s1, s2],
    combined: {
      area_m2: 250,
      tiers: [tier('good', 4800), tier('better', 24000), tier('best', 28800)],
    },
    routing: { decision: 'tradie_review', reason: 'test' },
    inspection_structures: [],
  } as unknown as MultiRoofQuote
}

const row = {
  address: '27 Smith Street, Penrith',
  postcode: '2750',
  state: 'NSW',
  quote: quoteFixture(),
  included_indices: [1] as number[] | null,
}

describe('buildSaveAsQuoteRequest', () => {
  it('keeps the trusted snapshot out of the strict external request contract', () => {
    const body = buildSaveAsQuoteRequest(row)
    expect(body).not.toBeNull()
    expect(SaveAsQuoteRequestSchema.safeParse(body).success).toBe(false)
    expect(
      SaveAsQuoteRequestSchema.safeParse({
        measure_token: 'measure-token-1',
        expected_pricing_revision: 'a'.repeat(64),
      }).success,
    ).toBe(true)
    expect(
      SaveAsQuoteRequestSchema.safeParse({
        measure_token: 'measure-token-1',
        expected_pricing_revision: 'a'.repeat(64),
        price: body?.price,
      }).success,
    ).toBe(false)
  })

  it('narrows to the included structures: primary-only selection uses its own totals', () => {
    const body = buildSaveAsQuoteRequest(row)!
    expect(body.address).toEqual({ address: '27 Smith Street, Penrith', postcode: '2750', state: 'NSW' })
    expect(body.inputs.material).toBe('colorbond')
    expect(body.inputs.intent).toBe('full_reroof')
    expect(body.price.area_m2).toBe(200)
    expect(body.price.tiers[1].ex_gst).toBe(20000)
    expect(body.metrics.sloped_area_m2).toBe(200)
    expect(body.metrics.footprint_m2).toBe(180)
  })

  it('sums tiers and area across a multi-structure selection', () => {
    const body = buildSaveAsQuoteRequest({ ...row, included_indices: [1, 2] })!
    expect(body.price.area_m2).toBe(250)
    expect(body.price.tiers[1].ex_gst).toBe(24000)
  })

  it('defaults to the primary structure when included_indices is null or empty', () => {
    for (const included_indices of [null, [] as number[]]) {
      const body = buildSaveAsQuoteRequest({ ...row, included_indices })!
      expect(body.price.area_m2).toBe(200)
    }
  })

  it('carries the narrowed job routing (inspection when the primary needs it)', () => {
    const q = quoteFixture()
    ;(q.structures[0].price.routing as { decision: string }).decision = 'inspection_required'
    const body = buildSaveAsQuoteRequest({ ...row, quote: q })!
    expect(body.price.routing.decision).toBe('inspection_required')
  })

  it('returns null when the stored quote is missing or empty', () => {
    expect(buildSaveAsQuoteRequest({ ...row, quote: null })).toBeNull()
    expect(
      buildSaveAsQuoteRequest({
        ...row,
        // Deliberately malformed (no structures) — cast like the main fixture.
        quote: { structures: [], combined: { area_m2: 0, tiers: [] } } as unknown as MultiRoofQuote,
      }),
    ).toBeNull()
  })

  it('returns null without a usable address', () => {
    expect(buildSaveAsQuoteRequest({ ...row, address: null })).toBeNull()
    expect(buildSaveAsQuoteRequest({ ...row, address: ' x ' })).toBeNull()
  })
})
