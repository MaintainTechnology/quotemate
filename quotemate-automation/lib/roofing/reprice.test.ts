import { describe, expect, it } from 'vitest'
import { repriceWithEdgeOverrides } from './reprice'
import { priceMultiRoof } from './pricing'
import type { RoofMetrics, RoofUserInputs } from './types'

const metrics = (o: Partial<RoofMetrics> = {}): RoofMetrics => ({
  footprint_m2: 200,
  sloped_area_m2: 220,
  storeys: 1,
  form: 'hip',
  hips: 4,
  valleys: 0,
  ridge_lm: null,
  polygon_geojson: null,
  capture_date: null,
  ...o,
})

const inputs = (o: Partial<RoofUserInputs> = {}): RoofUserInputs => ({
  material: 'colorbond_trimdek',
  pitch: 'standard',
  intent: 'full_reroof',
  ...o,
})

describe('repriceWithEdgeOverrides', () => {
  it('applies a box-gutter + hips override to a stored quote and re-prices', () => {
    const quote = priceMultiRoof({
      structures: [{ buildingId: 'b1', role: 'primary', metrics: metrics(), inputs: inputs() }],
    })
    expect(quote.structures[0].metrics.box_gutter_lm ?? null).toBeNull()

    const after = repriceWithEdgeOverrides(quote, [{ index: 1, hips: 9, box_gutter_lm: 10 }])
    const s = after.structures[0]
    expect(s.metrics.hips).toBe(9)
    expect(s.metrics.box_gutter_lm).toBe(10)
    for (const t of s.price.tiers) {
      const bg = t.line_items?.find((li) => /box gutter/i.test(li.description))
      expect(bg?.total_ex_gst).toBe(600) // 10 lm × $60/lm
    }
  })

  it('leaves structures without an override untouched', () => {
    const quote = priceMultiRoof({
      structures: [
        { buildingId: 'b1', role: 'primary', metrics: metrics({ sloped_area_m2: 300 }), inputs: inputs() },
        { buildingId: 'b2', role: 'secondary', metrics: metrics({ sloped_area_m2: 50, form: 'gable', hips: 0 }), inputs: inputs() },
      ],
    })
    const after = repriceWithEdgeOverrides(quote, [{ index: 1, box_gutter_lm: 5 }])
    const s2 = after.structures.find((x) => x.buildingId === 'b2')!
    expect(s2.metrics.box_gutter_lm ?? null).toBeNull()
    expect(
      s2.price.tiers.every((t) => !(t.line_items ?? []).some((li) => /box gutter/i.test(li.description))),
    ).toBe(true)
  })

  it('applies accessory quantities and null clears them', () => {
    const quote = priceMultiRoof({
      structures: [{ buildingId: 'b1', role: 'primary', metrics: metrics(), inputs: inputs() }],
    })
    const withAcc = repriceWithEdgeOverrides(quote, [
      { index: 1, gutter_lm: 20, downpipe_count: 4, fascia_lm: 18, soffit_lm: 12 },
    ])
    const s = withAcc.structures[0]
    expect(s.metrics.gutter_lm).toBe(20)
    expect(s.metrics.downpipe_count).toBe(4)
    for (const t of s.price.tiers) {
      expect(t.line_items?.find((li) => /^Gutter replacement/.test(li.description))?.total_ex_gst).toBe(900)
      expect(t.line_items?.find((li) => /^Downpipe/.test(li.description))?.unit).toBe('each')
    }
    // Null removes the line on a later re-price (the post-inspection revert).
    const cleared = repriceWithEdgeOverrides(withAcc, [{ index: 1, gutter_lm: null }])
    const s2 = cleared.structures[0]
    expect(s2.metrics.gutter_lm).toBeNull()
    expect(s2.metrics.fascia_lm).toBe(18) // undefined keeps the stored value
    expect(
      s2.price.tiers.every((t) => !(t.line_items ?? []).some((li) => /^Gutter replacement/.test(li.description))),
    ).toBe(true)
  })

  it('pitch override re-buckets, re-derives sloped area + edge lengths, and stamps declared provenance', () => {
    const quote = priceMultiRoof({
      structures: [{ buildingId: 'b1', role: 'primary', metrics: metrics(), inputs: inputs() }],
    })
    const before = quote.structures[0]
    expect(before.price.area_m2).toBe(220)

    const after = repriceWithEdgeOverrides(quote, [{ index: 1, pitch_degrees: 30 }])
    const s = after.structures[0]
    expect(s.metrics.pitch_degrees).toBe(30)
    expect(s.metrics.pitch_source).toBe('declared')
    expect(s.metrics.field_sources?.pitch).toBe('declared')
    expect(s.inputs.pitch).toBe('steep')
    // sloped area re-derived: 200 m² footprint × 1.18 (steep) = 236 m².
    expect(s.metrics.sloped_area_m2).toBe(236)
    expect(s.metrics.field_sources?.sloped_area).toBe('derived')
    expect(s.price.area_m2).toBe(236)
    // Per-edge hip length uses the NEW pitch: (√200 / 2) × 1/cos(30°) ≈ 8.2 m.
    expect(s.price.edge_works?.per_edge_length_m).toBeCloseTo(8.2, 1)
    // The worked example: Better tier re-prices 220 × $95 = $20,900 →
    // 236 × $95 = $22,420 ex GST from the single pitch edit.
    expect(before.price.tiers[1].ex_gst).toBe(20900)
    expect(s.price.tiers[1].ex_gst).toBe(22420)
  })

  it('an explicit area in the same call beats the pitch-derived recompute', () => {
    const quote = priceMultiRoof({
      structures: [{ buildingId: 'b1', role: 'primary', metrics: metrics(), inputs: inputs() }],
    })
    const after = repriceWithEdgeOverrides(quote, [
      { index: 1, pitch_degrees: 30, sloped_area_m2: 250 },
    ])
    const s = after.structures[0]
    expect(s.metrics.sloped_area_m2).toBe(250)
    expect(s.metrics.field_sources?.sloped_area).toBe('declared')
    expect(s.metrics.area_source).toBeUndefined()
    expect(s.price.area_m2).toBe(250)
  })

  it('a very steep pitch derives no area and routes the structure to inspection', () => {
    const quote = priceMultiRoof({
      structures: [{ buildingId: 'b1', role: 'primary', metrics: metrics(), inputs: inputs() }],
    })
    const after = repriceWithEdgeOverrides(quote, [{ index: 1, pitch_degrees: 45 }])
    const s = after.structures[0]
    expect(s.inputs.pitch).toBe('very_steep')
    expect(s.metrics.sloped_area_m2).toBeNull()
    expect(s.price.routing.decision).toBe('inspection_required')
  })

  it('form and storeys overrides flow into routing and loadings', () => {
    const quote = priceMultiRoof({
      structures: [{ buildingId: 'b1', role: 'primary', metrics: metrics(), inputs: inputs() }],
    })
    // complex form → inspection routing.
    const complex = repriceWithEdgeOverrides(quote, [{ index: 1, form: 'complex' }])
    expect(complex.structures[0].metrics.form).toBe('complex')
    expect(complex.structures[0].metrics.field_sources?.form).toBe('declared')
    expect(complex.structures[0].price.routing.decision).toBe('inspection_required')
    // 2 storeys → multi-storey loading stacks on the rate.
    const twoStorey = repriceWithEdgeOverrides(quote, [{ index: 1, storeys: 2 }])
    const s = twoStorey.structures[0]
    expect(s.metrics.storeys).toBe(2)
    expect(s.metrics.field_sources?.storeys).toBe('declared')
    expect(s.price.loadings_applied.some((l) => l.code === 'multi_storey')).toBe(true)
    expect(s.price.tiers[1].ex_gst).toBeGreaterThan(quote.structures[0].price.tiers[1].ex_gst)
  })

  it('every tier keeps the line-items-sum invariant after a combined override', () => {
    const quote = priceMultiRoof({
      structures: [{ buildingId: 'b1', role: 'primary', metrics: metrics(), inputs: inputs() }],
    })
    const after = repriceWithEdgeOverrides(quote, [
      { index: 1, pitch_degrees: 28, storeys: 2, valleys: 2, gutter_lm: 24, downpipe_count: 3 },
    ])
    for (const t of after.structures[0].price.tiers) {
      const sum = (t.line_items ?? []).reduce((acc, li) => acc + li.total_ex_gst, 0)
      expect(t.ex_gst).toBeCloseTo(sum, 2)
    }
  })
})
