import { z } from 'zod'
import type { AcPricedRecommendation } from './types'

const finite = z.number().finite()

const componentSchema = z.looseObject({
  label: z.string(),
  quantity: finite,
  unit: z.string(),
  rate_ex_gst: finite,
  total_ex_gst: finite,
  note: z.string().optional(),
})

const optionSchema = z.looseObject({
  system_type: z.enum(['ducted', 'split']),
  capacity_kw: finite,
  price: z.looseObject({ low: finite, high: finite }),
  pricing: z.looseObject({
    point_estimate_ex_gst: finite,
    point_estimate_inc_gst: finite,
    confidence_band_pct: finite,
    gst_registered: z.boolean(),
    formula: z.string(),
    band_reason: z.string(),
    components: z.array(componentSchema),
    adjustments: z.array(componentSchema),
  }),
  best_fit: z.boolean(),
  pros: z.array(z.string()),
  cons: z.array(z.string()),
})

const pricedRecommendationSchema = z.looseObject({
  pricing_status: z.literal('priced'),
  pricing_authority: z.object({
    source: z.literal('tenant_pricing_book'),
    tenant_id: z.string().min(1),
    pricing_book_id: z.string().min(1),
    revision: z.string().regex(/^[a-f0-9]{64}$/),
  }),
  sizing: z.looseObject({
    rooms: z.array(z.unknown()),
    conditioned_zones: finite,
    total_floor_area_m2: finite,
    floor_area_source: z.enum(['entered', 'typical_room_mix', 'solar_footprint', 'floor_plan']),
    total_volume_m3: finite,
    ceiling_height_m: finite,
    storeys: finite,
    volumetric_factor_kw_m3: finite,
    connected_kw: finite,
    connected_kw_low: finite,
    connected_kw_high: finite,
    ducted_kw: finite,
    confidence: z.enum(['high', 'medium', 'low']),
    notes: z.array(z.string()),
    warnings: z.array(z.string()),
  }),
  options: z.array(optionSchema).min(1),
  routing: z.looseObject({
    decision: z.literal('book_assessment'),
    reason: z.string(),
  }),
  confidence: z.enum(['high', 'medium', 'low']),
})

export function parseStoredPricedRecommendation(value: unknown): AcPricedRecommendation | null {
  const parsed = pricedRecommendationSchema.safeParse(value)
  return parsed.success ? (parsed.data as AcPricedRecommendation) : null
}
