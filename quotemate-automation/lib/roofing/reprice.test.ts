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
})
